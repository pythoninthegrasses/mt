//! Tests for the queue writes.
//!
//! Each test asserts the response *and* the announcement sequence, because the
//! frontend updates its own copy of the queue from those announcements: a write
//! that returns the right rows but announces the wrong positions leaves the UI
//! showing a stale queue. The error strings are asserted too — they are what the
//! user sees in a toast.

use super::*;
use crate::queue::get_playback_state;
use crate::queue::test_util::{
    Announcement, RecordingReporter, fill_queue, queue_filepaths, sample_db, seed_tracks,
};

// =========================================================================
// add_tracks
// =========================================================================

#[test]
fn test_add_tracks_appends_and_announces_the_appended_positions() {
    let db = sample_db();
    let ids = seed_tracks(&db, 3);
    let reporter = RecordingReporter::new();

    let response = add_tracks(&db, &ids, None, &reporter).unwrap();

    assert_eq!(response.added, 3);
    assert_eq!(response.queue_length, 3);
    assert_eq!(
        reporter.announcements(),
        vec![Announcement::Added {
            positions: vec![0, 1, 2],
            queue_length: 3,
        }],
        "an append announces the rows it landed on, and no state change"
    );
}

#[test]
fn test_add_tracks_at_position_announces_that_position() {
    let db = sample_db();
    let ids = seed_tracks(&db, 3);
    let reporter = RecordingReporter::new();
    add_tracks(&db, &ids[0..1], None, &RecordingReporter::new()).unwrap();

    let response = add_tracks(&db, &ids[1..3], Some(1), &reporter).unwrap();

    assert_eq!(response.added, 2);
    assert_eq!(response.queue_length, 3);
    assert_eq!(
        reporter.announcements(),
        vec![Announcement::Added {
            positions: vec![1, 2],
            queue_length: 3,
        }]
    );
    assert_eq!(
        queue_filepaths(&db)[1],
        "/music/track2.mp3",
        "the rows landed at the requested position"
    );
}

#[test]
fn test_add_tracks_rejects_an_empty_id_list() {
    let db = sample_db();
    let reporter = RecordingReporter::new();

    let error = add_tracks(&db, &[], None, &reporter).unwrap_err();

    assert_eq!(error, "track_ids must not be empty");
    assert!(
        reporter.announcements().is_empty(),
        "a rejected request announces nothing"
    );
}

// =========================================================================
// add_files
// =========================================================================

#[test]
fn test_add_files_adds_a_path_that_is_not_in_the_library_yet() {
    let db = sample_db();
    seed_tracks(&db, 1);
    let reporter = RecordingReporter::new();

    let response = add_files(
        &db,
        &[
            "/music/track1.mp3".to_string(),
            "/inbox/new.mp3".to_string(),
        ],
        None,
        &reporter,
    )
    .unwrap();

    assert_eq!(response.added, 2);
    assert_eq!(response.queue_length, 2);
    assert_eq!(response.tracks.len(), 2);
    assert_eq!(
        reporter.announcements(),
        vec![Announcement::Added {
            positions: vec![0, 1],
            queue_length: 2,
        }]
    );
    assert_eq!(
        queue_filepaths(&db),
        vec!["/music/track1.mp3", "/inbox/new.mp3"]
    );
}

#[test]
fn test_add_files_rejects_an_empty_path_list() {
    let db = sample_db();
    let reporter = RecordingReporter::new();

    let error = add_files(&db, &[], None, &reporter).unwrap_err();

    assert_eq!(error, "filepaths must not be empty");
    assert!(reporter.announcements().is_empty());
}

// =========================================================================
// remove_track
// =========================================================================

#[test]
fn test_remove_track_announces_the_position_and_new_length() {
    let db = sample_db();
    fill_queue(&db, 3);
    let reporter = RecordingReporter::new();

    remove_track(&db, 0, &reporter).unwrap();

    assert_eq!(queue_filepaths(&db).len(), 2);
    assert_eq!(
        reporter.announcements(),
        vec![Announcement::Removed {
            position: 0,
            queue_length: 2,
        }]
    );
}

