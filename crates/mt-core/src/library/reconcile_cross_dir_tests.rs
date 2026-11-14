//! Tests for phase 3b: the cross-directory pass and the setting that gates it.
//!
//! These are the tests that justify `dedup_enabled` being a parameter rather
//! than a settings read inside the pipeline: both branches, and the reinstating
//! of suppressions written by an earlier run, are reachable only through it.

use std::fs;

use super::*;
use crate::db::{dedup, watched};
use crate::library::test_util::{
    RecordingProgress, add_backfill_candidate, set_added_date, setup_conn as setup_test_db,
};

// Phase 3b: cross-directory dedup and its setting
// =========================================================================

/// Two watched folders holding byte-identical files: phase 2 must leave the
/// pair alone for phase 3, which suppresses instead of merging outright.
#[test]
fn test_cross_directory_dedup_suppresses_when_enabled() {
    let root = tempfile::tempdir().unwrap();
    let folder_a = root.path().join("a");
    let folder_b = root.path().join("b");
    fs::create_dir(&folder_a).unwrap();
    fs::create_dir(&folder_b).unwrap();
    let path_a = folder_a.join("song.mp3");
    let path_b = folder_b.join("song.mp3");
    fs::write(&path_a, b"identical payload").unwrap();
    fs::write(&path_b, b"identical payload").unwrap();

    let conn = setup_test_db();
    watched::add_watched_folder(&conn, &folder_a.to_string_lossy(), "startup", 10, true).unwrap();
    watched::add_watched_folder(&conn, &folder_b.to_string_lossy(), "startup", 10, true).unwrap();
    let ids = [
        add_backfill_candidate(&conn, path_a.to_str().unwrap()),
        add_backfill_candidate(&conn, path_b.to_str().unwrap()),
    ];
    set_added_date(&conn, ids[0], "2020-01-01 00:00:00");
    set_added_date(&conn, ids[1], "2021-01-01 00:00:00");
    let progress = RecordingProgress::new();

    let outcome = run_backfill_and_dedup(&conn, true, &progress).unwrap();

    assert_eq!(
        outcome.result.duplicates_merged, 0,
        "cross-directory merges are counted separately, not as ordinary duplicates"
    );
    assert_eq!(outcome.result.cross_directory_suppressed, 1);
    assert_eq!(outcome.dedup.expect("event").deleted_ids, vec![ids[1]]);
    assert_eq!(
        dedup::count_suppressed(&conn).unwrap(),
        1,
        "a suppression row is what makes this recoverable"
    );
    assert!(progress.calls("cross_directory_dedup").contains(&(1, 1)));
}

#[test]
fn test_cross_directory_dedup_disabled_leaves_both_tracks() {
    let root = tempfile::tempdir().unwrap();
    let folder_a = root.path().join("a");
    let folder_b = root.path().join("b");
    fs::create_dir(&folder_a).unwrap();
    fs::create_dir(&folder_b).unwrap();
    let path_a = folder_a.join("song.mp3");
    let path_b = folder_b.join("song.mp3");
    fs::write(&path_a, b"identical payload").unwrap();
    fs::write(&path_b, b"identical payload").unwrap();

    let conn = setup_test_db();
    watched::add_watched_folder(&conn, &folder_a.to_string_lossy(), "startup", 10, true).unwrap();
    watched::add_watched_folder(&conn, &folder_b.to_string_lossy(), "startup", 10, true).unwrap();
    add_backfill_candidate(&conn, path_a.to_str().unwrap());
    add_backfill_candidate(&conn, path_b.to_str().unwrap());

    let outcome = run_backfill_and_dedup(&conn, false, &RecordingProgress::new()).unwrap();

    assert_eq!(outcome.result.cross_directory_suppressed, 0);
    assert_eq!(outcome.result.duplicates_merged, 0);
    assert!(outcome.dedup.is_none());
    let surviving: i64 = conn
        .query_row("SELECT COUNT(*) FROM library", [], |row| row.get(0))
        .unwrap();
    assert_eq!(
        surviving, 2,
        "turning the setting off must not delete anything"
    );
    assert_eq!(dedup::count_suppressed(&conn).unwrap(), 0);
}

/// With the setting turned off, suppressions written earlier are undone and the
/// hidden files become tracks again.
#[test]
fn test_disabling_dedup_restores_previously_suppressed_tracks() {
    let root = tempfile::tempdir().unwrap();
    let folder_a = root.path().join("a");
    let folder_b = root.path().join("b");
    fs::create_dir(&folder_a).unwrap();
    fs::create_dir(&folder_b).unwrap();
    let path_a = folder_a.join("song.mp3");
    let path_b = folder_b.join("song.mp3");
    fs::write(&path_a, b"identical payload").unwrap();
    fs::write(&path_b, b"identical payload").unwrap();

    let conn = setup_test_db();
    let kept = add_backfill_candidate(&conn, path_a.to_str().unwrap());
    dedup::suppress_track(&conn, kept, path_b.to_str().unwrap(), None, None, None).unwrap();
    assert_eq!(dedup::count_suppressed(&conn).unwrap(), 1);

    let outcome = run_backfill_and_dedup(&conn, false, &RecordingProgress::new()).unwrap();

    let restored: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM library WHERE filepath = ?",
            [path_b.to_str().unwrap()],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(restored, 1, "the suppressed file is back in the library");
    assert_eq!(outcome.result.errors, 0);
}

// =========================================================================
// ReconcileProgress contract
// =========================================================================

/// The pipeline reports from rayon worker threads, so the sink has to be usable
/// across them. If `ReconcileProgress` ever loses `Sync` this fails to build.
#[test]
fn test_progress_sink_is_shared_across_threads() {
    fn assert_sync<T: Sync>() {}
    assert_sync::<RecordingProgress>();
}
