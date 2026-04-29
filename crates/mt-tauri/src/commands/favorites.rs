//! Tauri commands for favorites management.
//!
//! These commands expose favorites operations to the frontend,
//! replacing the Python FastAPI favorites routes.

use tauri::{AppHandle, State};
use tracing::{debug, warn};

use crate::db::{Database, FavoriteTrack, Track, favorites, library, revision, settings};
use crate::events::{EventEmitter, FavoritesUpdatedEvent, LibraryReconcileEvent};
use crate::lastfm::LastFmClient;

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

/// Check if Last.fm sync is configured and return session key if so.
fn should_sync_lastfm(conn: &rusqlite::Connection) -> Option<String> {
    let session_key = settings::get_setting(conn, "lastfm_session_key").ok()??;
    if session_key.is_empty() {
        return None;
    }
    Some(session_key)
}

/// Sync a love/unlove action to Last.fm in the background.
///
/// Non-blocking: spawns an async task, logs success/failure.
fn sync_lastfm_love(db: &Database, artist: String, title: String, love: bool) {
    let session_key = match db.with_conn(|conn| Ok(should_sync_lastfm(conn))) {
        Ok(Some(key)) => key,
        _ => return,
    };

    let client = LastFmClient::new();
    if !client.is_configured() {
        return;
    }

    tauri::async_runtime::spawn(async move {
        let result = if love {
            client.love_track(&session_key, &artist, &title).await
        } else {
            client.unlove_track(&session_key, &artist, &title).await
        };

        match result {
            Ok(()) => debug!(
                artist = %artist,
                track = %title,
                love,
                "Synced love status to Last.fm"
            ),
            Err(e) => warn!(
                artist = %artist,
                track = %title,
                love,
                error = %e,
                "Failed to sync love status to Last.fm"
            ),
        }
    });
}

/// Get favorited tracks (Liked Songs) with pagination
#[tracing::instrument(skip(db))]
#[tauri::command]
pub(crate) fn favorites_get(
    db: State<'_, Database>,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<FavoritesResponse, String> {
    let limit = limit.unwrap_or(100).clamp(1, 1000);
    let offset = offset.unwrap_or(0).max(0);

    let result = db
        .with_conn(|conn| favorites::get_favorites(conn, limit, offset))
        .map_err(|e| e.to_string())?;

    Ok(FavoritesResponse {
        tracks: result.items,
        total: result.total,
        limit,
        offset,
    })
}

/// Check if a track is favorited
#[tracing::instrument(skip(db))]
#[tauri::command]
pub(crate) fn favorites_check(
    db: State<'_, Database>,
    track_id: i64,
) -> Result<FavoriteCheckResponse, String> {
    let (is_favorite, favorited_date) = db
        .with_conn(|conn| favorites::is_favorite(conn, track_id))
        .map_err(|e| e.to_string())?;

    Ok(FavoriteCheckResponse {
        is_favorite,
        favorited_date,
    })
}

/// Add a track to favorites
#[tracing::instrument(skip(app, db))]
#[tauri::command]
pub(crate) fn favorites_add(
    app: AppHandle,
    db: State<'_, Database>,
    track_id: i64,
) -> Result<FavoriteAddResponse, String> {
    let (track, favorited_date, stats, rev) = db
        .with_conn(|conn| {
            let track = library::get_track_by_id(conn, track_id)?;
            let favorited_date = favorites::add_favorite(conn, track_id)?;
            let stats = library::get_library_stats(conn)?;
            let rev = revision::get_revision(conn)?;
            Ok((track, favorited_date, stats, rev))
        })
        .map_err(|e| e.to_string())?;

    let track = track.ok_or_else(|| format!("Track with id {} not found", track_id))?;

    if favorited_date.is_none() {
        return Err("Track is already favorited".to_string());
    }

    // Emit favorites updated event (player UI) and reconcile event (section counts)
    let _ = app.emit_favorites_updated(FavoritesUpdatedEvent::added(track_id));
    let _ = app.emit_library_reconcile(LibraryReconcileEvent::favorite(
        "add",
        stats.total_tracks,
        stats.total_duration as f64,
        rev,
    ));

    // Sync love to Last.fm
    if let (Some(artist), Some(title)) = (track.artist.clone(), track.title.clone()) {
        sync_lastfm_love(&db, artist, title, true);
    }

    Ok(FavoriteAddResponse {
        success: true,
        favorited_date,
    })
}

