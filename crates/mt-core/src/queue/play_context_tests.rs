//! Tests for the atomic play-context commands.
//!
//! A play context replaces the whole queue and starts one track in a single
//! request, so these pin three things at once: the order the rows are installed
//! in (rotated, or shuffled around the start track), the file the engine was
//! asked to start, and the announcement pair the frontend needs to adopt the new
//! queue without refetching it.

use super::*;
use crate::queue::test_util::{
    Announcement, FakeSink, RecordingReporter, fill_queue, queue_filepaths, sample_db, seed_tracks,
};
// =========================================================================
// play context
// =========================================================================

#[test]
fn test_play_context_rotates_the_list_onto_the_start_track() {
    let db = sample_db();
    let ids = fill_queue(&db, 3);
    let sink = FakeSink::with_duration(123_456);
    let reporter = RecordingReporter::new();

    let response = play_context(&db, &ids, 1, false, &sink, &reporter).unwrap();

    assert_eq!(response.current_index, 0);
    assert_eq!(response.track.id, ids[1]);
    assert_eq!(response.duration_ms, 123_456);
    assert!(!response.shuffle_enabled);
    assert_eq!(
        queue_filepaths(&db),
        vec![
            "/music/track2.mp3",
            "/music/track3.mp3",
            "/music/track1.mp3"
        ],
        "the start track leads and the list keeps its order"
    );
    assert_eq!(
        sink.plays(),
        vec![("/music/track2.mp3".to_string(), ids[1])]
    );
    assert_eq!(
        reporter.announcements(),
        vec![
            Announcement::Cleared,
            Announcement::StateChanged {
                current_index: 0,
                shuffle_enabled: false,
                loop_mode: "none".to_string(),
            },
        ],
        "a replaced queue is announced as cleared, then the state it established"
    );
}

#[test]
fn test_play_context_shuffled_keeps_the_start_track_leading() {
    let db = sample_db();
    let ids = fill_queue(&db, 6);
    let sink = FakeSink::with_duration(1_000);
    let reporter = RecordingReporter::new();

    let response = play_context(&db, &ids, 2, true, &sink, &reporter).unwrap();

    assert!(response.shuffle_enabled);
    assert_eq!(response.track.id, ids[2]);
    assert_eq!(response.items.first().unwrap().track.id, ids[2]);
    assert_eq!(response.items.len(), 6);
    assert_eq!(
        reporter.states(),
        vec![(0, true, "none".to_string())],
        "the shuffle flag the caller asked for is the one announced"
    );
}

#[test]
fn test_play_context_replaces_what_was_queued_before() {
    let db = sample_db();
    let first = fill_queue(&db, 2);
    let more = seed_tracks(&db, 5);

    play_context(
        &db,
        &more[2..5],
        0,
        false,
        &FakeSink::with_duration(1),
        &RecordingReporter::new(),
    )
    .unwrap();

    assert_eq!(
        queue_filepaths(&db),
        vec![
            "/music/track3.mp3",
            "/music/track4.mp3",
            "/music/track5.mp3"
        ]
    );
    let _ = first;
}

#[test]
fn test_play_context_rejects_an_empty_track_list() {
    let db = sample_db();

    let error = play_context(
        &db,
        &[],
        0,
        false,
        &FakeSink::with_duration(1),
        &RecordingReporter::new(),
    )
    .unwrap_err();

    assert_eq!(error, "Record not found: Empty track list");
}

#[test]
fn test_play_context_rejects_a_start_index_past_the_list() {
    let db = sample_db();
    let ids = fill_queue(&db, 3);

    let error = play_context(
        &db,
        &ids,
        5,
        false,
        &FakeSink::with_duration(1),
        &RecordingReporter::new(),
    )
    .unwrap_err();

    assert_eq!(
        error,
        "Record not found: start_index 5 out of bounds for 3 tracks"
    );
}

#[test]
fn test_play_context_rejects_ids_the_library_does_not_have() {
    let db = sample_db();

    let error = play_context(
        &db,
        &[4_242],
        0,
        false,
        &FakeSink::with_duration(1),
        &RecordingReporter::new(),
    )
    .unwrap_err();

    assert_eq!(
        error,
        "Record not found: No valid tracks found for given IDs"
    );
}

