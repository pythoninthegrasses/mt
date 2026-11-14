//! Tests for the reconcile pipeline's result type and its first two phases.
//!
//! The `ReconcileScanResult` tests came across with the code from `mt-tauri`.
//! The pipeline tests are new and are the reason the phase callbacks and the
//! cross-directory setting became parameters: they are what the desktop adapter
//! used to hardcode, and they are now observable from a test. Cross-directory
//! suppression, and the sink's thread-safety contract, are in
//! [`crate::library::reconcile::cross_dir_tests`].

use std::fs;

use super::*;
use crate::db::{revision, watched};
use crate::library::test_util::{
    RecordingProgress, add_backfill_candidate, set_added_date, setup_conn as setup_test_db,
    write_music_files,
};

// =========================================================================
// ReconcileScanResult tests
// =========================================================================

#[test]
fn test_reconcile_scan_result_serialization() {
    let result = ReconcileScanResult {
        backfilled: 10,
        duplicates_merged: 5,
        cross_directory_suppressed: 3,
        reinstated: 1,
        errors: 2,
    };

    let json = serde_json::to_string(&result).unwrap();
    assert!(json.contains("\"backfilled\":10"));
    assert!(json.contains("\"duplicates_merged\":5"));
    assert!(json.contains("\"cross_directory_suppressed\":3"));
    assert!(json.contains("\"reinstated\":1"));
    assert!(json.contains("\"errors\":2"));
}

#[test]
fn test_reconcile_scan_result_zero_values() {
    let result = ReconcileScanResult {
        backfilled: 0,
        duplicates_merged: 0,
        cross_directory_suppressed: 0,
        reinstated: 0,
        errors: 0,
    };

    let json = serde_json::to_string(&result).unwrap();
    assert!(json.contains("\"backfilled\":0"));
    assert!(json.contains("\"duplicates_merged\":0"));
    assert!(json.contains("\"errors\":0"));
}

#[test]
fn test_reconcile_scan_result_clone() {
    let result = ReconcileScanResult {
        backfilled: 100,
        duplicates_merged: 20,
        cross_directory_suppressed: 0,
        reinstated: 0,
        errors: 3,
    };

    let cloned = result.clone();
    assert_eq!(result.backfilled, cloned.backfilled);
    assert_eq!(result.duplicates_merged, cloned.duplicates_merged);
    assert_eq!(result.errors, cloned.errors);
}

#[test]
fn test_reconcile_scan_result_large_values() {
    let result = ReconcileScanResult {
        backfilled: 10_000,
        duplicates_merged: 5_000,
        cross_directory_suppressed: 0,
        reinstated: 0,
        errors: 100,
    };

    let json = serde_json::to_string(&result).unwrap();
    assert!(json.contains("\"backfilled\":10000"));
    assert!(json.contains("\"duplicates_merged\":5000"));
}

// =========================================================================
// Empty library
// =========================================================================

#[test]
fn test_backfill_on_empty_library_reports_zero_and_completes() {
    let conn = setup_test_db();
    let progress = RecordingProgress::new();

    let outcome = run_backfill_and_dedup(&conn, false, &progress).unwrap();

    assert_eq!(outcome.result.backfilled, 0);
    assert_eq!(outcome.result.duplicates_merged, 0);
    assert_eq!(outcome.result.cross_directory_suppressed, 0);
    assert_eq!(outcome.result.reinstated, 0);
    assert_eq!(outcome.result.errors, 0);
    assert!(
        outcome.dedup.is_none(),
        "nothing deleted means no event is due"
    );

    // The caller's spinner depends on every phase being announced, even when
    // there is nothing to do, and on `complete` closing it.
    assert_eq!(
        progress.phases(),
        vec![
            "fingerprinting",
            "deduplicating",
            "cross_directory_dedup",
            "complete"
        ]
    );
    assert_eq!(progress.calls("complete"), vec![(0, 0)]);
}

// =========================================================================
// Phase 1: fingerprint backfill
// =========================================================================

