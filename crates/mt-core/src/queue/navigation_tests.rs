//! Tests for the navigation entry points and the response builder.
//!
//! The fake sink is what makes these testable at all: it records the file the
//! queue asked the engine to start, which is the one part of a navigation
//! command no database assertion can show. The announcements are asserted
//! alongside, since the frontend's seek bar and track title come from them.

use super::*;
use crate::queue::get_playback_state;
use crate::queue::test_util::{Announcement, FakeSink, RecordingReporter, fill_queue, sample_db};

/// Queue three tracks and put the player on the given index.
fn queue_at(index: i64) -> (Database, Vec<i64>) {
    let db = sample_db();
    let ids = fill_queue(&db, 3);
    if index >= 0 {
        let conn = db.conn().unwrap();
        queue::set_current_index(&conn, index).unwrap();
        drop(conn);
    }
    (db, ids)
}

fn loop_mode(db: &Database, mode: &str) {
    let conn = db.conn().unwrap();
    queue::set_loop_mode(&conn, mode).unwrap();
    drop(conn);
}
// =========================================================================
// play next
// =========================================================================

#[test]
fn test_play_next_moves_the_index_and_starts_that_file() {
    let (db, ids) = queue_at(0);
    let sink = FakeSink::with_duration(180_000);
    let reporter = RecordingReporter::new();

    let result = play_next(&db, &sink, &reporter).unwrap();

    assert_eq!(result.action, "play");
    assert_eq!(result.track.as_ref().unwrap().id, ids[1]);
    assert_eq!(
        result.duration_ms,
        Some(180_000),
        "the duration comes from the engine, not the tag"
    );
    assert_eq!(result.snapshot.current_index, 1);
    assert_eq!(
        sink.plays(),
        vec![("/music/track2.mp3".to_string(), ids[1])]
    );
    assert_eq!(
        reporter.announcements(),
        vec![Announcement::StateChanged {
            current_index: 1,
            shuffle_enabled: false,
            loop_mode: "none".to_string(),
        }]
    );
}

#[test]
fn test_play_next_from_nothing_started_plays_the_second_row() {
    // The pre-existing behavior the frontend relies on: with no current index,
    // the first row is treated as what just played, so next lands on row 1.
    let (db, ids) = queue_at(-1);
    let sink = FakeSink::with_duration(1_000);
    let reporter = RecordingReporter::new();

    let result = play_next(&db, &sink, &reporter).unwrap();

    assert_eq!(result.track.as_ref().unwrap().id, ids[1]);
    assert_eq!(reporter.states(), vec![(1, false, "none".to_string())]);
}

#[test]
fn test_play_next_past_the_end_stops_without_starting_audio() {
    let (db, _) = queue_at(2);
    let sink = FakeSink::with_duration(1_000);
    let reporter = RecordingReporter::new();

    let result = play_next(&db, &sink, &reporter).unwrap();

    assert_eq!(result.action, "stop");
    assert!(result.track.is_none());
    assert_eq!(result.duration_ms, None);
    assert!(sink.plays().is_empty(), "nothing to start");
    assert_eq!(
        reporter.states().len(),
        1,
        "still told where the index ended up"
    );
}

#[test]
fn test_play_next_at_the_end_wraps_when_looping_all() {
    let (db, ids) = queue_at(2);
    loop_mode(&db, "all");
    let sink = FakeSink::with_duration(1_000);
    let reporter = RecordingReporter::new();

    let result = play_next(&db, &sink, &reporter).unwrap();

    assert_eq!(result.action, "play");
    assert_eq!(result.track.as_ref().unwrap().id, ids[0]);
    assert_eq!(result.snapshot.current_index, 0);
    assert_eq!(reporter.states(), vec![(0, false, "all".to_string())]);
}

#[test]
fn test_play_next_with_loop_one_replays_the_current_row_and_drops_the_flag() {
    let (db, ids) = queue_at(0);
    loop_mode(&db, "one");
    let sink = FakeSink::with_duration(1_000);
    let reporter = RecordingReporter::new();

    let result = play_next(&db, &sink, &reporter).unwrap();

    assert_eq!(result.action, "play");
    assert_eq!(result.track.as_ref().unwrap().id, ids[0], "same row again");
    assert_eq!(result.snapshot.current_index, 0);
    assert_eq!(
        reporter.states(),
        vec![(0, false, "none".to_string())],
        "the announced state already shows repeat-one released, so the next \
         advance moves on"
    );
}

#[test]
fn test_play_next_survives_the_engine_refusing_the_file() {
    let (db, _) = queue_at(0);
    let sink = FakeSink::failing();
    let reporter = RecordingReporter::new();

    let error = play_next(&db, &sink, &reporter).unwrap_err();

    assert_eq!(error, "audio engine refused the file");
    assert!(
        reporter.announcements().is_empty(),
        "no state change is announced for playback that never started"
    );
    assert_eq!(
        get_playback_state(&db).unwrap().current_index,
        1,
        "the queue did move: the advance is committed before audio is asked"
    );
}

// =========================================================================
// play previous
// =========================================================================