#[test]
fn test_play_context_installs_the_queue_even_if_audio_fails() {
    let db = sample_db();
    let ids = fill_queue(&db, 2);
    let reporter = RecordingReporter::new();

    let error = play_context(&db, &ids, 0, false, &FakeSink::failing(), &reporter).unwrap_err();

    assert_eq!(error, "audio engine refused the file");
    assert_eq!(
        queue_filepaths(&db),
        vec!["/music/track1.mp3", "/music/track2.mp3"],
        "the queue the user asked for is installed; only playback failed"
    );
    assert!(
        reporter.announcements().is_empty(),
        "and nothing is announced, so the frontend does not adopt a queue it \
         was told failed"
    );
}

// =========================================================================
// play context from a library query
// =========================================================================

fn query(start_track_id: i64) -> PlayContextQuery {
    PlayContextQuery {
        start_track_id,
        search: None,
        sort_by: Some("title".to_string()),
        sort_order: Some("asc".to_string()),
        ignore_words: None,
        shuffle: false,
    }
}

#[test]
fn test_play_context_from_query_installs_the_sorted_list() {
    let db = sample_db();
    let ids = seed_tracks(&db, 4);
    let sink = FakeSink::with_duration(222);
    let reporter = RecordingReporter::new();

    let response = play_context_from_query(&db, &query(ids[2]), &sink, &reporter).unwrap();

    assert_eq!(response.track.id, ids[2]);
    assert_eq!(response.duration_ms, 222);
    assert_eq!(
        queue_filepaths(&db),
        vec![
            "/music/track3.mp3",
            "/music/track4.mp3",
            "/music/track1.mp3",
            "/music/track2.mp3",
        ],
        "the whole sorted list is installed server-side, rotated onto the start"
    );
    assert_eq!(
        reporter.announcements(),
        vec![
            Announcement::Cleared,
            Announcement::StateChanged {
                current_index: 0,
                shuffle_enabled: false,
                loop_mode: "none".to_string(),
            },
        ]
    );
}

#[test]
fn test_play_context_from_query_honours_the_search_filter() {
    let db = sample_db();
    let ids = seed_tracks(&db, 3);
    let mut request = query(ids[1]);
    request.search = Some("Artist 2".to_string());

    let response = play_context_from_query(
        &db,
        &request,
        &FakeSink::with_duration(1),
        &RecordingReporter::new(),
    )
    .unwrap();

    assert_eq!(response.items.len(), 1);
    assert_eq!(response.track.id, ids[1]);
    assert_eq!(queue_filepaths(&db), vec!["/music/track2.mp3"]);
}

/// A start track the filter excluded falls back to the first row rather than
/// failing: the user pressed play on something, and the closest match is better
/// than an error.
#[test]
fn test_play_context_from_query_falls_back_when_the_start_track_is_filtered_out() {
    let db = sample_db();
    let ids = seed_tracks(&db, 3);
    let mut request = query(ids[0]);
    request.search = Some("Artist 3".to_string());

    let response = play_context_from_query(
        &db,
        &request,
        &FakeSink::with_duration(1),
        &RecordingReporter::new(),
    )
    .unwrap();

    assert_eq!(response.track.id, ids[2]);
}

#[test]
fn test_play_context_from_query_tolerates_an_unknown_sort_column() {
    let db = sample_db();
    let ids = seed_tracks(&db, 2);
    let mut request = query(ids[0]);
    request.sort_by = Some("not_a_column".to_string());

    let response = play_context_from_query(
        &db,
        &request,
        &FakeSink::with_duration(1),
        &RecordingReporter::new(),
    )
    .unwrap();

    assert_eq!(response.items.len(), 2, "falls back to the default column");
}

#[test]
fn test_play_context_from_query_rejects_an_empty_result() {
    let db = sample_db();
    let request = query(1);

    let error = play_context_from_query(
        &db,
        &request,
        &FakeSink::with_duration(1),
        &RecordingReporter::new(),
    )
    .unwrap_err();

    // The query matched nothing, so the ID list handed to the installer is empty
    // and the install refuses it before it ever looks up tracks.
    assert_eq!(error, "Record not found: Empty track list");
}
