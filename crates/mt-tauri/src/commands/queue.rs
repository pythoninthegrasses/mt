//! Tauri commands for queue management.
//!
//! These commands expose queue operations to the frontend,
//! replacing the Python FastAPI queue routes.

use rand::rng;
use rand::seq::SliceRandom;
use tauri::{AppHandle, State};

use crate::cache::NetworkFileCache;
use crate::commands::audio::AudioState;
use crate::db::{Database, QueueItem, QueueState, SortOrder, Track, library, queue};
use crate::events::{EventEmitter, QueueStateChangedEvent, QueueUpdatedEvent};

/// Response for queue get operations
#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct QueueResponse {
    pub items: Vec<QueueItem>,
    pub count: i64,
}

/// Response for queue add operations
#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct QueueAddResponse {
    pub added: i64,
    pub queue_length: i64,
}

/// Response for queue add-files operations
#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct QueueAddFilesResponse {
    pub added: i64,
    pub queue_length: i64,
    pub tracks: Vec<Track>,
}

/// Response for queue operations that return success status
#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct QueueOperationResponse {
    pub success: bool,
    pub queue_length: i64,
}

/// Full queue state snapshot returned by state-changing commands
#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct QueueStateSnapshot {
    pub items: Vec<QueueItem>,
    pub current_index: i64,
    pub shuffle_enabled: bool,
    pub loop_mode: String,
    pub play_next_offset: i64,
}

/// Result of a navigation command (play next/previous/skip)
#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct QueueNavigationResult {
    /// "play", "stop", or "seek_zero"
    pub action: String,
    pub track: Option<Track>,
    pub duration_ms: Option<u64>,
    pub snapshot: QueueStateSnapshot,
}

/// Get the current playback queue with track metadata
#[tracing::instrument(skip(db))]
#[tauri::command]
pub(crate) fn queue_get(db: State<'_, Database>) -> Result<QueueResponse, String> {
    let items = db.with_conn(queue::get_queue).map_err(|e| e.to_string())?;
    let count = items.len() as i64;

    Ok(QueueResponse { items, count })
}

/// Add tracks to the queue by track IDs
#[tracing::instrument(skip(app, db, track_ids))]
#[tauri::command]
pub(crate) fn queue_add(
    app: AppHandle,
    db: State<'_, Database>,
    track_ids: Vec<i64>,
    position: Option<i64>,
) -> Result<QueueAddResponse, String> {
    if track_ids.is_empty() {
        return Err("track_ids must not be empty".to_string());
    }

    let (added, queue_length) = db
        .with_conn(|conn| {
            let added = queue::add_to_queue(conn, &track_ids, position)?;
            let queue_length = queue::get_queue_length(conn)?;
            Ok((added, queue_length))
        })
        .map_err(|e| e.to_string())?;

    // Calculate positions that were added
    let start_pos = position.unwrap_or(queue_length - added);
    let positions: Vec<i64> = (start_pos..start_pos + added).collect();

    // Emit queue updated event with payload
    let _ = app.emit_queue_updated(QueueUpdatedEvent::added(positions, queue_length));

    Ok(QueueAddResponse {
        added,
        queue_length,
    })
}

/// Add files directly to the queue (for drag-and-drop support)
#[tracing::instrument(skip(app, db, filepaths))]
#[tauri::command]
pub(crate) fn queue_add_files(
    app: AppHandle,
    db: State<'_, Database>,
    filepaths: Vec<String>,
    position: Option<i64>,
) -> Result<QueueAddFilesResponse, String> {
    if filepaths.is_empty() {
        return Err("filepaths must not be empty".to_string());
    }

    let (added, tracks, queue_length) = db
        .with_conn(|conn| {
            let (added, tracks) = queue::add_files_to_queue(conn, &filepaths, position)?;
            let queue_length = queue::get_queue_length(conn)?;
            Ok((added, tracks, queue_length))
        })
        .map_err(|e| e.to_string())?;

    // Calculate positions that were added
    let start_pos = position.unwrap_or(queue_length - added);
    let positions: Vec<i64> = (start_pos..start_pos + added).collect();

    // Emit queue updated event with payload
    let _ = app.emit_queue_updated(QueueUpdatedEvent::added(positions, queue_length));

    Ok(QueueAddFilesResponse {
        added,
        queue_length,
        tracks,
    })
}

