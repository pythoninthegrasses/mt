//! Queue writes: what each request does to the rows, and what it announces.
//!
//! Every function here mirrors a `queue_*` command body, with the desktop's
//! half taken out: no `AppHandle`, no `State`, no event types. What a write
//! needs to tell the frontend goes through [`crate::queue::QueueReporter`],
//! which the desktop implements with its `emit_queue_updated` /
//! `emit_queue_state_changed` helpers — so the *sequence* of announcements a
//! command makes (and the positions it announces) is decided here, next to the
//! rows that produced them, and is covered by the tests in this module.
//!
//! Pool access is unchanged from the commands: reads and writes that must see
//! each other's rows share one `with_conn` closure, and the ones that did not
//! before still take connections separately rather than being "fixed" here.

use rand::prelude::SliceRandom;
use rand::rng;

use crate::db::{Database, DbError, QueueState, queue};
use crate::queue::{
    QueueAddFilesResponse, QueueAddResponse, QueueOperationResponse, QueueReporter,
    QueueStateSnapshot,
};

/// Add tracks to the queue by track IDs.
///
/// `position` inserts at that index; `None` appends. An empty ID list is the
/// frontend's bug, not a no-op: it is the error the command returned.
pub fn add_tracks(
    db: &Database,
    track_ids: &[i64],
    position: Option<i64>,
    reporter: &dyn QueueReporter,
) -> Result<QueueAddResponse, String> {
    if track_ids.is_empty() {
        return Err("track_ids must not be empty".to_string());
    }

    let (added, queue_length) = db
        .with_conn(|conn| {
            let added = queue::add_to_queue(conn, track_ids, position)?;
            let queue_length = queue::get_queue_length(conn)?;
            Ok((added, queue_length))
        })
        .map_err(|e| e.to_string())?;

    // Calculate positions that were added
    let start_pos = position.unwrap_or(queue_length - added);
    let positions: Vec<i64> = (start_pos..start_pos + added).collect();

    reporter.added(positions, queue_length);

    Ok(QueueAddResponse {
        added,
        queue_length,
    })
}

/// Add files directly to the queue (for drag-and-drop support).
///
/// A path that is not in the library yet is added with minimal metadata, which
/// is why the response carries the tracks: the frontend needs their IDs.
pub fn add_files(
    db: &Database,
    filepaths: &[String],
    position: Option<i64>,
    reporter: &dyn QueueReporter,
) -> Result<QueueAddFilesResponse, String> {
    if filepaths.is_empty() {
        return Err("filepaths must not be empty".to_string());
    }

    let (added, tracks, queue_length) = db
        .with_conn(|conn| {
            let (added, tracks) = queue::add_files_to_queue(conn, filepaths, position)?;
            let queue_length = queue::get_queue_length(conn)?;
            Ok((added, tracks, queue_length))
        })
        .map_err(|e| e.to_string())?;

    // Calculate positions that were added
    let start_pos = position.unwrap_or(queue_length - added);
    let positions: Vec<i64> = (start_pos..start_pos + added).collect();

    reporter.added(positions, queue_length);

    Ok(QueueAddFilesResponse {
        added,
        queue_length,
        tracks,
    })
}

/// Remove the track at `position`.
///
/// A position outside the queue is an error rather than a no-op, matching the
/// command: the frontend distinguishes "nothing there" from "removed".
pub fn remove_track(
    db: &Database,
    position: i64,
    reporter: &dyn QueueReporter,
) -> Result<(), String> {
    let (removed, queue_length) = db
        .with_conn(|conn| {
            let removed = queue::remove_from_queue(conn, position)?;
            let queue_length = queue::get_queue_length(conn)?;
            Ok((removed, queue_length))
        })
        .map_err(|e| e.to_string())?;

    if !removed {
        return Err(format!("No track at position {}", position));
    }

    reporter.removed(position, queue_length);

    Ok(())
}

/// Clear the entire queue.
pub fn clear(db: &Database, reporter: &dyn QueueReporter) -> Result<(), String> {
    db.with_conn(queue::clear_queue)
        .map_err(|e| e.to_string())?;

    reporter.cleared();

    Ok(())
}

/// Reorder tracks in the queue (move from one position to another).
pub fn reorder(
    db: &Database,
    from_position: i64,
    to_position: i64,
    reporter: &dyn QueueReporter,
) -> Result<QueueOperationResponse, String> {
    let (success, queue_length) = db
        .with_conn(|conn| {
            let success = queue::reorder_queue(conn, from_position, to_position)?;
            let queue_length = queue::get_queue_length(conn)?;
            Ok((success, queue_length))
        })
        .map_err(|e| e.to_string())?;

    if !success {
        return Err("Invalid positions".to_string());
    }

    reporter.reordered(from_position, to_position, queue_length);

    Ok(QueueOperationResponse {
        success,
        queue_length,
    })
}

