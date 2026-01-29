//! Tauri commands for playlist management.
//!
//! These commands expose playlist operations to the frontend,
//! replacing the Python FastAPI playlist routes.

use tauri::{AppHandle, State};

use crate::db::{playlists, Database, Playlist, PlaylistWithTracks};
use crate::events::{EventEmitter, PlaylistsUpdatedEvent};

/// Response for playlist list operations
#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct PlaylistListResponse {
    pub playlists: Vec<Playlist>,
    pub count: i64,
}

/// Response for operations that return a single playlist
#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct PlaylistResponse {
    pub playlist: Option<Playlist>,
}

/// Response for add tracks operation
#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct PlaylistAddTracksResponse {
    pub added: i64,
    pub track_count: i64,
}

/// Response for operations that return success status
#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct PlaylistOperationResponse {
    pub success: bool,
}

/// Response for generate name operation
#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct PlaylistGenerateNameResponse {
    pub name: String,
}

/// Get all playlists with track counts
#[tauri::command]
pub fn playlist_list(db: State<'_, Database>) -> Result<PlaylistListResponse, String> {
    let conn = db.conn().map_err(|e| e.to_string())?;
    let playlists = playlists::get_playlists(&conn).map_err(|e| e.to_string())?;
    let count = playlists.len() as i64;

    Ok(PlaylistListResponse { playlists, count })
}

/// Create a new playlist
#[tauri::command]
pub fn playlist_create(
    app: AppHandle,
    db: State<'_, Database>,
    name: String,
) -> Result<PlaylistResponse, String> {
    if name.trim().is_empty() {
        return Err("Playlist name cannot be empty".to_string());
    }

    let conn = db.conn().map_err(|e| e.to_string())?;
    let playlist = playlists::create_playlist(&conn, &name).map_err(|e| e.to_string())?;

    if let Some(ref p) = playlist {
        let _ = app.emit_playlists_updated(PlaylistsUpdatedEvent::created(p.id));
    }

    Ok(PlaylistResponse { playlist })
}

/// Get a playlist with its tracks
#[tauri::command]
pub fn playlist_get(
    db: State<'_, Database>,
    playlist_id: i64,
) -> Result<Option<PlaylistWithTracks>, String> {
    let conn = db.conn().map_err(|e| e.to_string())?;
    playlists::get_playlist(&conn, playlist_id).map_err(|e| e.to_string())
}

/// Update playlist metadata (name)
#[tauri::command]
pub fn playlist_update(
    app: AppHandle,
    db: State<'_, Database>,
    playlist_id: i64,
    name: Option<String>,
) -> Result<PlaylistResponse, String> {
    let conn = db.conn().map_err(|e| e.to_string())?;
    let playlist =
        playlists::update_playlist(&conn, playlist_id, name.as_deref()).map_err(|e| e.to_string())?;

    if playlist.is_some() && name.is_some() {
        let _ = app.emit_playlists_updated(PlaylistsUpdatedEvent::renamed(playlist_id));
    }

    Ok(PlaylistResponse { playlist })
}

/// Delete a playlist
#[tauri::command]
pub fn playlist_delete(
    app: AppHandle,
    db: State<'_, Database>,
    playlist_id: i64,
) -> Result<PlaylistOperationResponse, String> {
    let conn = db.conn().map_err(|e| e.to_string())?;
    let success = playlists::delete_playlist(&conn, playlist_id).map_err(|e| e.to_string())?;

    if success {
        let _ = app.emit_playlists_updated(PlaylistsUpdatedEvent::deleted(playlist_id));
    }

    Ok(PlaylistOperationResponse { success })
}

/// Add tracks to a playlist
#[tauri::command]
pub fn playlist_add_tracks(
    app: AppHandle,
    db: State<'_, Database>,
    playlist_id: i64,
    track_ids: Vec<i64>,
    position: Option<i64>,
) -> Result<PlaylistAddTracksResponse, String> {
    if track_ids.is_empty() {
        return Err("track_ids must not be empty".to_string());
    }

    let conn = db.conn().map_err(|e| e.to_string())?;
    let added =
        playlists::add_tracks_to_playlist(&conn, playlist_id, &track_ids, position)
            .map_err(|e| e.to_string())?;
    let track_count =
        playlists::get_playlist_track_count(&conn, playlist_id).map_err(|e| e.to_string())?;

    let _ = app.emit_playlists_updated(PlaylistsUpdatedEvent::tracks_added(playlist_id, track_ids));

    Ok(PlaylistAddTracksResponse {
        added,
        track_count,
    })
}

