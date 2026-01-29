//! Tauri commands for favorites management.
//!
//! These commands expose favorites operations to the frontend,
//! replacing the Python FastAPI favorites routes.

use tauri::{AppHandle, State};

use crate::db::{favorites, library, Database, FavoriteTrack, PaginatedResult, Track};
use crate::events::{EventEmitter, FavoritesUpdatedEvent};

/// Response for favorites get operations with pagination
#[derive(Clone, serde::Serialize)]
pub struct FavoritesResponse {
    pub tracks: Vec<FavoriteTrack>,
    pub total: i64,
    pub limit: i64,
    pub offset: i64,
}

/// Response for favorite check operation
#[derive(Clone, serde::Serialize)]
pub struct FavoriteCheckResponse {
    pub is_favorite: bool,
    pub favorited_date: Option<String>,
}

/// Response for favorite add operation
#[derive(Clone, serde::Serialize)]
pub struct FavoriteAddResponse {
    pub success: bool,
    pub favorited_date: Option<String>,
}

/// Response for tracks list operations (top 25, recently played, recently added)
#[derive(Clone, serde::Serialize)]
pub struct TracksResponse {
    pub tracks: Vec<Track>,
}

/// Response for recently played/added tracks with days info
#[derive(Clone, serde::Serialize)]
pub struct RecentTracksResponse {
    pub tracks: Vec<Track>,
    pub days: i64,
}

/// Get favorited tracks (Liked Songs) with pagination
#[tauri::command]
pub fn favorites_get(
    db: State<'_, Database>,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<FavoritesResponse, String> {
    let limit = limit.unwrap_or(100).clamp(1, 1000);
    let offset = offset.unwrap_or(0).max(0);

    let conn = db.conn().map_err(|e| e.to_string())?;
    let result: PaginatedResult<FavoriteTrack> =
        favorites::get_favorites(&conn, limit, offset).map_err(|e| e.to_string())?;

    Ok(FavoritesResponse {
        tracks: result.items,
        total: result.total,
        limit,
        offset,
    })
}

/// Check if a track is favorited
#[tauri::command]
pub fn favorites_check(db: State<'_, Database>, track_id: i64) -> Result<FavoriteCheckResponse, String> {
    let conn = db.conn().map_err(|e| e.to_string())?;
    let (is_favorite, favorited_date) =
        favorites::is_favorite(&conn, track_id).map_err(|e| e.to_string())?;

    Ok(FavoriteCheckResponse {
        is_favorite,
        favorited_date,
    })
}

/// Add a track to favorites
#[tauri::command]
pub fn favorites_add(
    app: AppHandle,
    db: State<'_, Database>,
    track_id: i64,
) -> Result<FavoriteAddResponse, String> {
    let conn = db.conn().map_err(|e| e.to_string())?;

    // Check track exists
    let track = library::get_track_by_id(&conn, track_id).map_err(|e| e.to_string())?;
    if track.is_none() {
        return Err(format!("Track with id {} not found", track_id));
    }

    // Add to favorites
    let favorited_date = favorites::add_favorite(&conn, track_id).map_err(|e| e.to_string())?;

    if favorited_date.is_none() {
        return Err("Track is already favorited".to_string());
    }

    // Emit favorites updated event
    let _ = app.emit_favorites_updated(FavoritesUpdatedEvent::added(track_id));

    Ok(FavoriteAddResponse {
        success: true,
        favorited_date,
    })
}

/// Remove a track from favorites
#[tauri::command]
pub fn favorites_remove(
    app: AppHandle,
    db: State<'_, Database>,
    track_id: i64,
) -> Result<(), String> {
    let conn = db.conn().map_err(|e| e.to_string())?;
    let removed = favorites::remove_favorite(&conn, track_id).map_err(|e| e.to_string())?;

    if !removed {
        return Err(format!("Track with id {} not in favorites", track_id));
    }

    // Emit favorites updated event
    let _ = app.emit_favorites_updated(FavoritesUpdatedEvent::removed(track_id));

    Ok(())
}

/// Get top 25 most played tracks
#[tauri::command]
pub fn favorites_get_top25(db: State<'_, Database>) -> Result<TracksResponse, String> {
    let conn = db.conn().map_err(|e| e.to_string())?;
    let tracks = favorites::get_top_25(&conn).map_err(|e| e.to_string())?;

    Ok(TracksResponse { tracks })
}

/// Get tracks played within the last N days
#[tauri::command]
pub fn favorites_get_recently_played(
    db: State<'_, Database>,
    days: Option<i64>,
    limit: Option<i64>,
) -> Result<RecentTracksResponse, String> {
    let days = days.unwrap_or(14).clamp(1, 365);
    let limit = limit.unwrap_or(100).clamp(1, 1000);

    let conn = db.conn().map_err(|e| e.to_string())?;
    let tracks = favorites::get_recently_played(&conn, days, limit).map_err(|e| e.to_string())?;

    Ok(RecentTracksResponse { tracks, days })
}

/// Get tracks added within the last N days
#[tauri::command]
pub fn favorites_get_recently_added(
    db: State<'_, Database>,
    days: Option<i64>,
    limit: Option<i64>,
) -> Result<RecentTracksResponse, String> {
    let days = days.unwrap_or(14).clamp(1, 365);
    let limit = limit.unwrap_or(100).clamp(1, 1000);

    let conn = db.conn().map_err(|e| e.to_string())?;
    let tracks = favorites::get_recently_added(&conn, days, limit).map_err(|e| e.to_string())?;

    Ok(RecentTracksResponse { tracks, days })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_favorites_response_serialization() {
        let response = FavoritesResponse {
            tracks: vec![],
            total: 0,
            limit: 100,
            offset: 0,
        };

        let json = serde_json::to_string(&response).unwrap();
        assert!(json.contains("\"total\":0"));
        assert!(json.contains("\"tracks\":[]"));
    }

    #[test]
    fn test_favorite_check_response_serialization() {
        let response = FavoriteCheckResponse {
            is_favorite: true,
            favorited_date: Some("2024-01-01 12:00:00".to_string()),
        };

        let json = serde_json::to_string(&response).unwrap();
        assert!(json.contains("\"is_favorite\":true"));
        assert!(json.contains("\"favorited_date\":"));
    }

    #[test]
    fn test_favorite_add_response_serialization() {
        let response = FavoriteAddResponse {
            success: true,
            favorited_date: Some("2024-01-01 12:00:00".to_string()),
        };

        let json = serde_json::to_string(&response).unwrap();
        assert!(json.contains("\"success\":true"));
    }
}