/// Remove a track from the queue by position
#[tracing::instrument(skip(app, db))]
#[tauri::command]
pub(crate) fn queue_remove(
    app: AppHandle,
    db: State<'_, Database>,
    position: i64,
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

    // Emit queue updated event with payload
    let _ = app.emit_queue_updated(QueueUpdatedEvent::removed(position, queue_length));

    Ok(())
}

/// Clear the entire queue
#[tracing::instrument(skip(app, db))]
#[tauri::command]
pub(crate) fn queue_clear(app: AppHandle, db: State<'_, Database>) -> Result<(), String> {
    db.with_conn(queue::clear_queue)
        .map_err(|e| e.to_string())?;

    // Emit queue updated event with payload
    let _ = app.emit_queue_updated(QueueUpdatedEvent::cleared());

    Ok(())
}

/// Reorder tracks in the queue (move from one position to another)
#[tracing::instrument(skip(app, db))]
#[tauri::command]
pub(crate) fn queue_reorder(
    app: AppHandle,
    db: State<'_, Database>,
    from_position: i64,
    to_position: i64,
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

    // Emit queue updated event with payload
    let _ = app.emit_queue_updated(QueueUpdatedEvent::reordered(
        from_position,
        to_position,
        queue_length,
    ));

    Ok(QueueOperationResponse {
        success,
        queue_length,
    })
}

/// Shuffle the queue using Fisher-Yates algorithm
#[tracing::instrument(skip(app, db))]
#[tauri::command]
pub(crate) fn queue_shuffle(
    app: AppHandle,
    db: State<'_, Database>,
    keep_current: Option<bool>,
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
                .map_err(crate::db::DbError::from)?;
            }
            queue::get_queue_length(conn)
        })
        .map_err(|e| e.to_string())?;

    // Emit queue updated event with payload
    let _ = app.emit_queue_updated(QueueUpdatedEvent::shuffled(queue_length));

    Ok(QueueOperationResponse {
        success: true,
        queue_length,
    })
}

/// Get queue playback state
#[tracing::instrument(level = "trace", skip(db))]
#[tauri::command]
pub(crate) fn queue_get_playback_state(db: State<'_, Database>) -> Result<QueueState, String> {
    db.with_conn(queue::get_queue_state)
        .map_err(|e| e.to_string())
}

/// Set current index in queue playback state
#[tracing::instrument(skip(app, db))]
#[tauri::command]
pub(crate) fn queue_set_current_index(
    app: AppHandle,
    db: State<'_, Database>,
    index: i64,
) -> Result<(), String> {
    let state = db
        .with_conn(|conn| {
            queue::set_current_index(conn, index)?;
            queue::get_queue_state(conn)
        })
        .map_err(|e| e.to_string())?;

    // Emit state changed event
    let _ = app.emit_queue_state_changed(QueueStateChangedEvent::new(
        state.current_index,
        state.shuffle_enabled,
        state.loop_mode,
    ));

    Ok(())
}

/// Toggle shuffle on/off with full state machine: saves/restores original order,
/// pins current track at index 0 and play-next tracks after it when enabling.
#[tracing::instrument(skip(app, db))]
#[tauri::command]
pub(crate) fn queue_set_shuffle(
    app: AppHandle,
    db: State<'_, Database>,
    enabled: bool,
) -> Result<QueueStateSnapshot, String> {
    let (items, state) = db
        .with_conn(|conn| {
            let items = queue::toggle_shuffle(conn, enabled)?;
            let state = queue::get_queue_state(conn)?;
            Ok((items, state))
        })
        .map_err(|e| e.to_string())?;

    // Emit events
    let queue_length = items.len() as i64;
    let _ = app.emit_queue_updated(QueueUpdatedEvent::shuffled(queue_length));
    let _ = app.emit_queue_state_changed(QueueStateChangedEvent::new(
        state.current_index,
        state.shuffle_enabled,
        state.loop_mode.clone(),
    ));

    Ok(QueueStateSnapshot {
        items,
        current_index: state.current_index,
        shuffle_enabled: state.shuffle_enabled,
        loop_mode: state.loop_mode,
        play_next_offset: state.play_next_offset,
    })
}

