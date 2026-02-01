//! Tauri commands for queue management.
//!
//! These commands expose queue operations to the frontend,
//! replacing the Python FastAPI queue routes.

use rand::rng;
use rand::seq::SliceRandom;
use tauri::{AppHandle, State};

use crate::db::{queue, Database, QueueItem, QueueState, Track};
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

/// Get the current playback queue with track metadata
#[tauri::command]
pub fn queue_get(db: State<'_, Database>) -> Result<QueueResponse, String> {
    let conn = db.conn().map_err(|e| e.to_string())?;
    let items = queue::get_queue(&conn).map_err(|e| e.to_string())?;
    let count = items.len() as i64;

    Ok(QueueResponse { items, count })
}

/// Add tracks to the queue by track IDs
#[tauri::command]
pub fn queue_add(
    app: AppHandle,
    db: State<'_, Database>,
    track_ids: Vec<i64>,
    position: Option<i64>,
) -> Result<QueueAddResponse, String> {
    if track_ids.is_empty() {
        return Err("track_ids must not be empty".to_string());
    }

    let conn = db.conn().map_err(|e| e.to_string())?;
    let added = queue::add_to_queue(&conn, &track_ids, position).map_err(|e| e.to_string())?;
    let queue_length = queue::get_queue_length(&conn).map_err(|e| e.to_string())?;

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
#[tauri::command]
pub fn queue_add_files(
    app: AppHandle,
    db: State<'_, Database>,
    filepaths: Vec<String>,
    position: Option<i64>,
) -> Result<QueueAddFilesResponse, String> {
    if filepaths.is_empty() {
        return Err("filepaths must not be empty".to_string());
    }

    let conn = db.conn().map_err(|e| e.to_string())?;
    let (added, tracks) =
        queue::add_files_to_queue(&conn, &filepaths, position).map_err(|e| e.to_string())?;
    let queue_length = queue::get_queue_length(&conn).map_err(|e| e.to_string())?;

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
#[tauri::command]
pub fn queue_remove(
    app: AppHandle,
    db: State<'_, Database>,
    position: i64,
) -> Result<(), String> {
    let conn = db.conn().map_err(|e| e.to_string())?;
    let removed = queue::remove_from_queue(&conn, position).map_err(|e| e.to_string())?;

    if !removed {
        return Err(format!("No track at position {}", position));
    }

    let queue_length = queue::get_queue_length(&conn).map_err(|e| e.to_string())?;

    // Emit queue updated event with payload
    let _ = app.emit_queue_updated(QueueUpdatedEvent::removed(position, queue_length));

    Ok(())
}

/// Clear the entire queue
#[tauri::command]
pub fn queue_clear(app: AppHandle, db: State<'_, Database>) -> Result<(), String> {
    let conn = db.conn().map_err(|e| e.to_string())?;
    queue::clear_queue(&conn).map_err(|e| e.to_string())?;

    // Emit queue updated event with payload
    let _ = app.emit_queue_updated(QueueUpdatedEvent::cleared());

    Ok(())
}

/// Reorder tracks in the queue (move from one position to another)
#[tauri::command]
pub fn queue_reorder(
    app: AppHandle,
    db: State<'_, Database>,
    from_position: i64,
    to_position: i64,
) -> Result<QueueOperationResponse, String> {
    let conn = db.conn().map_err(|e| e.to_string())?;
    let success =
        queue::reorder_queue(&conn, from_position, to_position).map_err(|e| e.to_string())?;

    if !success {
        return Err("Invalid positions".to_string());
    }

    let queue_length = queue::get_queue_length(&conn).map_err(|e| e.to_string())?;

    // Emit queue updated event with payload
    let _ = app.emit_queue_updated(QueueUpdatedEvent::reordered(from_position, to_position, queue_length));

    Ok(QueueOperationResponse {
        success,
        queue_length,
    })
}

/// Shuffle the queue using Fisher-Yates algorithm
#[tauri::command]
pub fn queue_shuffle(
    app: AppHandle,
    db: State<'_, Database>,
    keep_current: Option<bool>,
) -> Result<QueueOperationResponse, String> {
    let conn = db.conn().map_err(|e| e.to_string())?;
    let items = queue::get_queue(&conn).map_err(|e| e.to_string())?;

    if items.is_empty() {
        return Ok(QueueOperationResponse {
            success: true,
            queue_length: 0,
        });
    }

    // Get filepaths from queue items
    let mut filepaths: Vec<String> = items.iter().map(|item| item.track.filepath.clone()).collect();

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

    // Rebuild queue with shuffled order
    queue::clear_queue(&conn).map_err(|e| e.to_string())?;

    for filepath in &filepaths {
        conn.execute(
            "INSERT INTO queue (filepath) VALUES (?)",
            rusqlite::params![filepath],
        )
        .map_err(|e| e.to_string())?;
    }

    let queue_length = queue::get_queue_length(&conn).map_err(|e| e.to_string())?;

    // Emit queue updated event with payload
    let _ = app.emit_queue_updated(QueueUpdatedEvent::shuffled(queue_length));

    Ok(QueueOperationResponse {
        success: true,
        queue_length,
    })
}

/// Get queue playback state
#[tauri::command]
pub fn queue_get_playback_state(db: State<'_, Database>) -> Result<QueueState, String> {
    let conn = db.conn().map_err(|e| e.to_string())?;
    let state: QueueState = queue::get_queue_state(&conn).map_err(|e| e.to_string())?;
    Ok(state)
}

/// Set current index in queue playback state
#[tauri::command]
pub fn queue_set_current_index(
    app: AppHandle,
    db: State<'_, Database>,
    index: i64,
) -> Result<(), String> {
    let conn = db.conn().map_err(|e| e.to_string())?;
    queue::set_current_index(&conn, index).map_err(|e| e.to_string())?;

    // Emit state changed event
    let state = queue::get_queue_state(&conn).map_err(|e| e.to_string())?;
    let _ = app.emit_queue_state_changed(QueueStateChangedEvent::new(
        state.current_index,
        state.shuffle_enabled,
        state.loop_mode,
    ));

    Ok(())
}

/// Set shuffle enabled in queue playback state
#[tauri::command]
pub fn queue_set_shuffle(
    app: AppHandle,
    db: State<'_, Database>,
    enabled: bool,
) -> Result<(), String> {
    let conn = db.conn().map_err(|e| e.to_string())?;
    queue::set_shuffle_enabled(&conn, enabled).map_err(|e| e.to_string())?;

    // Emit state changed event
    let state = queue::get_queue_state(&conn).map_err(|e| e.to_string())?;
    let _ = app.emit_queue_state_changed(QueueStateChangedEvent::new(
        state.current_index,
        state.shuffle_enabled,
        state.loop_mode,
    ));

    Ok(())
}

/// Set loop mode in queue playback state
#[tauri::command]
pub fn queue_set_loop(
    app: AppHandle,
    db: State<'_, Database>,
    mode: String,
) -> Result<(), String> {
    let conn = db.conn().map_err(|e| e.to_string())?;
    queue::set_loop_mode(&conn, &mode).map_err(|e| e.to_string())?;

    // Emit state changed event
    let state = queue::get_queue_state(&conn).map_err(|e| e.to_string())?;
    let _ = app.emit_queue_state_changed(QueueStateChangedEvent::new(
        state.current_index,
        state.shuffle_enabled,
        state.loop_mode,
    ));

    Ok(())
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
}