#[test]
fn test_play_previous_mid_track_restarts_the_current_row() {
    let (db, ids) = queue_at(1);
    let sink = FakeSink::with_duration(1_000);
    let reporter = RecordingReporter::new();

    let result = play_previous(&db, 5_000, &sink, &reporter).unwrap();

    assert_eq!(result.action, "seek_zero");
    assert_eq!(result.track.as_ref().unwrap().id, ids[1]);
    assert_eq!(
        result.duration_ms, None,
        "a restart does not reload the file"
    );
    assert!(sink.plays().is_empty());
    assert_eq!(reporter.states().len(), 1);
}

#[test]
fn test_play_previous_at_the_start_of_a_track_walks_back_through_history() {
    let (db, ids) = queue_at(0);
    play_next(&db, &FakeSink::with_duration(1), &RecordingReporter::new()).unwrap();
    let sink = FakeSink::with_duration(1_000);

    let result = play_previous(&db, 0, &sink, &RecordingReporter::new()).unwrap();

    assert_eq!(result.action, "play");
    assert_eq!(
        result.track.as_ref().unwrap().id,
        ids[0],
        "history puts the listener back on the track they came from"
    );
}

#[test]
fn test_play_previous_without_history_decrements_the_index() {
    let (db, ids) = queue_at(2);
    let sink = FakeSink::with_duration(1_000);

    let result = play_previous(&db, 0, &sink, &RecordingReporter::new()).unwrap();

    assert_eq!(result.action, "play");
    assert_eq!(result.track.as_ref().unwrap().id, ids[1]);
    assert_eq!(sink.plays().len(), 1);
}

#[test]
fn test_play_previous_at_the_first_row_stays_there() {
    let (db, ids) = queue_at(0);
    let sink = FakeSink::with_duration(1_000);

    let result = play_previous(&db, 0, &sink, &RecordingReporter::new()).unwrap();

    assert_eq!(result.action, "play");
    assert_eq!(result.track.as_ref().unwrap().id, ids[0]);
    assert_eq!(result.snapshot.current_index, 0);
}

// =========================================================================
// skip
// =========================================================================

#[test]
fn test_skip_next_overrides_repeat_one() {
    let (db, ids) = queue_at(0);
    loop_mode(&db, "one");
    let sink = FakeSink::with_duration(1_000);
    let reporter = RecordingReporter::new();

    let result = skip_next(&db, &sink, &reporter).unwrap();

    assert_eq!(result.action, "play");
    assert_eq!(
        result.track.as_ref().unwrap().id,
        ids[1],
        "skip means move on, even with repeat-one set"
    );
    assert_eq!(reporter.states(), vec![(1, false, "all".to_string())]);
}

#[test]
fn test_skip_previous_overrides_repeat_one() {
    let (db, ids) = queue_at(2);
    loop_mode(&db, "one");
    let sink = FakeSink::with_duration(1_000);

    let result = skip_previous(&db, 0, &sink, &RecordingReporter::new()).unwrap();

    assert_eq!(result.track.as_ref().unwrap().id, ids[1]);
}

// =========================================================================
// build_navigation_result
// =========================================================================

fn state(current_index: i64) -> QueueState {
    QueueState {
        current_index,
        shuffle_enabled: true,
        loop_mode: "all".to_string(),
        original_order_json: None,
        play_next_offset: 4,
        play_history_json: None,
        play_next_track_ids_json: None,
        repeat_one_pending: false,
    }
}

#[test]
fn test_navigation_result_for_play_carries_that_row() {
    let db = sample_db();
    fill_queue(&db, 2);
    let items = {
        let conn = db.conn().unwrap();
        let items = queue::get_queue(&conn).unwrap();
        drop(conn);
        items
    };

    let result = build_navigation_result(
        &queue::NavigationAction::Play(1),
        &items,
        &state(1),
        Some(500),
    );

    assert_eq!(result.action, "play");
    assert_eq!(result.track.as_ref().unwrap().filepath, "/music/track2.mp3");
    assert_eq!(result.duration_ms, Some(500));
    assert!(result.snapshot.shuffle_enabled);
    assert_eq!(result.snapshot.loop_mode, "all");
    assert_eq!(result.snapshot.play_next_offset, 4);
}

#[test]
fn test_navigation_result_for_stop_carries_no_track() {
    let db = sample_db();
    fill_queue(&db, 2);
    let conn = db.conn().unwrap();
    let items = queue::get_queue(&conn).unwrap();
    drop(conn);

    let result = build_navigation_result(&queue::NavigationAction::Stop, &items, &state(0), None);

    assert_eq!(result.action, "stop");
    assert!(result.track.is_none());
}

#[test]
fn test_navigation_result_for_seek_zero_uses_the_current_index() {
    let db = sample_db();
    fill_queue(&db, 2);
    let conn = db.conn().unwrap();
    let items = queue::get_queue(&conn).unwrap();
    drop(conn);

    let result =
        build_navigation_result(&queue::NavigationAction::SeekZero, &items, &state(0), None);

    assert_eq!(result.action, "seek_zero");
    assert_eq!(result.track.as_ref().unwrap().filepath, "/music/track1.mp3");
}

#[test]
fn test_navigation_result_for_seek_zero_without_a_current_row_has_no_track() {
    let db = sample_db();
    fill_queue(&db, 2);
    let conn = db.conn().unwrap();
    let items = queue::get_queue(&conn).unwrap();
    drop(conn);

    let result =
        build_navigation_result(&queue::NavigationAction::SeekZero, &items, &state(-1), None);

    assert_eq!(result.action, "seek_zero");
    assert!(result.track.is_none());
}
