//! Navigation and play contexts: the queue's state machine plus a playback seam.
//!
//! The four navigation commands were the same function with a different entry
//! into [`crate::db::queue`], so they share [`navigate`] here: advance, play the
//! row if the state machine says to, read the state back, announce it, then
//! build the response. Announcing *before* the state read (or after the
//! response was built) would leave the frontend's copy of the state machine a
//! step behind, which is why the reporter is a parameter rather than something
//! the command does afterwards.
//!
//! Starting audio is the one step the core cannot do, so it is the
//! [`PlaybackSink`] the desktop passes in. The sink's error propagates exactly
//! as the command's did: the queue has already moved, and no state change is
//! announced.

use rusqlite::Connection;

use crate::db::{Database, QueueItem, QueueState, SortOrder, library, queue};
use crate::queue::{PlayContextResponse, QueueNavigationResult, QueueReporter, QueueStateSnapshot};

/// The audio engine, as the queue needs it: start a file and report its length.
pub trait PlaybackSink {
    /// Begin playback and return the duration in milliseconds.
    ///
    /// The duration comes from the decoder rather than the database because it
    /// is what the frontend shows on the seek bar as playback starts.
    fn load_and_play(&self, filepath: &str, track_id: i64) -> Result<u64, String>;
}

/// The sort and saved search a play-context query request carries.
///
/// `sort_by` and `sort_order` arrive as the frontend's strings and are parsed
/// the way the library commands parse them: an unknown column falls back to the
/// default, anything but "asc" (case-insensitive) is descending.
pub struct PlayContextQuery {
    pub start_track_id: i64,
    pub search: Option<String>,
    pub sort_by: Option<String>,
    pub sort_order: Option<String>,
    pub ignore_words: Option<String>,
    pub shuffle: bool,
}

/// Build the response for a navigation action: what the frontend should do,
/// which track to do it with, and the queue state to adopt.
pub fn build_navigation_result(
    action: &queue::NavigationAction,
    items: &[QueueItem],
    state: &QueueState,
    duration_ms: Option<u64>,
) -> QueueNavigationResult {
    let (action_str, track) = match action {
        queue::NavigationAction::Play(idx) => {
            let track = items.get(*idx).map(|item| item.track.clone());
            ("play".to_string(), track)
        }
        queue::NavigationAction::Stop => ("stop".to_string(), None),
        queue::NavigationAction::SeekZero => {
            let track = if state.current_index >= 0 {
                items
                    .get(state.current_index as usize)
                    .map(|item| item.track.clone())
            } else {
                None
            };
            ("seek_zero".to_string(), track)
        }
    };

    QueueNavigationResult {
        action: action_str,
        track,
        duration_ms,
        snapshot: QueueStateSnapshot::new(items.to_vec(), state),
    }
}

/// Play the next track in the queue with full state machine logic.
pub fn play_next(
    db: &Database,
    sink: &dyn PlaybackSink,
    reporter: &dyn QueueReporter,
) -> Result<QueueNavigationResult, String> {
    let conn = db.conn().map_err(|e| e.to_string())?;
    let (action, items) = queue::advance_to_next(&conn).map_err(|e| e.to_string())?;

    navigate(&conn, action, items, sink, reporter)
}

/// Play the previous track in the queue.
pub fn play_previous(
    db: &Database,
    current_time_ms: u64,
    sink: &dyn PlaybackSink,
    reporter: &dyn QueueReporter,
) -> Result<QueueNavigationResult, String> {
    let conn = db.conn().map_err(|e| e.to_string())?;
    let (action, items) =
        queue::advance_to_previous(&conn, current_time_ms).map_err(|e| e.to_string())?;

    navigate(&conn, action, items, sink, reporter)
}

/// Skip to next track, overriding repeat-one mode.
pub fn skip_next(
    db: &Database,
    sink: &dyn PlaybackSink,
    reporter: &dyn QueueReporter,
) -> Result<QueueNavigationResult, String> {
    let conn = db.conn().map_err(|e| e.to_string())?;
    let (action, items) = queue::skip_to_next(&conn).map_err(|e| e.to_string())?;

    navigate(&conn, action, items, sink, reporter)
}

/// Skip to previous track, overriding repeat-one mode.
pub fn skip_previous(
    db: &Database,
    current_time_ms: u64,
    sink: &dyn PlaybackSink,
    reporter: &dyn QueueReporter,
) -> Result<QueueNavigationResult, String> {
    let conn = db.conn().map_err(|e| e.to_string())?;
    let (action, items) =
        queue::skip_to_previous(&conn, current_time_ms).map_err(|e| e.to_string())?;

    navigate(&conn, action, items, sink, reporter)
}