#[test]
fn test_backfill_fingerprints_existing_files_and_reports_progress() {
    let dir = tempfile::tempdir().unwrap();
    let paths = write_music_files(dir.path(), 3);
    let conn = setup_test_db();
    let ids: Vec<i64> = paths
        .iter()
        .map(|p| add_backfill_candidate(&conn, p))
        .collect();
    let progress = RecordingProgress::new();

    let outcome = run_backfill_and_dedup(&conn, false, &progress).unwrap();

    assert_eq!(outcome.result.backfilled, 3);
    assert_eq!(outcome.result.errors, 0);
    assert_eq!(outcome.result.duplicates_merged, 0);

    // Fingerprinting opens with (0, total) and closes with the full count, so
    // the frontend's bar reaches 100% even for a batch under the 100-report step.
    let fingerprinting = progress.calls("fingerprinting");
    assert_eq!(fingerprinting.first(), Some(&(0, 3)));
    assert_eq!(fingerprinting.last(), Some(&(3, 3)));
    assert_eq!(
        progress.phases(),
        vec![
            "fingerprinting",
            "deduplicating",
            "cross_directory_dedup",
            "complete"
        ]
    );
    assert_eq!(progress.calls("complete"), vec![(3, 3)]);

    // The fingerprints really landed: a second pass has nothing left to do.
    for id in &ids {
        let (inode, hash): (Option<i64>, Option<String>) = conn
            .query_row(
                "SELECT file_inode, content_hash FROM library WHERE id = ?",
                [id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert!(hash.is_some(), "content hash must be recorded for {id}");
        let _ = inode;
    }

    let progress_again = RecordingProgress::new();
    let second = run_backfill_and_dedup(&conn, false, &progress_again).unwrap();
    assert_eq!(second.result.backfilled, 0);
}

#[test]
fn test_backfill_skips_missing_files_but_still_reports_progress() {
    let dir = tempfile::tempdir().unwrap();
    let present = write_music_files(dir.path(), 1);
    let conn = setup_test_db();
    add_backfill_candidate(&conn, &present[0]);
    add_backfill_candidate(&conn, "/music/vanished.mp3");
    let progress = RecordingProgress::new();

    let outcome = run_backfill_and_dedup(&conn, false, &progress).unwrap();

    assert_eq!(
        outcome.result.backfilled, 1,
        "only the file on disk can be fingerprinted"
    );
    // The skipped file still counts toward progress, otherwise the bar stalls
    // below 100% whenever any track is missing.
    assert_eq!(progress.calls("fingerprinting").last(), Some(&(2, 2)));
    assert_eq!(progress.calls("complete"), vec![(2, 2)]);
}

#[test]
fn test_backfill_ignores_tracks_marked_missing() {
    let conn = setup_test_db();
    let id = add_backfill_candidate(&conn, "/music/offline.mp3");
    conn.execute(
        "UPDATE library SET missing = 1 WHERE id = ?",
        rusqlite::params![id],
    )
    .unwrap();
    let progress = RecordingProgress::new();

    let outcome = run_backfill_and_dedup(&conn, false, &progress).unwrap();

    assert_eq!(outcome.result.backfilled, 0);
    assert_eq!(progress.calls("fingerprinting"), vec![(0, 0)]);
}

// =========================================================================
// Phase 2: within-directory dedup
// =========================================================================

#[test]
fn test_backfill_merges_identical_files_in_one_folder() {
    let dir = tempfile::tempdir().unwrap();
    let mut paths = write_music_files(dir.path(), 1);
    // Byte-identical copy, so phase 2's hash dedup groups them together.
    let copy = dir.path().join("track0_copy.mp3");
    fs::copy(&paths[0], &copy).unwrap();
    paths.push(copy.to_str().unwrap().to_string());

    let conn = setup_test_db();
    watched::add_watched_folder(&conn, &dir.path().to_string_lossy(), "startup", 10, true).unwrap();
    let ids: Vec<i64> = paths
        .iter()
        .map(|p| add_backfill_candidate(&conn, p))
        .collect();
    set_added_date(&conn, ids[0], "2020-01-01 00:00:00");
    set_added_date(&conn, ids[1], "2021-01-01 00:00:00");
    let progress = RecordingProgress::new();

    let outcome = run_backfill_and_dedup(&conn, false, &progress).unwrap();

    assert_eq!(outcome.result.duplicates_merged, 1);
    assert_eq!(outcome.result.cross_directory_suppressed, 0);

    let dedup = outcome
        .dedup
        .expect("a merged duplicate must report a reconcile");
    assert_eq!(
        dedup.deleted_ids,
        vec![ids[1]],
        "the later row is the one removed"
    );
    assert_eq!(dedup.total_tracks, 1);
    assert_eq!(dedup.local_file_count, 1);
    assert_eq!(dedup.revision, revision::get_revision(&conn).unwrap());
    assert!(dedup.total_duration > 0.0);

    let surviving: i64 = conn
        .query_row("SELECT COUNT(*) FROM library", [], |row| row.get(0))
        .unwrap();
    assert_eq!(surviving, 1);
    // Progress is throttled to every 100 groups, so a single group only ever
    // announces the phase opening.
    assert_eq!(progress.calls("deduplicating"), vec![(0, 0)]);
}

/// The reconcile figures are measured on the connection that did the deleting,
/// which is why `deleted_ids` and the totals travel together in one struct.
#[test]
fn test_backfill_dedup_reconcile_counts_only_surviving_rows() {
    let dir = tempfile::tempdir().unwrap();
    let mut paths = write_music_files(dir.path(), 2);
    let copy = dir.path().join("track1_copy.mp3");
    fs::copy(&paths[1], &copy).unwrap();
    paths.push(copy.to_str().unwrap().to_string());

    let conn = setup_test_db();
    watched::add_watched_folder(&conn, &dir.path().to_string_lossy(), "startup", 10, true).unwrap();
    for path in &paths {
        add_backfill_candidate(&conn, path);
    }

    let outcome = run_backfill_and_dedup(&conn, false, &RecordingProgress::new()).unwrap();

    let dedup = outcome.dedup.expect("duplicates were merged");
    assert_eq!(dedup.deleted_ids.len(), 1);
    assert_eq!(
        dedup.total_tracks, 2,
        "3 rows in, 1 merged, so 2 remain — not the 3 the run started with"
    );
}

// =========================================================================
