//! Tests for the mutation paths that keep a row in step with its file: play
//! counts, locating a moved file, the missing flag, and status checks.
//!
//! `locate_track` gets the most coverage because it is the one mutation with a
//! second half — when the file it points at is already another row, that row is
//! dropped and the located row's history survives.

use super::*;
use crate::db::{TrackMetadata, favorites, library};
use crate::library::queries::get_track;
use crate::library::test_util::{add_sized_track, sample_db, track_count, write_temp_file};

// =========================================================================
// update_play_count
// =========================================================================

#[test]
fn test_update_play_count_increments_and_returns_track() {
    let db = sample_db();
    let id = add_sized_track(&db, 1, 60.0);

    let track = update_play_count(&db, id).unwrap();
    assert_eq!(track.play_count, 1);

    let track = update_play_count(&db, id).unwrap();
    assert_eq!(track.play_count, 2);
    assert_eq!(track.id, id);
}

/// A play on an unknown track fails rather than inventing a row.
///
/// `library::update_play_count` writes a `play_history` row, whose foreign key
/// to `library` is what rejects the unknown id — so the message is the SQLite
/// error, not the `"Track with id {} not found"` fallback. The behavior is
/// unchanged by the extraction; the fallback stays as the belt-and-braces path
/// for a row deleted between the write and the read-back.
#[test]
fn test_update_play_count_unknown_id_is_rejected() {
    let db = sample_db();
    let err = update_play_count(&db, 55).unwrap_err();
    assert!(
        err.contains("FOREIGN KEY") || err.contains("not found"),
        "unexpected error: {err}"
    );

    let conn = db.conn().unwrap();
    let history: i64 = conn
        .query_row("SELECT COUNT(*) FROM play_history", [], |row| row.get(0))
        .unwrap();
    assert_eq!(history, 0, "a rejected play must not leave history behind");
}

// =========================================================================
// locate_track
// =========================================================================

#[test]
fn test_locate_track_moves_the_track_to_the_new_path() {
    let dir = tempfile::tempdir().unwrap();
    let path = write_temp_file(dir.path(), "found.mp3");

    let db = sample_db();
    let conn = db.conn().unwrap();
    let metadata = TrackMetadata {
        title: Some("Lost Song".to_string()),
        artist: Some("Artist".to_string()),
        duration: Some(60.0),
        ..Default::default()
    };
    let id = library::add_track(&conn, "/music/old-location.mp3", &metadata).unwrap();
    library::mark_track_missing(&conn, id).unwrap();
    drop(conn);

    let outcome = locate_track(&db, id, &path).unwrap();

    assert_eq!(outcome.deleted_duplicate_id, None);
    assert_eq!(outcome.track.filepath, path);
    assert!(!outcome.track.missing, "locating clears the missing flag");
    assert_eq!(outcome.track.title, Some("Lost Song".to_string()));
}

#[test]
fn test_locate_track_missing_file_error_names_the_path() {
    let db = sample_db();
    let id = add_sized_track(&db, 1, 60.0);

    let err = locate_track(&db, id, "/nope/nowhere.mp3").unwrap_err();
    assert_eq!(err, "File not found: /nope/nowhere.mp3");
    assert_eq!(
        get_track(&db, id).unwrap().unwrap().filepath,
        "/music/track1.mp3",
        "a rejected locate must leave the row alone"
    );
}

#[test]
fn test_locate_track_unknown_track_error_string() {
    let dir = tempfile::tempdir().unwrap();
    let path = write_temp_file(dir.path(), "found.mp3");

    let db = sample_db();
    let err = locate_track(&db, 777, &path).unwrap_err();
    assert_eq!(err, "Track with id 777 not found");
}