/// Atomically replace the queue with a new play context and start playback.
///
/// Installs all tracks (rotated or shuffled), sets queue state, starts the
/// start track, and announces the replacement.
pub fn play_context(
    db: &Database,
    track_ids: &[i64],
    start_index: i64,
    shuffle: bool,
    sink: &dyn PlaybackSink,
    reporter: &dyn QueueReporter,
) -> Result<PlayContextResponse, String> {
    let conn = db.conn().map_err(|e| e.to_string())?;

    install(&conn, track_ids, start_index, shuffle, sink, reporter)
}

/// Atomically replace the queue using a library query and start playback.
///
/// Runs the library sort/filter query once, resolves the full ordered ID list,
/// and starts playback on `start_track_id`. The whole ordered list is installed
/// server-side, which is what removes the N paged `library_get_all` calls the
/// frontend used to make on the play hot path.
pub fn play_context_from_query(
    db: &Database,
    request: &PlayContextQuery,
    sink: &dyn PlaybackSink,
    reporter: &dyn QueueReporter,
) -> Result<PlayContextResponse, String> {
    let conn = db.conn().map_err(|e| e.to_string())?;

    let query = library::LibraryQuery {
        search: request.search.clone(),
        sort_by: request
            .sort_by
            .as_ref()
            .and_then(|s| s.parse().ok())
            .unwrap_or_default(),
        sort_order: request
            .sort_order
            .as_ref()
            .map(|s| {
                if s.to_lowercase() == "asc" {
                    SortOrder::Asc
                } else {
                    SortOrder::Desc
                }
            })
            .unwrap_or(SortOrder::Desc),
        ignore_words: request.ignore_words.clone(),
        ..Default::default()
    };

    let track_ids = library::get_track_ids(&conn, &query).map_err(|e| e.to_string())?;

    let start_index = track_ids
        .iter()
        .position(|&id| id == request.start_track_id)
        .unwrap_or(0) as i64;

    install(
        &conn,
        &track_ids,
        start_index,
        request.shuffle,
        sink,
        reporter,
    )
}

/// Install a play context on a connection the caller holds and start it.
///
/// One connection covers the install and the state read that follows, as it did
/// in the commands: the state announced has to be the state the install wrote.
fn install(
    conn: &Connection,
    track_ids: &[i64],
    start_index: i64,
    shuffle: bool,
    sink: &dyn PlaybackSink,
    reporter: &dyn QueueReporter,
) -> Result<PlayContextResponse, String> {
    // Atomically install queue (clear + insert + state update)
    let result =
        queue::play_context(conn, track_ids, start_index, shuffle).map_err(|e| e.to_string())?;

    let track = result.current_track.clone();

    // Trigger audio playback on the start track
    let duration_ms = sink.load_and_play(&track.filepath, track.id)?;

    // Announce the wholesale replacement, then the state it established.
    reporter.cleared();
    let loop_mode = queue::get_queue_state(conn)
        .map(|s| s.loop_mode)
        .unwrap_or_else(|_| "none".to_string());
    reporter.state_changed(0, shuffle, &loop_mode);

    Ok(PlayContextResponse {
        items: result.items,
        current_index: 0,
        track,
        shuffle_enabled: shuffle,
        duration_ms,
    })
}

/// Advance, play if the state machine asked for a track, then read and announce
/// the state the advance left behind.
fn navigate(
    conn: &Connection,
    action: queue::NavigationAction,
    items: Vec<QueueItem>,
    sink: &dyn PlaybackSink,
    reporter: &dyn QueueReporter,
) -> Result<QueueNavigationResult, String> {
    let duration_ms = match &action {
        queue::NavigationAction::Play(idx) => match items.get(*idx) {
            Some(item) => Some(sink.load_and_play(&item.track.filepath, item.track.id)?),
            None => None,
        },
        queue::NavigationAction::Stop | queue::NavigationAction::SeekZero => None,
    };

    let state = queue::get_queue_state(conn).map_err(|e| e.to_string())?;
    reporter.state_changed(state.current_index, state.shuffle_enabled, &state.loop_mode);

    Ok(build_navigation_result(
        &action,
        &items,
        &state,
        duration_ms,
    ))
}

#[cfg(test)]
#[path = "navigation_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "play_context_tests.rs"]
mod play_context_tests;
