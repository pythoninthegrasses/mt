//! Tests for the mutation paths that remove rows, and for rescan.
//!
//! Two properties matter most here and get explicit coverage: a mutation that
//! removes a row also records the removal, in the same transaction, so a scan
//! cannot resurrect it; and the error strings are the ones the frontend has
//! always displayed.

use std::fs;

use super::*;
use crate::db::{TrackMetadata, library};
use crate::library::queries::get_track;
use crate::library::test_util::{
    add_sized_track, filepath_is_removed, mark_remote, removal_count, sample_db, track_count,
    write_temp_file,
};

// =========================================================================
// delete_track
// =========================================================================

#[test]
fn test_delete_track_removes_row_and_records_removal() {
    let db = sample_db();
    let id = add_sized_track(&db, 1, 60.0);

    assert!(delete_track(&db, id).unwrap());
    assert_eq!(track_count(&db), 0);
    assert!(
        filepath_is_removed(&db, "/music/track1.mp3"),
        "a user deletion must be recorded so scans don't re-add the file"
    );
}

#[test]
fn test_delete_track_records_content_hash_and_remote_id() {
    let db = sample_db();
    let conn = db.conn().unwrap();
    let metadata = TrackMetadata {
        title: Some("Streamed".to_string()),
        duration: Some(60.0),
        content_hash: Some("deadbeef".to_string()),
        ..Default::default()
    };
    let id = library::add_track(&conn, "https://plex/stream.m4a", &metadata).unwrap();
    mark_remote(&conn, id, "plex:42");
    drop(conn);

    assert!(delete_track(&db, id).unwrap());

    let conn = db.conn().unwrap();
    let (hash, remote_id): (Option<String>, Option<String>) = conn
        .query_row(
            "SELECT content_hash, remote_id FROM removed_tracks WHERE filepath = ?",
            ["https://plex/stream.m4a"],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert_eq!(hash.as_deref(), Some("deadbeef"));
    assert_eq!(remote_id.as_deref(), Some("plex:42"));
}

#[test]
fn test_delete_track_unknown_id_is_false_not_error() {
    let db = sample_db();
    assert!(!delete_track(&db, 9_999).unwrap());
    assert_eq!(
        removal_count(&db),
        0,
        "nothing to record for nothing deleted"
    );
}

// =========================================================================
// reconcile_stats
// =========================================================================

#[test]
fn test_reconcile_stats_measures_current_library() {
    let db = sample_db();
    for i in 1..=3 {
        add_sized_track(&db, i, 100.0);
    }

    let stats = reconcile_stats(&db).unwrap();
    assert_eq!(stats.total_tracks, 3);
    assert_eq!(stats.local_file_count, 3);
    assert_eq!(stats.total_duration, 300.0);
    assert!(stats.revision > 0, "writes advance the revision");
}

/// The two totals disagree as soon as a Plex stream is in the library: the
/// frontend paginates off `total_tracks` but shows `total_duration` in the
/// footer, which excludes remotes.
#[test]
fn test_reconcile_stats_excludes_remote_tracks_from_duration() {
    let db = sample_db();
    add_sized_track(&db, 1, 100.0);
    let conn = db.conn().unwrap();
    let metadata = TrackMetadata {
        title: Some("Streamed".to_string()),
        duration: Some(999.0),
        file_size: Some(9_000),
        ..Default::default()
    };
    let remote = library::add_track(&conn, "https://plex/stream.m4a", &metadata).unwrap();
    mark_remote(&conn, remote, "plex:1");
    drop(conn);

    let stats = reconcile_stats(&db).unwrap();
    assert_eq!(stats.total_tracks, 2, "remotes still count for pagination");
    assert_eq!(stats.local_file_count, 1);
    assert_eq!(
        stats.total_duration, 100.0,
        "remote duration stays out of the footer"
    );
}

#[test]
fn test_reconcile_stats_follows_a_deletion() {
    let db = sample_db();
    let id = add_sized_track(&db, 1, 100.0);
    add_sized_track(&db, 2, 200.0);

    delete_track(&db, id).unwrap();

    let stats = reconcile_stats(&db).unwrap();
    assert_eq!(stats.total_tracks, 1);
    assert_eq!(stats.local_file_count, 1);
    assert_eq!(stats.total_duration, 200.0);
}

// =========================================================================
// delete_tracks
// =========================================================================

#[test]
fn test_delete_tracks_records_every_removal() {
    let db = sample_db();
    let id1 = add_sized_track(&db, 1, 60.0);
    let id2 = add_sized_track(&db, 2, 60.0);
    add_sized_track(&db, 3, 60.0);

    let deleted = delete_tracks(&db, &[id1, id2]).unwrap();

    assert_eq!(deleted, 2);
    assert_eq!(track_count(&db), 1);
    assert!(filepath_is_removed(&db, "/music/track1.mp3"));
    assert!(filepath_is_removed(&db, "/music/track2.mp3"));
    assert!(!filepath_is_removed(&db, "/music/track3.mp3"));
}

#[test]
fn test_delete_tracks_empty_id_list_is_a_no_op() {
    let db = sample_db();
    add_sized_track(&db, 1, 60.0);

    assert_eq!(delete_tracks(&db, &[]).unwrap(), 0);
    assert_eq!(track_count(&db), 1);
    assert_eq!(removal_count(&db), 0);
}

#[test]
fn test_delete_tracks_counts_only_real_deletions() {
    let db = sample_db();
    let id = add_sized_track(&db, 1, 60.0);

    // One real ID and one that never existed: the count is the rows removed.
    assert_eq!(delete_tracks(&db, &[id, 8_888]).unwrap(), 1);
}

// =========================================================================
// delete_all
// =========================================================================

#[test]
fn test_delete_all_clears_library_and_removals() {
    let db = sample_db();
    let id = add_sized_track(&db, 1, 60.0);
    delete_track(&db, id).unwrap();
    add_sized_track(&db, 2, 60.0);
    assert_eq!(removal_count(&db), 1);

    let deleted = delete_all(&db).unwrap();

    assert_eq!(deleted, 1, "only the surviving row is deleted");
    assert_eq!(track_count(&db), 0);
    assert_eq!(
        removal_count(&db),
        0,
        "a cleared library must not block a re-add on the next scan"
    );
}

// =========================================================================
// purge_missing
// =========================================================================

#[test]
fn test_purge_missing_removes_only_missing_rows() {
    let db = sample_db();
    let missing = add_sized_track(&db, 1, 60.0);
    add_sized_track(&db, 2, 60.0);
    let conn = db.conn().unwrap();
    library::mark_track_missing(&conn, missing).unwrap();
    drop(conn);

    assert_eq!(purge_missing(&db).unwrap(), 1);
    assert_eq!(track_count(&db), 1);
    assert!(get_track(&db, missing).unwrap().is_none());
}

#[test]
fn test_purge_missing_on_clean_library_is_zero() {
    let db = sample_db();
    add_sized_track(&db, 1, 60.0);
    assert_eq!(purge_missing(&db).unwrap(), 0);
    assert_eq!(track_count(&db), 1);
}

// =========================================================================
// rescan_track
// =========================================================================

#[test]
fn test_rescan_track_rereads_tags_from_disk() {
    let dir = tempfile::tempdir().unwrap();
    let path = write_temp_file(dir.path(), "rescanned.mp3");

    let db = sample_db();
    let conn = db.conn().unwrap();
    let metadata = TrackMetadata {
        title: Some("Stale Tag".to_string()),
        artist: Some("Stale Artist".to_string()),
        album: Some("Stale Album".to_string()),
        duration: Some(60.0),
        ..Default::default()
    };
    let id = library::add_track(&conn, &path, &metadata).unwrap();
    drop(conn);

    let track = rescan_track(&db, id).unwrap();

    // The file has no tags, so extraction falls back to the filename for the
    // title and drops the other fields, and the size comes from the file.
    let on_disk = fs::metadata(&path).unwrap().len() as i64;
    assert_eq!(track.title, Some("rescanned".to_string()));
    assert_eq!(track.artist, None);
    assert_eq!(track.album, None);
    assert_eq!(track.file_size, on_disk);
}

#[test]
fn test_rescan_track_unknown_id_error_string() {
    let db = sample_db();
    let err = rescan_track(&db, 1_234).unwrap_err();
    assert_eq!(err, "Track with id 1234 not found");
}