#[test]
fn test_remove_track_outside_the_queue_is_an_error() {
    let db = sample_db();
    fill_queue(&db, 2);
    let reporter = RecordingReporter::new();

    let error = remove_track(&db, 5, &reporter).unwrap_err();

    assert_eq!(error, "No track at position 5");
    assert!(
        reporter.announcements().is_empty(),
        "the frontend is not told about a row that was never there"
    );
}

#[test]
fn test_clear_empties_the_queue_and_announces_it() {
    let db = sample_db();
    fill_queue(&db, 3);
    let reporter = RecordingReporter::new();

    clear(&db, &reporter).unwrap();

    assert!(queue_filepaths(&db).is_empty());
    assert_eq!(reporter.announcements(), vec![Announcement::Cleared]);
}

// =========================================================================
// reorder
// =========================================================================

#[test]
fn test_reorder_moves_the_row_and_announces_both_ends() {
    let db = sample_db();
    fill_queue(&db, 3);
    let reporter = RecordingReporter::new();

    let response = reorder(&db, 0, 2, &reporter).unwrap();

    assert_eq!(
        response,
        QueueOperationResponse {
            success: true,
            queue_length: 3,
        }
    );
    assert_eq!(
        queue_filepaths(&db),
        vec![
            "/music/track2.mp3",
            "/music/track3.mp3",
            "/music/track1.mp3"
        ]
    );
    assert_eq!(
        reporter.announcements(),
        vec![Announcement::Reordered {
            from: 0,
            to: 2,
            queue_length: 3,
        }]
    );
}

#[test]
fn test_reorder_with_an_out_of_range_position_is_an_error() {
    let db = sample_db();
    fill_queue(&db, 2);
    let reporter = RecordingReporter::new();

    let error = reorder(&db, 0, 9, &reporter).unwrap_err();

    assert_eq!(error, "Invalid positions");
    assert!(reporter.announcements().is_empty());
}

// =========================================================================
// shuffle
// =========================================================================

#[test]
fn test_shuffle_of_an_empty_queue_succeeds_without_announcing() {
    let db = sample_db();
    let reporter = RecordingReporter::new();

    let response = shuffle(&db, None, &reporter).unwrap();

    assert_eq!(
        response,
        QueueOperationResponse {
            success: true,
            queue_length: 0,
        }
    );
    assert!(
        reporter.announcements().is_empty(),
        "there was nothing to reorder, so the frontend should not refetch"
    );
}

#[test]
fn test_shuffle_keeps_the_playing_row_first_by_default() {
    let db = sample_db();
    fill_queue(&db, 8);
    let reporter = RecordingReporter::new();
    let original = queue_filepaths(&db);

    let response = shuffle(&db, None, &reporter).unwrap();

    assert_eq!(response.queue_length, 8);
    let shuffled = queue_filepaths(&db);
    assert_eq!(shuffled[0], original[0], "the playing row stays put");
    assert_eq!(shuffled.len(), original.len());
    for path in &original {
        assert!(shuffled.contains(path), "{path} survived the shuffle");
    }
    assert_eq!(
        reporter.announcements(),
        vec![Announcement::Shuffled { queue_length: 8 }]
    );
}

#[test]
fn test_shuffle_can_move_the_playing_row_too() {
    let db = sample_db();
    fill_queue(&db, 12);
    let reporter = RecordingReporter::new();
    let original = queue_filepaths(&db);

    shuffle(&db, Some(false), &reporter).unwrap();

    let shuffled = queue_filepaths(&db);
    assert_eq!(shuffled.len(), 12);
    for path in &original {
        assert!(shuffled.contains(path));
    }
    assert_eq!(
        reporter.announcements(),
        vec![Announcement::Shuffled { queue_length: 12 }]
    );
}

// =========================================================================
// state: current index, shuffle flag, loop mode
// =========================================================================

