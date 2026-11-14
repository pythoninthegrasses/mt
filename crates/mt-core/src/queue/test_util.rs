//! Fixtures shared by the `queue` module's tests.
//!
//! The two things every test needs are a queue with known contents and a way
//! to observe what a request announced, so both live here: the row builders
//! create the tracks the queue rows resolve to, and the recording sink/reporter
//! pair captures the calls the desktop would have turned into events.

use std::sync::Mutex;

use crate::db::{Database, TrackMetadata, library, queue};
use crate::queue::QueueReporter;
use crate::queue::navigation::PlaybackSink;

/// An empty database with the full schema, on a connection pool.
///
/// The pool holds a single connection, so drop any guard before handing the
/// database to a function that takes `&Database`.
pub(crate) fn sample_db() -> Database {
    Database::new_in_memory().unwrap()
}

/// Add `count` library tracks and return their IDs in order.
///
/// Named `seed_tracks` rather than `add_tracks` so a test file that pulls in the
/// module under test with `use super::*` keeps both names distinct.
pub(crate) fn seed_tracks(db: &Database, count: i32) -> Vec<i64> {
    let conn = db.conn().unwrap();
    let ids = (1..=count)
        .map(|i| {
            let metadata = TrackMetadata {
                title: Some(format!("Track {i}")),
                artist: Some(format!("Artist {i}")),
                duration: Some(60.0),
                ..Default::default()
            };
            library::add_track(&conn, &format!("/music/track{i}.mp3"), &metadata).unwrap()
        })
        .collect();
    drop(conn);
    ids
}

/// Add `count` tracks and queue them in that order; returns the track IDs.
pub(crate) fn fill_queue(db: &Database, count: i32) -> Vec<i64> {
    let ids = seed_tracks(db, count);
    let conn = db.conn().unwrap();
    queue::add_to_queue(&conn, &ids, None).unwrap();
    drop(conn);
    ids
}

/// The queued filepaths, in play order.
pub(crate) fn queue_filepaths(db: &Database) -> Vec<String> {
    let conn = db.conn().unwrap();
    let paths = queue::get_queue(&conn)
        .unwrap()
        .iter()
        .map(|item| item.track.filepath.clone())
        .collect();
    drop(conn);
    paths
}

/// One announcement a request made, mirroring the desktop's event payloads.
#[derive(Clone, Debug, PartialEq)]
pub(crate) enum Announcement {
    Added {
        positions: Vec<i64>,
        queue_length: i64,
    },
    Removed {
        position: i64,
        queue_length: i64,
    },
    Cleared,
    Shuffled {
        queue_length: i64,
    },
    Reordered {
        from: i64,
        to: i64,
        queue_length: i64,
    },
    StateChanged {
        current_index: i64,
        shuffle_enabled: bool,
        loop_mode: String,
    },
}

/// Records every announcement in call order.
///
/// The order is the point: the frontend reconciler updates its copy of the
/// queue from these, so a test can pin not just that something was announced
/// but that nothing extra was.
#[derive(Default)]
pub(crate) struct RecordingReporter {
    announcements: Mutex<Vec<Announcement>>,
}

impl RecordingReporter {
    pub(crate) fn new() -> Self {
        Self::default()
    }

    pub(crate) fn announcements(&self) -> Vec<Announcement> {
        self.announcements.lock().unwrap().clone()
    }

    /// The state-machine announcements only, for tests focused on those.
    pub(crate) fn states(&self) -> Vec<(i64, bool, String)> {
        self.announcements
            .lock()
            .unwrap()
            .iter()
            .filter_map(|announcement| match announcement {
                Announcement::StateChanged {
                    current_index,
                    shuffle_enabled,
                    loop_mode,
                } => Some((*current_index, *shuffle_enabled, loop_mode.clone())),
                _ => None,
            })
            .collect()
    }
}

impl QueueReporter for RecordingReporter {
    fn added(&self, positions: Vec<i64>, queue_length: i64) {
        self.announcements
            .lock()
            .unwrap()
            .push(Announcement::Added {
                positions,
                queue_length,
            });
    }

    fn removed(&self, position: i64, queue_length: i64) {
        self.announcements
            .lock()
            .unwrap()
            .push(Announcement::Removed {
                position,
                queue_length,
            });
    }

    fn cleared(&self) {
        self.announcements
            .lock()
            .unwrap()
            .push(Announcement::Cleared);
    }

    fn shuffled(&self, queue_length: i64) {
        self.announcements
            .lock()
            .unwrap()
            .push(Announcement::Shuffled { queue_length });
    }

    fn reordered(&self, from_position: i64, to_position: i64, queue_length: i64) {
        self.announcements
            .lock()
            .unwrap()
            .push(Announcement::Reordered {
                from: from_position,
                to: to_position,
                queue_length,
            });
    }

    fn state_changed(&self, current_index: i64, shuffle_enabled: bool, loop_mode: &str) {
        self.announcements
            .lock()
            .unwrap()
            .push(Announcement::StateChanged {
                current_index,
                shuffle_enabled,
                loop_mode: loop_mode.to_string(),
            });
    }
}

/// The audio engine stand-in: records what it was asked to play.
///
/// `failing` reproduces the case the commands had to get right — the queue has
/// already moved by the time the engine refuses the file, so the error must
/// propagate without a state announcement that would tell the frontend the
/// move succeeded.
#[derive(Default)]
pub(crate) struct FakeSink {
    plays: Mutex<Vec<(String, i64)>>,
    duration_ms: u64,
    failing: bool,
}

impl FakeSink {
    /// A sink that accepts every file and reports `duration_ms`.
    pub(crate) fn with_duration(duration_ms: u64) -> Self {
        Self {
            duration_ms,
            ..Default::default()
        }
    }

    /// A sink whose every attempt to start a file fails.
    pub(crate) fn failing() -> Self {
        Self {
            failing: true,
            ..Default::default()
        }
    }

    /// The `(filepath, track_id)` pairs it was asked to play, in order.
    pub(crate) fn plays(&self) -> Vec<(String, i64)> {
        self.plays.lock().unwrap().clone()
    }
}

impl PlaybackSink for FakeSink {
    fn load_and_play(&self, filepath: &str, track_id: i64) -> Result<u64, String> {
        self.plays
            .lock()
            .unwrap()
            .push((filepath.to_string(), track_id));

        if self.failing {
            return Err("audio engine refused the file".to_string());
        }

        Ok(self.duration_ms)
    }
}