/// Set loop mode in queue playback state
#[tracing::instrument(skip(app, db))]
#[tauri::command]
pub(crate) fn queue_set_loop(
    app: AppHandle,
    db: State<'_, Database>,
    mode: String,
) -> Result<(), String> {
    let state = db
        .with_conn(|conn| {
            queue::set_loop_mode(conn, &mode)?;
            queue::get_queue_state(conn)
        })
        .map_err(|e| e.to_string())?;

    // Emit state changed event
    let _ = app.emit_queue_state_changed(QueueStateChangedEvent::new(
        state.current_index,
        state.shuffle_enabled,
        state.loop_mode,
    ));

    Ok(())
}

/// Add tracks as "play next" with move semantics and offset tracking
#[tracing::instrument(skip(app, db))]
#[tauri::command]
pub(crate) fn queue_add_play_next(
    app: AppHandle,
    db: State<'_, Database>,
    track_ids: Vec<i64>,
) -> Result<QueueStateSnapshot, String> {
    let (items, state) = db
        .with_conn(|conn| {
            let items = queue::add_play_next(conn, &track_ids)?;
            let state = queue::get_queue_state(conn)?;
            Ok((items, state))
        })
        .map_err(|e| e.to_string())?;

    let queue_length = items.len() as i64;
    let _ = app.emit_queue_updated(QueueUpdatedEvent::added(
        (state.current_index + 1..state.current_index + 1 + track_ids.len() as i64).collect(),
        queue_length,
    ));
    let _ = app.emit_queue_state_changed(QueueStateChangedEvent::new(
        state.current_index,
        state.shuffle_enabled,
        state.loop_mode.clone(),
    ));

    Ok(QueueStateSnapshot {
        items,
        current_index: state.current_index,
        shuffle_enabled: state.shuffle_enabled,
        loop_mode: state.loop_mode,
        play_next_offset: state.play_next_offset,
    })
}

/// Helper to build a QueueNavigationResult from a navigation action
fn build_navigation_result(
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
        snapshot: QueueStateSnapshot {
            items: items.to_vec(),
            current_index: state.current_index,
            shuffle_enabled: state.shuffle_enabled,
            loop_mode: state.loop_mode.clone(),
            play_next_offset: state.play_next_offset,
        },
    }
}

/// Play the next track in the queue with full state machine logic
#[tracing::instrument(skip(app, db, audio, cache))]
#[tauri::command]
pub(crate) fn queue_play_next_track(
    app: AppHandle,
    db: State<'_, Database>,
    audio: State<'_, AudioState>,
    cache: State<'_, NetworkFileCache>,
) -> Result<QueueNavigationResult, String> {
    let conn = db.conn().map_err(|e| e.to_string())?;
    let (action, items) = queue::advance_to_next(&conn).map_err(|e| e.to_string())?;

    let duration_ms = if let queue::NavigationAction::Play(idx) = &action {
        if let Some(item) = items.get(*idx) {
            let info =
                audio.load_and_play(&item.track.filepath, Some(item.track.id), &cache, &app)?;
            Some(info.duration_ms)
        } else {
            None
        }
    } else {
        None
    };

    let state = queue::get_queue_state(&conn).map_err(|e| e.to_string())?;
    let _ = app.emit_queue_state_changed(QueueStateChangedEvent::new(
        state.current_index,
        state.shuffle_enabled,
        state.loop_mode.clone(),
    ));

    Ok(build_navigation_result(
        &action,
        &items,
        &state,
        duration_ms,
    ))
}

/// Play the previous track in the queue
#[tracing::instrument(skip(app, db, audio, cache))]
#[tauri::command]
pub(crate) fn queue_play_previous_track(
    app: AppHandle,
    db: State<'_, Database>,
    audio: State<'_, AudioState>,
    cache: State<'_, NetworkFileCache>,
    current_time_ms: u64,
) -> Result<QueueNavigationResult, String> {
    let conn = db.conn().map_err(|e| e.to_string())?;
    let (action, items) =
        queue::advance_to_previous(&conn, current_time_ms).map_err(|e| e.to_string())?;

    let duration_ms = if let queue::NavigationAction::Play(idx) = &action {
        if let Some(item) = items.get(*idx) {
            let info =
                audio.load_and_play(&item.track.filepath, Some(item.track.id), &cache, &app)?;
            Some(info.duration_ms)
        } else {
            None
        }
    } else {
        None
    };

    let state = queue::get_queue_state(&conn).map_err(|e| e.to_string())?;
    let _ = app.emit_queue_state_changed(QueueStateChangedEvent::new(
        state.current_index,
        state.shuffle_enabled,
        state.loop_mode.clone(),
    ));

    Ok(build_navigation_result(
        &action,
        &items,
        &state,
        duration_ms,
    ))
}

