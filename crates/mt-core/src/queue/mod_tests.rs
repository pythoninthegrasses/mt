//! Tests for the queue reads and for the reporter seam.

use super::*;
use crate::db::queue;
use crate::queue::test_util::{fill_queue, queue_filepaths, sample_db};

#[test]
fn test_get_returns_rows_in_play_order_with_count() {
    let db = sample_db();
    fill_queue(&db, 3);

    let response = get(&db).unwrap();

    assert_eq!(response.count, 3);
    assert_eq!(response.items.len(), 3);
    assert_eq!(
        response.items.first().unwrap().track.title,
        Some("Track 1".to_string())
    );
    assert_eq!(response.items.first().unwrap().position, 0);
    assert_eq!(response.items.last().unwrap().position, 2);
}

#[test]
fn test_get_on_empty_queue_is_not_an_error() {
    let db = sample_db();

    let response = get(&db).unwrap();

    assert!(response.items.is_empty());
    assert_eq!(response.count, 0);
}

#[test]
fn test_get_playback_state_creates_the_row_it_read_for() {
    // A database that has never played anything has no queue_state row. The read
    // seeds the defaults rather than failing, and the frontend depends on always
    // receiving a state object.
    let db = sample_db();

    let state = get_playback_state(&db).unwrap();

    assert_eq!(state.current_index, -1, "nothing has played yet");
    assert!(!state.shuffle_enabled);
    assert_eq!(state.loop_mode, "none");
    assert_eq!(state.play_next_offset, 0);

    // And the row is now there, so a second read sees the same thing.
    let again = get_playback_state(&db).unwrap();
    assert_eq!(again.current_index, -1);
}

#[test]
fn test_check_integrity_accepts_a_healthy_queue() {
    let db = sample_db();
    fill_queue(&db, 3);
    // A row is playing: `check_integrity` reads a negative index as a queue
    // stranded without a current track, so a healthy queue is one with a row set.
    let conn = db.conn().unwrap();
    queue::set_current_index(&conn, 1).unwrap();
    drop(conn);

    let report = check_integrity(&db).unwrap();

    assert!(report.duplicate_track_ids.is_empty());
    assert!(report.orphaned_play_next_ids.is_empty());
    assert!(!report.index_was_out_of_bounds);
    assert!(!report.repaired);
}

#[test]
fn test_check_integrity_gives_a_never_played_queue_a_current_row() {
    let db = sample_db();
    fill_queue(&db, 3);

    let report = check_integrity(&db).unwrap();

    assert!(
        report.index_was_out_of_bounds,
        "rows with no current index (-1) are the case this repairs"
    );
    assert!(report.repaired);
    assert_eq!(get_playback_state(&db).unwrap().current_index, 0);
}

#[test]
fn test_check_integrity_finds_the_row_the_watcher_duplicated() {
    let db = sample_db();
    let ids = fill_queue(&db, 2);
    let conn = db.conn().unwrap();
    queue::add_to_queue(&conn, &[ids[0]], None).unwrap();
    drop(conn);

    let report = check_integrity(&db).unwrap();

    assert_eq!(report.duplicate_track_ids, vec![ids[0]]);
    assert!(report.repaired, "the check fixes what it finds");
}

#[test]
fn test_check_integrity_flags_an_index_past_the_end() {
    let db = sample_db();
    fill_queue(&db, 2);
    let conn = db.conn().unwrap();
    queue::set_current_index(&conn, 9).unwrap();
    drop(conn);

    let report = check_integrity(&db).unwrap();

    assert!(report.index_was_out_of_bounds);
    assert!(report.repaired);
    assert!(
        get_playback_state(&db).unwrap().current_index < 2,
        "the index is clamped back inside the queue"
    );
}

#[test]
fn test_silent_reporter_can_drive_a_write() {
    // The type exists so a caller can reuse the orchestration without a frontend
    // attached; prove it satisfies the trait and lets the write through.
    let db = sample_db();
    fill_queue(&db, 2);

    clear(&db, &SilentReporter).unwrap();

    assert!(queue_filepaths(&db).is_empty());
}
