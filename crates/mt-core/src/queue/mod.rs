//! Queue orchestration — the layer between the desktop commands and SQL.
//!
//! [`crate::db::queue`] owns the `queue` and `queue_state` tables and the state
//! machine that decides what "next" means. This module owns what the desktop
//! `queue_*` commands did around it: build the response shapes the frontend
//! expects, work out which positions a write touched, decide the order of
//! announcements a request makes, and hold the seam where the queue asks the
//! audio engine to start a track.
//!
//! Nothing here knows about IPC. Functions take a [`crate::db::Database`] and
//! return the same `Result<_, String>` the commands returned, so the
//! frontend-facing error strings are unchanged by the move. Two traits carry the
//! desktop's half: [`QueueReporter`] for announcements and
//! [`navigation::PlaybackSink`](crate::queue::navigation::PlaybackSink) for
//! starting playback.

pub mod mutations;
pub mod navigation;
pub mod types;

pub use mutations::{
    add_files, add_play_next, add_tracks, clear, remove_track, reorder, set_current_index,
    set_loop, set_shuffle, shuffle,
};
pub use navigation::{
    PlayContextQuery, PlaybackSink, play_context, play_context_from_query, play_next,
    play_previous, skip_next, skip_previous,
};
pub use types::{
    PlayContextResponse, QueueAddFilesResponse, QueueAddResponse, QueueNavigationResult,
    QueueOperationResponse, QueueResponse, QueueStateSnapshot,
};

use crate::db::{Database, QueueState, queue};

/// The announcements a queue request makes while it runs.
///
/// The desktop implements this over its `emit_queue_updated` and
/// `emit_queue_state_changed` helpers; the methods are the payloads the
/// frontend reconciler consumes. Keeping them as a trait rather than inline
/// `app.emit_*` calls is what lets a test pin the *sequence* — enabling shuffle
/// is a `shuffled` followed by a state change, a play context is `cleared`
/// followed by a state change — which the frontend relies on to update without
/// refetching.
pub trait QueueReporter {
    /// Rows appeared at these positions.
    fn added(&self, positions: Vec<i64>, queue_length: i64);

    /// The row at this position is gone.
    fn removed(&self, position: i64, queue_length: i64);

    /// The queue was emptied, or replaced wholesale by a play context.
    fn cleared(&self);

    /// The queue's order changed; its length did not.
    fn shuffled(&self, queue_length: i64);

    /// One row moved from one position to another.
    fn reordered(&self, from_position: i64, to_position: i64, queue_length: i64);

    /// The state machine moved: current index, shuffle flag, or loop mode.
    fn state_changed(&self, current_index: i64, shuffle_enabled: bool, loop_mode: &str);
}

/// A reporter that announces nothing, for callers that only want the rows.
///
/// The commands always use a real reporter; this exists for tests and for any
/// future caller that reads the queue through the same code path.
pub struct SilentReporter;

impl QueueReporter for SilentReporter {
    fn added(&self, _positions: Vec<i64>, _queue_length: i64) {}
    fn removed(&self, _position: i64, _queue_length: i64) {}
    fn cleared(&self) {}
    fn shuffled(&self, _queue_length: i64) {}
    fn reordered(&self, _from_position: i64, _to_position: i64, _queue_length: i64) {}
    fn state_changed(&self, _current_index: i64, _shuffle_enabled: bool, _loop_mode: &str) {}
}

/// The queue with its track metadata, and how many rows it holds.
pub fn get(db: &Database) -> Result<QueueResponse, String> {
    let items = db.with_conn(queue::get_queue).map_err(|e| e.to_string())?;
    let count = items.len() as i64;

    Ok(QueueResponse { items, count })
}

/// The playback state the frontend's queue store mirrors.
pub fn get_playback_state(db: &Database) -> Result<QueueState, String> {
    db.with_conn(queue::get_queue_state)
        .map_err(|e| e.to_string())
}

/// Check queue integrity and repair issues.
pub fn check_integrity(db: &Database) -> Result<queue::IntegrityReport, String> {
    db.with_conn(queue::check_integrity)
        .map_err(|e| e.to_string())
}

#[cfg(test)]
#[path = "mod_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "test_util.rs"]
mod test_util;