/// Skip to next track, overriding repeat-one mode
#[tracing::instrument(skip(app, db, audio, cache))]
#[tauri::command]
pub(crate) fn queue_skip_next(
    app: AppHandle,
    db: State<'_, Database>,
    audio: State<'_, AudioState>,
    cache: State<'_, NetworkFileCache>,
) -> Result<QueueNavigationResult, String> {
    let conn = db.conn().map_err(|e| e.to_string())?;
    let (action, items) = queue::skip_to_next(&conn).map_err(|e| e.to_string())?;

    let duration_ms = if let queue::NavigationAction::Play(idx) = &action {
        if let Some(item) = items.get(*idx) {
            let info =
                audio.load_and_play(&item.track.filepath, Some(item.track.id), &cache, &app)?;
            Some(info.duration_ms)
        } else {
            None
        }
    } else {
        None
    };

    let state = queue::get_queue_state(&conn).map_err(|e| e.to_string())?;
    let _ = app.emit_queue_state_changed(QueueStateChangedEvent::new(
        state.current_index,
        state.shuffle_enabled,
        state.loop_mode.clone(),
    ));

    Ok(build_navigation_result(
        &action,
        &items,
        &state,
        duration_ms,
    ))
}

/// Skip to previous track, overriding repeat-one mode
#[tracing::instrument(skip(app, db, audio, cache))]
#[tauri::command]
pub(crate) fn queue_skip_previous(
    app: AppHandle,
    db: State<'_, Database>,
    audio: State<'_, AudioState>,
    cache: State<'_, NetworkFileCache>,
    current_time_ms: u64,
) -> Result<QueueNavigationResult, String> {
    let conn = db.conn().map_err(|e| e.to_string())?;
    let (action, items) =
        queue::skip_to_previous(&conn, current_time_ms).map_err(|e| e.to_string())?;

    let duration_ms = if let queue::NavigationAction::Play(idx) = &action {
        if let Some(item) = items.get(*idx) {
            let info =
                audio.load_and_play(&item.track.filepath, Some(item.track.id), &cache, &app)?;
            Some(info.duration_ms)
        } else {
            None
        }
    } else {
        None
    };

    let state = queue::get_queue_state(&conn).map_err(|e| e.to_string())?;
    let _ = app.emit_queue_state_changed(QueueStateChangedEvent::new(
        state.current_index,
        state.shuffle_enabled,
        state.loop_mode.clone(),
    ));

    Ok(build_navigation_result(
        &action,
        &items,
        &state,
        duration_ms,
    ))
}

/// Check queue integrity and repair issues
#[tracing::instrument(skip(db))]
#[tauri::command]
pub(crate) fn queue_check_integrity(
    db: State<'_, Database>,
) -> Result<queue::IntegrityReport, String> {
    db.with_conn(queue::check_integrity)
        .map_err(|e| e.to_string())
}

/// Response for atomic play-context operations
#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct PlayContextResponse {
    pub items: Vec<QueueItem>,
    pub current_index: i64,
    pub track: Track,
    pub shuffle_enabled: bool,
    /// Duration in milliseconds from the audio engine (more accurate than DB metadata)
    pub duration_ms: u64,
}