#[test]
fn test_set_current_index_persists_and_announces_the_state() {
    let db = sample_db();
    fill_queue(&db, 3);
    let reporter = RecordingReporter::new();

    set_current_index(&db, 2, &reporter).unwrap();

    assert_eq!(get_playback_state(&db).unwrap().current_index, 2);
    assert_eq!(
        reporter.announcements(),
        vec![Announcement::StateChanged {
            current_index: 2,
            shuffle_enabled: false,
            loop_mode: "none".to_string(),
        }]
    );
}

#[test]
fn test_set_shuffle_announces_the_reorder_before_the_flag() {
    let db = sample_db();
    fill_queue(&db, 6);
    let reporter = RecordingReporter::new();
    let original = queue_filepaths(&db);

    let snapshot = set_shuffle(&db, true, &reporter).unwrap();

    assert!(snapshot.shuffle_enabled);
    assert_eq!(snapshot.items.len(), 6);
    assert_eq!(snapshot.current_index, 0);
    assert_eq!(
        reporter.announcements(),
        vec![
            Announcement::Shuffled { queue_length: 6 },
            Announcement::StateChanged {
                current_index: 0,
                shuffle_enabled: true,
                loop_mode: "none".to_string(),
            },
        ],
        "the rows changed, then the state that explains why"
    );
    assert_eq!(snapshot.items[0].track.filepath, original[0]);
}

#[test]
fn test_set_shuffle_off_restores_the_pre_shuffle_order() {
    let db = sample_db();
    fill_queue(&db, 6);
    let original = queue_filepaths(&db);

    set_shuffle(&db, true, &RecordingReporter::new()).unwrap();
    let snapshot = set_shuffle(&db, false, &RecordingReporter::new()).unwrap();

    assert!(!snapshot.shuffle_enabled);
    assert_eq!(
        queue_filepaths(&db),
        original,
        "unshuffling returns the order the user had before"
    );
}

#[test]
fn test_set_loop_persists_and_announces() {
    let db = sample_db();
    fill_queue(&db, 3);
    let reporter = RecordingReporter::new();

    set_loop(&db, "all", &reporter).unwrap();

    assert_eq!(get_playback_state(&db).unwrap().loop_mode, "all");
    assert_eq!(
        reporter.announcements(),
        vec![Announcement::StateChanged {
            current_index: -1,
            shuffle_enabled: false,
            loop_mode: "all".to_string(),
        }]
    );
}

// =========================================================================
// play next
// =========================================================================

#[test]
fn test_add_play_next_pins_the_row_after_the_current_one() {
    let db = sample_db();
    let ids = fill_queue(&db, 4);
    set_current_index(&db, 0, &RecordingReporter::new()).unwrap();
    let reporter = RecordingReporter::new();

    let snapshot = add_play_next(&db, &[ids[3]], &reporter).unwrap();

    assert_eq!(snapshot.items.len(), 4);
    assert_eq!(snapshot.items[1].track.id, ids[3]);
    assert_eq!(snapshot.play_next_offset, 1, "one row is pinned");
    assert_eq!(
        reporter.announcements(),
        vec![
            Announcement::Added {
                positions: vec![1],
                queue_length: 4,
            },
            Announcement::StateChanged {
                current_index: 0,
                shuffle_enabled: false,
                loop_mode: "none".to_string(),
            },
        ]
    );
}

#[test]
fn test_add_play_next_of_nothing_leaves_the_queue_alone() {
    let db = sample_db();
    fill_queue(&db, 2);
    let before = queue_filepaths(&db);
    let reporter = RecordingReporter::new();

    let snapshot = add_play_next(&db, &[], &reporter).unwrap();

    assert_eq!(queue_filepaths(&db), before);
    assert_eq!(snapshot.items.len(), 2);
    // The empty add still announces, with an empty position range: the command
    // derived its payload from the state's index rather than from what moved.
    assert_eq!(
        reporter.announcements(),
        vec![
            Announcement::Added {
                positions: vec![],
                queue_length: 2,
            },
            Announcement::StateChanged {
                current_index: -1,
                shuffle_enabled: false,
                loop_mode: "none".to_string(),
            },
        ]
    );
}