/// Remove a track from a playlist by position
#[tauri::command]
pub fn playlist_remove_track(
    app: AppHandle,
    db: State<'_, Database>,
    playlist_id: i64,
    position: i64,
) -> Result<PlaylistOperationResponse, String> {
    let conn = db.conn().map_err(|e| e.to_string())?;
    let success =
        playlists::remove_track_from_playlist(&conn, playlist_id, position)
            .map_err(|e| e.to_string())?;

    if success {
        let _ = app.emit_playlists_updated(PlaylistsUpdatedEvent::tracks_removed(playlist_id, vec![]));
    }

    Ok(PlaylistOperationResponse { success })
}

/// Reorder tracks within a playlist
#[tauri::command]
pub fn playlist_reorder_tracks(
    app: AppHandle,
    db: State<'_, Database>,
    playlist_id: i64,
    from_position: i64,
    to_position: i64,
) -> Result<PlaylistOperationResponse, String> {
    let conn = db.conn().map_err(|e| e.to_string())?;
    let success =
        playlists::reorder_playlist(&conn, playlist_id, from_position, to_position)
            .map_err(|e| e.to_string())?;

    if success {
        let _ = app.emit_playlists_updated(PlaylistsUpdatedEvent::reordered(playlist_id));
    }

    Ok(PlaylistOperationResponse { success })
}

/// Reorder playlists in the sidebar
#[tauri::command]
pub fn playlists_reorder(
    app: AppHandle,
    db: State<'_, Database>,
    from_position: i64,
    to_position: i64,
) -> Result<PlaylistOperationResponse, String> {
    let conn = db.conn().map_err(|e| e.to_string())?;
    let success =
        playlists::reorder_playlists(&conn, from_position, to_position)
            .map_err(|e| e.to_string())?;

    if success {
        // Use playlist_id=0 to indicate sidebar reorder (affects all playlists)
        let _ = app.emit_playlists_updated(PlaylistsUpdatedEvent::reordered(0));
    }

    Ok(PlaylistOperationResponse { success })
}

/// Generate a unique playlist name
#[tauri::command]
pub fn playlist_generate_name(
    db: State<'_, Database>,
    base: Option<String>,
) -> Result<PlaylistGenerateNameResponse, String> {
    let base_name = base.as_deref().unwrap_or("New playlist");
    let conn = db.conn().map_err(|e| e.to_string())?;
    let name =
        playlists::generate_unique_playlist_name(&conn, base_name).map_err(|e| e.to_string())?;

    Ok(PlaylistGenerateNameResponse { name })
}

#[cfg(test)]
mod tests {
    use super::*;

    // ==================== PlaylistListResponse Tests ====================

    #[test]
    fn test_playlist_list_response_serialization() {
        let response = PlaylistListResponse {
            playlists: vec![],
            count: 0,
        };

        let json = serde_json::to_string(&response).unwrap();
        assert!(json.contains("\"count\":0"));
        assert!(json.contains("\"playlists\":[]"));
    }

    #[test]
    fn test_playlist_list_response_empty() {
        let response = PlaylistListResponse {
            playlists: vec![],
            count: 0,
        };

        assert!(response.playlists.is_empty());
        assert_eq!(response.count, 0);
    }

    #[test]
    fn test_playlist_list_response_clone() {
        let response = PlaylistListResponse {
            playlists: vec![],
            count: 5,
        };

        let cloned = response.clone();
        assert_eq!(response.count, cloned.count);
        assert_eq!(response.playlists.len(), cloned.playlists.len());
    }

    #[test]
    fn test_playlist_list_response_deserialization() {
        let json = r#"{"playlists":[],"count":0}"#;
        let response: PlaylistListResponse = serde_json::from_str(json).unwrap();
        assert_eq!(response.count, 0);
        assert!(response.playlists.is_empty());
    }

    // ==================== PlaylistResponse Tests ====================

    #[test]
    fn test_playlist_response_with_none() {
        let response = PlaylistResponse { playlist: None };

        let json = serde_json::to_string(&response).unwrap();
        assert!(json.contains("\"playlist\":null"));
    }

    #[test]
    fn test_playlist_response_clone() {
        let response = PlaylistResponse { playlist: None };

        let cloned = response.clone();
        assert!(cloned.playlist.is_none());
    }

    #[test]
    fn test_playlist_response_deserialization() {
        let json = r#"{"playlist":null}"#;
        let response: PlaylistResponse = serde_json::from_str(json).unwrap();
        assert!(response.playlist.is_none());
    }

    // ==================== PlaylistAddTracksResponse Tests ====================

    #[test]
    fn test_playlist_add_tracks_response_serialization() {
        let response = PlaylistAddTracksResponse {
            added: 5,
            track_count: 10,
        };

        let json = serde_json::to_string(&response).unwrap();
        assert!(json.contains("\"added\":5"));
        assert!(json.contains("\"track_count\":10"));
    }

    #[test]
    fn test_playlist_add_tracks_response_zero_added() {
        let response = PlaylistAddTracksResponse {
            added: 0,
            track_count: 5,
        };

        assert_eq!(response.added, 0);
        assert_eq!(response.track_count, 5);
    }