/// Atomically replace the queue with a new play context and start playback.
///
/// Clears the queue, installs all tracks (rotated or shuffled), sets queue
/// state, triggers audio playback on the start track, and emits queue events
/// — all in a single IPC round-trip.
#[tracing::instrument(skip(app, db, audio, cache))]
#[tauri::command]
pub(crate) fn queue_play_context(
    app: AppHandle,
    db: State<'_, Database>,
    audio: State<'_, AudioState>,
    cache: State<'_, NetworkFileCache>,
    track_ids: Vec<i64>,
    start_index: i64,
    shuffle: bool,
) -> Result<PlayContextResponse, String> {
    let conn = db.conn().map_err(|e| e.to_string())?;

    // Atomically install queue (clear + insert + state update)
    let result =
        queue::play_context(&conn, &track_ids, start_index, shuffle).map_err(|e| e.to_string())?;

    let track = result.current_track.clone();

    // Trigger audio playback on the start track
    let track_info = audio.load_and_play(&track.filepath, Some(track.id), &cache, &app)?;

    // Emit queue events (reuse existing event types)
    let _ = app.emit_queue_updated(QueueUpdatedEvent::cleared());
    let _ = app.emit_queue_state_changed(QueueStateChangedEvent::new(
        0,
        shuffle,
        queue::get_queue_state(&conn)
            .map(|s| s.loop_mode)
            .unwrap_or_else(|_| "none".to_string()),
    ));

    Ok(PlayContextResponse {
        items: result.items,
        current_index: 0,
        track,
        shuffle_enabled: shuffle,
        duration_ms: track_info.duration_ms,
    })
}