/// The duplicate scenario: the watcher already added the moved file as a new
/// row, so locating the old row has to drop the watcher's row and keep the
/// original's history rather than the other way round.
#[test]
fn test_locate_track_replaces_duplicate_at_new_path_and_keeps_history() {
    let dir = tempfile::tempdir().unwrap();
    let path = write_temp_file(dir.path(), "moved.mp3");

    let db = sample_db();
    let conn = db.conn().unwrap();
    let metadata = TrackMetadata {
        title: Some("Moved Song".to_string()),
        artist: Some("Artist".to_string()),
        duration: Some(60.0),
        ..Default::default()
    };
    let original = library::add_track(&conn, "/music/old.mp3", &metadata).unwrap();
    let duplicate = library::add_track(&conn, &path, &metadata).unwrap();
    drop(conn);

    // The original row is the one with history to preserve.
    for _ in 0..4 {
        update_play_count(&db, original).unwrap();
    }
    let conn = db.conn().unwrap();
    favorites::add_favorite(&conn, original).unwrap();
    drop(conn);

    let outcome = locate_track(&db, original, &path).unwrap();

    assert_eq!(outcome.deleted_duplicate_id, Some(duplicate));
    assert_eq!(outcome.track.filepath, path);
    assert_eq!(
        outcome.track.play_count, 4,
        "play history survives the locate"
    );
    assert!(get_track(&db, duplicate).unwrap().is_none());
    assert_eq!(
        track_count(&db),
        1,
        "the duplicate is gone, not just hidden"
    );
}

#[test]
fn test_locate_track_same_path_is_not_a_duplicate() {
    let dir = tempfile::tempdir().unwrap();
    let path = write_temp_file(dir.path(), "same.mp3");

    let db = sample_db();
    let conn = db.conn().unwrap();
    let metadata = TrackMetadata {
        title: Some("Song".to_string()),
        duration: Some(60.0),
        ..Default::default()
    };
    let id = library::add_track(&conn, &path, &metadata).unwrap();
    library::mark_track_missing(&conn, id).unwrap();
    drop(conn);

    let outcome = locate_track(&db, id, &path).unwrap();
    assert_eq!(
        outcome.deleted_duplicate_id, None,
        "a track located to its own path must not delete itself"
    );
    assert_eq!(track_count(&db), 1);
}

// =========================================================================
// check_status
// =========================================================================

#[test]
fn test_check_status_marks_gone_file_missing() {
    let db = sample_db();
    let id = add_sized_track(&db, 1, 60.0);

    let track = check_status(&db, id).unwrap();
    assert!(track.missing, "/music/track1.mp3 does not exist on disk");

    let stored = get_track(&db, id).unwrap().unwrap();
    assert!(stored.missing, "the status change must be persisted");
}

#[test]
fn test_check_status_confirms_existing_file() {
    let dir = tempfile::tempdir().unwrap();
    let path = write_temp_file(dir.path(), "present.mp3");

    let db = sample_db();
    let conn = db.conn().unwrap();
    let metadata = TrackMetadata {
        title: Some("Song".to_string()),
        duration: Some(60.0),
        ..Default::default()
    };
    let id = library::add_track(&conn, &path, &metadata).unwrap();
    library::mark_track_missing(&conn, id).unwrap();
    drop(conn);

    let track = check_status(&db, id).unwrap();
    assert!(!track.missing);
}

#[test]
fn test_check_status_unknown_id_error_string() {
    let db = sample_db();
    let err = check_status(&db, 31).unwrap_err();
    assert_eq!(err, "Track with id 31 not found");
}

// =========================================================================
// mark_missing / mark_present
// =========================================================================

#[test]
fn test_mark_missing_and_present_round_trip() {
    let db = sample_db();
    let id = add_sized_track(&db, 1, 60.0);

    let marked = mark_missing(&db, id).unwrap();
    assert!(marked.missing);
    assert_eq!(marked.id, id);

    let restored = mark_present(&db, id).unwrap();
    assert!(!restored.missing);
}

#[test]
fn test_mark_missing_unknown_id_error_string() {
    let db = sample_db();
    let err = mark_missing(&db, 12).unwrap_err();
    assert_eq!(err, "Track with id 12 not found");
}

#[test]
fn test_mark_present_unknown_id_error_string() {
    let db = sample_db();
    let err = mark_present(&db, 12).unwrap_err();
    assert_eq!(err, "Track with id 12 not found");
}

#[test]
fn test_mark_missing_is_idempotent() {
    let db = sample_db();
    let id = add_sized_track(&db, 1, 60.0);

    mark_missing(&db, id).unwrap();
    let again = mark_missing(&db, id).unwrap();
    assert!(again.missing);
    assert_eq!(track_count(&db), 1);
}