/// Remove a track from favorites
#[tracing::instrument(skip(app, db))]
#[tauri::command]
pub(crate) fn favorites_remove(
    app: AppHandle,
    db: State<'_, Database>,
    track_id: i64,
) -> Result<(), String> {
    let (track, removed, stats, rev) = db
        .with_conn(|conn| {
            let track = library::get_track_by_id(conn, track_id)?;
            let removed = favorites::remove_favorite(conn, track_id)?;
            let stats = library::get_library_stats(conn)?;
            let rev = revision::get_revision(conn)?;
            Ok((track, removed, stats, rev))
        })
        .map_err(|e| e.to_string())?;

    if !removed {
        return Err(format!("Track with id {} not in favorites", track_id));
    }

    // Emit favorites updated event (player UI) and reconcile event (section counts)
    let _ = app.emit_favorites_updated(FavoritesUpdatedEvent::removed(track_id));
    let _ = app.emit_library_reconcile(LibraryReconcileEvent::favorite(
        "remove",
        stats.total_tracks,
        stats.total_duration as f64,
        rev,
    ));

    // Sync unlove to Last.fm
    if let Some(track) = track
        && let (Some(artist), Some(title)) = (track.artist, track.title)
    {
        sync_lastfm_love(&db, artist, title, false);
    }

    Ok(())
}

/// Get top 25 most played tracks
#[tracing::instrument(skip(db))]
#[tauri::command]
pub(crate) fn favorites_get_top25(db: State<'_, Database>) -> Result<TracksResponse, String> {
    let tracks = db
        .with_conn(favorites::get_top_25)
        .map_err(|e| e.to_string())?;

    Ok(TracksResponse { tracks })
}

/// Get tracks played within the last N days
#[tracing::instrument(skip(db))]
#[tauri::command]
pub(crate) fn favorites_get_recently_played(
    db: State<'_, Database>,
    days: Option<i64>,
    limit: Option<i64>,
) -> Result<RecentTracksResponse, String> {
    let days = days.unwrap_or(14).clamp(1, 365);
    let limit = limit.unwrap_or(100).clamp(1, 1000);

    let tracks = db
        .with_conn(|conn| favorites::get_recently_played(conn, days, limit))
        .map_err(|e| e.to_string())?;

    Ok(RecentTracksResponse { tracks, days })
}

/// Get tracks added within the last N days
#[tracing::instrument(skip(db))]
#[tauri::command]
pub(crate) fn favorites_get_recently_added(
    db: State<'_, Database>,
    days: Option<i64>,
    limit: Option<i64>,
) -> Result<RecentTracksResponse, String> {
    let days = days.unwrap_or(14).clamp(1, 365);
    let limit = limit.unwrap_or(100).clamp(1, 1000);

    let tracks = db
        .with_conn(|conn| favorites::get_recently_added(conn, days, limit))
        .map_err(|e| e.to_string())?;

    Ok(RecentTracksResponse { tracks, days })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema::{create_tables, run_migrations};

    fn setup_test_db() -> rusqlite::Connection {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        create_tables(&conn).unwrap();
        run_migrations(&conn).unwrap();
        conn
    }

    #[test]
    fn test_should_sync_no_session() {
        let conn = setup_test_db();
        // No session key set at all
        assert!(should_sync_lastfm(&conn).is_none());
    }

    #[test]
    fn test_should_sync_empty_session() {
        let conn = setup_test_db();
        settings::set_setting(&conn, "lastfm_session_key", &serde_json::json!("")).unwrap();
        assert!(should_sync_lastfm(&conn).is_none());
    }

    #[test]
    fn test_should_sync_with_session() {
        let conn = setup_test_db();
        settings::set_setting(&conn, "lastfm_session_key", &serde_json::json!("abc123")).unwrap();
        assert_eq!(should_sync_lastfm(&conn), Some("abc123".to_string()));
    }

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