/// Atomically replace the queue using a library query and start playback.
///
/// Runs the library sort/filter query once on the backend, resolves the full
/// ordered ID list, and starts playback on `start_track_id` — all in a single
/// IPC round-trip. Eliminates the N×`library_get_all` calls that
/// `_loadAllPages()` required on the play hot path.
#[allow(clippy::too_many_arguments)]
#[tracing::instrument(skip(app, db, audio, cache))]
#[tauri::command]
pub(crate) fn queue_play_context_query(
    app: AppHandle,
    db: State<'_, Database>,
    audio: State<'_, AudioState>,
    cache: State<'_, NetworkFileCache>,
    start_track_id: i64,
    search: Option<String>,
    sort_by: Option<String>,
    sort_order: Option<String>,
    ignore_words: Option<String>,
    shuffle: bool,
) -> Result<PlayContextResponse, String> {
    let conn = db.conn().map_err(|e| e.to_string())?;

    let query = library::LibraryQuery {
        search,
        sort_by: sort_by
            .as_ref()
            .and_then(|s| s.parse().ok())
            .unwrap_or_default(),
        sort_order: sort_order
            .as_ref()
            .map(|s| {
                if s.to_lowercase() == "asc" {
                    SortOrder::Asc
                } else {
                    SortOrder::Desc
                }
            })
            .unwrap_or(SortOrder::Desc),
        ignore_words,
        ..Default::default()
    };

    let track_ids = library::get_track_ids(&conn, &query).map_err(|e| e.to_string())?;

    let start_index = track_ids
        .iter()
        .position(|&id| id == start_track_id)
        .unwrap_or(0) as i64;

    let result =
        queue::play_context(&conn, &track_ids, start_index, shuffle).map_err(|e| e.to_string())?;

    let track = result.current_track.clone();
    let track_info = audio.load_and_play(&track.filepath, Some(track.id), &cache, &app)?;

    let _ = app.emit_queue_updated(QueueUpdatedEvent::cleared());
    let _ = app.emit_queue_state_changed(QueueStateChangedEvent::new(
        0,
        shuffle,
        queue::get_queue_state(&conn)
            .map(|s| s.loop_mode)
            .unwrap_or_else(|_| "none".to_string()),
    ));

    Ok(PlayContextResponse {
        items: result.items,
        current_index: 0,
        track,
        shuffle_enabled: shuffle,
        duration_ms: track_info.duration_ms,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    // ==================== QueueResponse Tests ====================

    #[test]
    fn test_queue_response_serialization() {
        let response = QueueResponse {
            items: vec![],
            count: 0,
        };

        let json = serde_json::to_string(&response).unwrap();
        assert!(json.contains("\"count\":0"));
        assert!(json.contains("\"items\":[]"));
    }

    #[test]
    fn test_queue_response_empty() {
        let response = QueueResponse {
            items: vec![],
            count: 0,
        };

        assert!(response.items.is_empty());
        assert_eq!(response.count, 0);
    }

    #[test]
    fn test_queue_response_clone() {
        let response = QueueResponse {
            items: vec![],
            count: 5,
        };

        let cloned = response.clone();
        assert_eq!(response.count, cloned.count);
    }

    #[test]
    fn test_queue_response_count_matches_items() {
        let response = QueueResponse {
            items: vec![],
            count: 0,
        };

        assert_eq!(response.items.len() as i64, response.count);
    }

    // ==================== QueueAddResponse Tests ====================

    #[test]
    fn test_queue_add_response_serialization() {
        let response = QueueAddResponse {
            added: 3,
            queue_length: 10,
        };

        let json = serde_json::to_string(&response).unwrap();
        assert!(json.contains("\"added\":3"));
        assert!(json.contains("\"queue_length\":10"));
    }

    #[test]
    fn test_queue_add_response_zero_added() {
        let response = QueueAddResponse {
            added: 0,
            queue_length: 5,
        };

        assert_eq!(response.added, 0);
        assert_eq!(response.queue_length, 5);
    }

    #[test]
    fn test_queue_add_response_clone() {
        let response = QueueAddResponse {
            added: 10,
            queue_length: 100,
        };

        let cloned = response.clone();
        assert_eq!(response.added, cloned.added);
        assert_eq!(response.queue_length, cloned.queue_length);
    }

    #[test]
    fn test_queue_add_response_large_values() {
        let response = QueueAddResponse {
            added: 10000,
            queue_length: 100000,
        };

        let json = serde_json::to_string(&response).unwrap();
        assert!(json.contains("\"added\":10000"));
        assert!(json.contains("\"queue_length\":100000"));
    }

    // ==================== QueueAddFilesResponse Tests ====================

    #[test]
    fn test_queue_add_files_response_serialization() {
        let response = QueueAddFilesResponse {
            added: 5,
            queue_length: 15,
            tracks: vec![],
        };

        let json = serde_json::to_string(&response).unwrap();
        assert!(json.contains("\"added\":5"));
        assert!(json.contains("\"queue_length\":15"));
        assert!(json.contains("\"tracks\":[]"));
    }

    #[test]
    fn test_queue_add_files_response_empty_tracks() {
        let response = QueueAddFilesResponse {
            added: 0,
            queue_length: 0,
            tracks: vec![],
        };

        assert!(response.tracks.is_empty());
        assert_eq!(response.added, 0);
    }

    #[test]
    fn test_queue_add_files_response_clone() {
        let response = QueueAddFilesResponse {
            added: 3,
            queue_length: 10,
            tracks: vec![],
        };

        let cloned = response.clone();
        assert_eq!(response.added, cloned.added);
        assert_eq!(response.tracks.len(), cloned.tracks.len());
    }

    // ==================== QueueOperationResponse Tests ====================

    #[test]
    fn test_queue_operation_response_success() {
        let response = QueueOperationResponse {
            success: true,
            queue_length: 10,
        };

        assert!(response.success);
        assert_eq!(response.queue_length, 10);
    }

    #[test]
    fn test_queue_operation_response_failure() {
        let response = QueueOperationResponse {
            success: false,
            queue_length: 5,
        };

        assert!(!response.success);
    }

    #[test]
    fn test_queue_operation_response_serialization() {
        let response = QueueOperationResponse {
            success: true,
            queue_length: 25,
        };

        let json = serde_json::to_string(&response).unwrap();
        assert!(json.contains("\"success\":true"));
        assert!(json.contains("\"queue_length\":25"));
    }

    #[test]
    fn test_queue_operation_response_clone() {
        let response = QueueOperationResponse {
            success: true,
            queue_length: 42,
        };

        let cloned = response.clone();
        assert_eq!(response.success, cloned.success);
        assert_eq!(response.queue_length, cloned.queue_length);
    }

    // ==================== Edge Cases ====================

    #[test]
    fn test_queue_response_deserialization() {
        let json = r#"{"items":[],"count":0}"#;
        let response: QueueResponse = serde_json::from_str(json).unwrap();
        assert_eq!(response.count, 0);
        assert!(response.items.is_empty());
    }

    #[test]
    fn test_queue_add_response_deserialization() {
        let json = r#"{"added":5,"queue_length":20}"#;
        let response: QueueAddResponse = serde_json::from_str(json).unwrap();
        assert_eq!(response.added, 5);
        assert_eq!(response.queue_length, 20);
    }

    #[test]
    fn test_queue_operation_response_deserialization() {
        let json = r#"{"success":false,"queue_length":0}"#;
        let response: QueueOperationResponse = serde_json::from_str(json).unwrap();
        assert!(!response.success);
        assert_eq!(response.queue_length, 0);
    }

    #[test]
    fn test_queue_add_response_added_greater_than_length() {
        // Edge case: added could theoretically be >= queue_length in some scenarios
        let response = QueueAddResponse {
            added: 10,
            queue_length: 10, // Queue was empty, now has 10
        };

        assert_eq!(response.added, response.queue_length);
    }

    #[test]
    fn test_queue_response_max_count() {
        let response = QueueResponse {
            items: vec![],
            count: i64::MAX,
        };

        let json = serde_json::to_string(&response).unwrap();
        let deserialized: QueueResponse = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.count, i64::MAX);
    }

    // ==================== Boundary Conditions ====================

    #[test]
    fn test_queue_operation_response_zero_length() {
        let response = QueueOperationResponse {
            success: true,
            queue_length: 0,
        };

        assert_eq!(response.queue_length, 0);
    }

    #[test]
    fn test_queue_add_files_consistency() {
        // The added count should logically match tracks.len() after a successful add
        let response = QueueAddFilesResponse {
            added: 3,
            queue_length: 10,
            tracks: vec![], // Note: in real usage, tracks would have 3 items
        };

        // This test verifies the response structure can hold mismatched values
        // (validation should happen at the command level, not response level)
        assert_eq!(response.added, 3);
    }

    // ==================== PlayContextResponse Tests ====================

    #[test]
    fn test_play_context_response_serialization() {
        let track = Track {
            id: 1,
            filepath: "/music/track1.mp3".to_string(),
            title: Some("Track 1".to_string()),
            artist: None,
            album: None,
            album_artist: None,
            track_number: None,
            track_total: None,
            disc_number: None,
            disc_total: None,
            date: None,
            genre: None,
            duration: None,
            file_size: 0,
            play_count: 0,
            last_played: None,
            added_date: None,
            missing: false,
            last_seen_at: None,
            file_mtime_ns: None,
            file_ctime_ns: None,
            file_inode: None,
            content_hash: None,
        };

        let response = PlayContextResponse {
            items: vec![],
            current_index: 0,
            track: track.clone(),
            shuffle_enabled: true,
            duration_ms: 180000,
        };

        let json = serde_json::to_string(&response).unwrap();
        assert!(json.contains("\"current_index\":0"));
        assert!(json.contains("\"shuffle_enabled\":true"));
        assert!(json.contains("track1.mp3"));
    }

    #[test]
    fn test_play_context_response_deserialization() {
        let json = r#"{"items":[],"current_index":5,"track":{"id":1,"filepath":"/a.mp3","play_count":0,"missing":false,"file_size":0},"shuffle_enabled":false,"duration_ms":240000}"#;
        let response: PlayContextResponse = serde_json::from_str(json).unwrap();
        assert_eq!(response.current_index, 5);
        assert!(!response.shuffle_enabled);
        assert_eq!(response.track.filepath, "/a.mp3");
    }

    #[test]
    fn test_play_context_response_clone() {
        let track = Track {
            id: 1,
            filepath: "/music/track1.mp3".to_string(),
            title: Some("Track 1".to_string()),
            artist: None,
            album: None,
            album_artist: None,
            track_number: None,
            track_total: None,
            disc_number: None,
            disc_total: None,
            date: None,
            genre: None,
            duration: None,
            file_size: 0,
            play_count: 0,
            last_played: None,
            added_date: None,
            missing: false,
            last_seen_at: None,
            file_mtime_ns: None,
            file_ctime_ns: None,
            file_inode: None,
            content_hash: None,
        };

        let response = PlayContextResponse {
            items: vec![],
            current_index: 0,
            track,
            shuffle_enabled: false,
            duration_ms: 0,
        };

        let cloned = response.clone();
        assert_eq!(response.current_index, cloned.current_index);
        assert_eq!(response.shuffle_enabled, cloned.shuffle_enabled);
        assert_eq!(response.track.id, cloned.track.id);
    }
}