/// Shuffle the queue using Fisher-Yates algorithm.
///
/// `keep_current` (default true) pins the first row, which is the row playing.
/// Rewriting the queue is a clear plus one insert per row, as it was in the
/// command: rows keep their filepaths, and the queue table resolves them back
/// to tracks on read.
pub fn shuffle(
    db: &Database,
    keep_current: Option<bool>,
    reporter: &dyn QueueReporter,
) -> Result<QueueOperationResponse, String> {
    let items = db.with_conn(queue::get_queue).map_err(|e| e.to_string())?;

    if items.is_empty() {
        return Ok(QueueOperationResponse {
            success: true,
            queue_length: 0,
        });
    }

    // Get filepaths from queue items
    let mut filepaths: Vec<String> = items
        .iter()
        .map(|item| item.track.filepath.clone())
        .collect();

    let keep_current = keep_current.unwrap_or(true);

    if keep_current && !filepaths.is_empty() {
        // Keep first item, shuffle rest using Fisher-Yates
        let first = filepaths.remove(0);
        filepaths.shuffle(&mut rng());
        filepaths.insert(0, first);
    } else {
        // Shuffle all items
        filepaths.shuffle(&mut rng());
    }

    let queue_length = db
        .with_conn(|conn| {
            queue::clear_queue(conn)?;
            for filepath in &filepaths {
                conn.execute(
                    "INSERT INTO queue (filepath) VALUES (?)",
                    rusqlite::params![filepath],
                )
                .map_err(DbError::from)?;
            }
            queue::get_queue_length(conn)
        })
        .map_err(|e| e.to_string())?;

    reporter.shuffled(queue_length);

    Ok(QueueOperationResponse {
        success: true,
        queue_length,
    })
}

/// Set current index in queue playback state.
pub fn set_current_index(
    db: &Database,
    index: i64,
    reporter: &dyn QueueReporter,
) -> Result<(), String> {
    let state = db
        .with_conn(|conn| {
            queue::set_current_index(conn, index)?;
            queue::get_queue_state(conn)
        })
        .map_err(|e| e.to_string())?;

    report_state(&state, reporter);

    Ok(())
}

/// Toggle shuffle on/off with full state machine: saves/restores original order,
/// pins current track at index 0 and play-next tracks after it when enabling.
pub fn set_shuffle(
    db: &Database,
    enabled: bool,
    reporter: &dyn QueueReporter,
) -> Result<QueueStateSnapshot, String> {
    let (items, state) = db
        .with_conn(|conn| {
            let items = queue::toggle_shuffle(conn, enabled)?;
            let state = queue::get_queue_state(conn)?;
            Ok((items, state))
        })
        .map_err(|e| e.to_string())?;

    // A reorder is a content change first, then the flag that caused it.
    reporter.shuffled(items.len() as i64);
    report_state(&state, reporter);

    Ok(QueueStateSnapshot::new(items, &state))
}

/// Set loop mode in queue playback state.
pub fn set_loop(db: &Database, mode: &str, reporter: &dyn QueueReporter) -> Result<(), String> {
    let state = db
        .with_conn(|conn| {
            queue::set_loop_mode(conn, mode)?;
            queue::get_queue_state(conn)
        })
        .map_err(|e| e.to_string())?;

    report_state(&state, reporter);

    Ok(())
}

/// Add tracks as "play next" with move semantics and offset tracking.
pub fn add_play_next(
    db: &Database,
    track_ids: &[i64],
    reporter: &dyn QueueReporter,
) -> Result<QueueStateSnapshot, String> {
    let (items, state) = db
        .with_conn(|conn| {
            let items = queue::add_play_next(conn, track_ids)?;
            let state = queue::get_queue_state(conn)?;
            Ok((items, state))
        })
        .map_err(|e| e.to_string())?;

    let queue_length = items.len() as i64;
    reporter.added(
        (state.current_index + 1..state.current_index + 1 + track_ids.len() as i64).collect(),
        queue_length,
    );
    report_state(&state, reporter);

    Ok(QueueStateSnapshot::new(items, &state))
}

/// Announce a playback-state read, which is what every state-changing command
/// ends with so the frontend's copy of the state machine stays in step.
fn report_state(state: &QueueState, reporter: &dyn QueueReporter) {
    reporter.state_changed(state.current_index, state.shuffle_enabled, &state.loop_mode);
}

#[cfg(test)]
#[path = "mutations_tests.rs"]
mod tests;