    #[test]
    fn test_playlist_add_tracks_response_clone() {
        let response = PlaylistAddTracksResponse {
            added: 10,
            track_count: 100,
        };

        let cloned = response.clone();
        assert_eq!(response.added, cloned.added);
        assert_eq!(response.track_count, cloned.track_count);
    }

    #[test]
    fn test_playlist_add_tracks_response_deserialization() {
        let json = r#"{"added":3,"track_count":15}"#;
        let response: PlaylistAddTracksResponse = serde_json::from_str(json).unwrap();
        assert_eq!(response.added, 3);
        assert_eq!(response.track_count, 15);
    }

    #[test]
    fn test_playlist_add_tracks_response_large_values() {
        let response = PlaylistAddTracksResponse {
            added: 5000,
            track_count: 50000,
        };

        let json = serde_json::to_string(&response).unwrap();
        let deserialized: PlaylistAddTracksResponse = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.added, 5000);
        assert_eq!(deserialized.track_count, 50000);
    }

    // ==================== PlaylistOperationResponse Tests ====================

    #[test]
    fn test_playlist_operation_response_success() {
        let response = PlaylistOperationResponse { success: true };

        assert!(response.success);
    }

    #[test]
    fn test_playlist_operation_response_failure() {
        let response = PlaylistOperationResponse { success: false };

        assert!(!response.success);
    }

    #[test]
    fn test_playlist_operation_response_serialization() {
        let response = PlaylistOperationResponse { success: true };

        let json = serde_json::to_string(&response).unwrap();
        assert!(json.contains("\"success\":true"));
    }

    #[test]
    fn test_playlist_operation_response_clone() {
        let response = PlaylistOperationResponse { success: true };

        let cloned = response.clone();
        assert_eq!(response.success, cloned.success);
    }

    #[test]
    fn test_playlist_operation_response_deserialization() {
        let json = r#"{"success":false}"#;
        let response: PlaylistOperationResponse = serde_json::from_str(json).unwrap();
        assert!(!response.success);
    }

    // ==================== PlaylistGenerateNameResponse Tests ====================

    #[test]
    fn test_playlist_generate_name_response() {
        let response = PlaylistGenerateNameResponse {
            name: "New playlist".to_string(),
        };

        assert_eq!(response.name, "New playlist");
    }

    #[test]
    fn test_playlist_generate_name_response_serialization() {
        let response = PlaylistGenerateNameResponse {
            name: "My Playlist (2)".to_string(),
        };

        let json = serde_json::to_string(&response).unwrap();
        assert!(json.contains("\"name\":\"My Playlist (2)\""));
    }

    #[test]
    fn test_playlist_generate_name_response_clone() {
        let response = PlaylistGenerateNameResponse {
            name: "Test Playlist".to_string(),
        };

        let cloned = response.clone();
        assert_eq!(response.name, cloned.name);
    }

    #[test]
    fn test_playlist_generate_name_response_deserialization() {
        let json = r#"{"name":"Favorites"}"#;
        let response: PlaylistGenerateNameResponse = serde_json::from_str(json).unwrap();
        assert_eq!(response.name, "Favorites");
    }

    #[test]
    fn test_playlist_generate_name_response_empty_name() {
        let response = PlaylistGenerateNameResponse {
            name: "".to_string(),
        };

        assert!(response.name.is_empty());
    }

    #[test]
    fn test_playlist_generate_name_response_unicode() {
        let response = PlaylistGenerateNameResponse {
            name: "プレイリスト 🎵".to_string(),
        };

        let json = serde_json::to_string(&response).unwrap();
        let deserialized: PlaylistGenerateNameResponse = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.name, "プレイリスト 🎵");
    }

    #[test]
    fn test_playlist_generate_name_response_special_chars() {
        let response = PlaylistGenerateNameResponse {
            name: "Artist - Album [2024]".to_string(),
        };

        let json = serde_json::to_string(&response).unwrap();
        let deserialized: PlaylistGenerateNameResponse = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.name, "Artist - Album [2024]");
    }

    // ==================== Edge Cases ====================

    #[test]
    fn test_playlist_list_response_count_consistency() {
        let response = PlaylistListResponse {
            playlists: vec![],
            count: 0,
        };

        assert_eq!(response.playlists.len() as i64, response.count);
    }

    #[test]
    fn test_playlist_add_tracks_all_duplicates() {
        // When all tracks are duplicates, added should be 0
        let response = PlaylistAddTracksResponse {
            added: 0,
            track_count: 10, // Existing tracks unchanged
        };

        assert_eq!(response.added, 0);
        assert_eq!(response.track_count, 10);
    }

    #[test]
    fn test_playlist_list_response_max_count() {
        let response = PlaylistListResponse {
            playlists: vec![],
            count: i64::MAX,
        };

        let json = serde_json::to_string(&response).unwrap();
        let deserialized: PlaylistListResponse = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.count, i64::MAX);
    }
}
