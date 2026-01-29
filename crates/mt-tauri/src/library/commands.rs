//! Tauri commands for library management.
//!
//! These commands expose library operations to the frontend,
//! replacing the Python FastAPI library routes.

use std::path::Path;
use tauri::{AppHandle, State};

use crate::db::{
    library, Database, LibraryStats, SortOrder, Track, TrackMetadata,
};
use crate::events::{EventEmitter, LibraryUpdatedEvent};
use crate::scanner::artwork::Artwork;
use crate::scanner::artwork_cache::ArtworkCache;
use crate::scanner::fingerprint::{compute_content_hash, FileFingerprint};
use crate::scanner::metadata::extract_metadata;

/// Response for paginated library queries
#[derive(Clone, serde::Serialize)]
pub struct LibraryResponse {
    pub tracks: Vec<Track>,
    pub total: i64,
    pub limit: i64,
    pub offset: i64,
}

/// Response for missing tracks queries
#[derive(Clone, serde::Serialize)]
pub struct MissingTracksResponse {
    pub tracks: Vec<Track>,
    pub total: i64,
}

/// Get all tracks with filtering, sorting, and pagination
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub fn library_get_all(
    db: State<'_, Database>,
    search: Option<String>,
    artist: Option<String>,
    album: Option<String>,
    sort_by: Option<String>,
    sort_order: Option<String>,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<LibraryResponse, String> {
    let conn = db.conn().map_err(|e| e.to_string())?;

    // Update file sizes for tracks that have 0 (background operation)
    let _ = library::update_file_sizes(&conn);

    let query = library::LibraryQuery {
        search,
        artist,
        album,
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
        limit: limit.unwrap_or(100),
        offset: offset.unwrap_or(0),
    };

    let result = library::get_all_tracks(&conn, &query).map_err(|e| e.to_string())?;

    Ok(LibraryResponse {
        tracks: result.items,
        total: result.total,
        limit: query.limit,
        offset: query.offset,
    })
}

/// Get library statistics
#[tauri::command]
pub fn library_get_stats(db: State<'_, Database>) -> Result<LibraryStats, String> {
    let conn = db.conn().map_err(|e| e.to_string())?;
    library::get_library_stats(&conn).map_err(|e| e.to_string())
}

/// Get a single track by ID
#[tauri::command]
pub fn library_get_track(db: State<'_, Database>, track_id: i64) -> Result<Option<Track>, String> {
    let conn = db.conn().map_err(|e| e.to_string())?;
    library::get_track_by_id(&conn, track_id).map_err(|e| e.to_string())
}

/// Get artwork for a track by ID (uses LRU cache)
#[tauri::command]
pub fn library_get_artwork(
    db: State<'_, Database>,
    cache: State<'_, ArtworkCache>,
    track_id: i64,
) -> Result<Option<Artwork>, String> {
    let conn = db.conn().map_err(|e| e.to_string())?;

    let track = library::get_track_by_id(&conn, track_id).map_err(|e| e.to_string())?;

    match track {
        Some(t) => Ok(cache.get_or_load(track_id, &t.filepath)),
        None => Err(format!("Track with id {} not found", track_id)),
    }
}

/// Get artwork data URL for a track by ID (for use in img src, uses LRU cache)
#[tauri::command]
pub fn library_get_artwork_url(
    db: State<'_, Database>,
    cache: State<'_, ArtworkCache>,
    track_id: i64,
) -> Result<Option<String>, String> {
    let conn = db.conn().map_err(|e| e.to_string())?;

    let track = library::get_track_by_id(&conn, track_id).map_err(|e| e.to_string())?;

    match track {
        Some(t) => {
            let artwork = cache.get_or_load(track_id, &t.filepath);
            Ok(artwork.map(|a| format!("data:{};base64,{}", a.mime_type, a.data)))
        }
        None => Err(format!("Track with id {} not found", track_id)),
    }
}

/// Delete a track from the library
#[tauri::command]
pub fn library_delete_track(
    app: AppHandle,
    db: State<'_, Database>,
    track_id: i64,
) -> Result<bool, String> {
    let conn = db.conn().map_err(|e| e.to_string())?;

    let deleted = library::delete_track(&conn, track_id).map_err(|e| e.to_string())?;

    if deleted {
        // Emit standardized library updated event
        let _ = app.emit_library_updated(LibraryUpdatedEvent::deleted(vec![track_id]));
    }

    Ok(deleted)
}

/// Rescan a track's metadata from its file
#[tauri::command]
pub fn library_rescan_track(
    app: AppHandle,
    db: State<'_, Database>,
    cache: State<'_, ArtworkCache>,
    track_id: i64,
) -> Result<Track, String> {
    let conn = db.conn().map_err(|e| e.to_string())?;

    // Get the existing track
    let track = library::get_track_by_id(&conn, track_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Track with id {} not found", track_id))?;

    // Extract fresh metadata
    let extracted = extract_metadata(&track.filepath)
        .map_err(|e| format!("Failed to extract metadata: {}", e))?;

    // Convert to TrackMetadata for update
    let metadata = TrackMetadata {
        title: extracted.title,
        artist: extracted.artist,
        album: extracted.album,
        album_artist: extracted.album_artist,
        track_number: extracted.track_number,
        track_total: extracted.track_total,
        date: extracted.date,
        duration: extracted.duration,
        file_size: Some(extracted.file_size),
        file_mtime_ns: extracted.file_mtime_ns,
        file_inode: None,
        content_hash: None,
    };

    // Update in database
    library::update_track_metadata(&conn, track_id, &metadata).map_err(|e| e.to_string())?;

    // Invalidate artwork cache since metadata (and potentially artwork) changed
    cache.invalidate(track_id);

    // Get updated track
    let updated_track = library::get_track_by_id(&conn, track_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Track not found after update".to_string())?;

    // Emit standardized library updated event
    let _ = app.emit_library_updated(LibraryUpdatedEvent::modified(vec![track_id]));

    Ok(updated_track)
}

/// Increment play count for a track
#[tauri::command]
pub fn library_update_play_count(
    app: AppHandle,
    db: State<'_, Database>,
    track_id: i64,
) -> Result<Track, String> {
    let conn = db.conn().map_err(|e| e.to_string())?;

    let track = library::update_play_count(&conn, track_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Track with id {} not found", track_id))?;

    // Emit standardized library updated event
    let _ = app.emit_library_updated(LibraryUpdatedEvent::modified(vec![track_id]));

    Ok(track)
}

/// Get all tracks marked as missing
#[tauri::command]
pub fn library_get_missing(db: State<'_, Database>) -> Result<MissingTracksResponse, String> {
    let conn = db.conn().map_err(|e| e.to_string())?;

    let tracks = library::get_missing_tracks(&conn).map_err(|e| e.to_string())?;
    let total = tracks.len() as i64;

    Ok(MissingTracksResponse { tracks, total })
}

/// Update a missing track's filepath after user locates the file
/// If the new path already exists as another track (duplicate), the duplicate is removed
/// and the original track's path is updated (preserving play history, favorites, etc.)
#[tauri::command]
pub fn library_locate_track(
    app: AppHandle,
    db: State<'_, Database>,
    track_id: i64,
    new_path: String,
) -> Result<Track, String> {
    // Verify the new path exists
    if !Path::new(&new_path).exists() {
        return Err(format!("File not found: {}", new_path));
    }

    let conn = db.conn().map_err(|e| e.to_string())?;

    // Verify the track exists
    library::get_track_by_id(&conn, track_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Track with id {} not found", track_id))?;

    // Check if another track already exists at the new path (duplicate scenario)
    // This can happen when:
    // 1. A file was moved, creating a "missing" track at old path
    // 2. The watcher detected the file at new location and added it as a "new" track
    // 3. User uses "Locate" to point the missing track to the same file
    let mut deleted_duplicate_id: Option<i64> = None;
    if let Ok(Some(existing_track)) = library::get_track_by_filepath(&conn, &new_path)
        && existing_track.id != track_id {
            // There's a duplicate track at this path - remove it
            // The original track (being located) takes precedence to preserve play history
            println!(
                "[locate] Removing duplicate track {} at path {} (keeping original track {})",
                existing_track.id, new_path, track_id
            );
            library::delete_track(&conn, existing_track.id).map_err(|e| e.to_string())?;
            deleted_duplicate_id = Some(existing_track.id);
        }

    // Update the filepath (also clears missing flag and updates last_seen_at)
    library::update_track_filepath(&conn, track_id, &new_path).map_err(|e| e.to_string())?;

    // Get updated track
    let updated_track = library::get_track_by_id(&conn, track_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Track not found after update".to_string())?;

    // Emit library updated events
    let _ = app.emit_library_updated(LibraryUpdatedEvent::modified(vec![track_id]));

    // If we removed a duplicate, emit deleted event for it
    if let Some(dup_id) = deleted_duplicate_id {
        let _ = app.emit_library_updated(LibraryUpdatedEvent::deleted(vec![dup_id]));
    }

    Ok(updated_track)
}

/// Check if a track's file exists and update its missing status
#[tauri::command]
pub fn library_check_status(
    app: AppHandle,
    db: State<'_, Database>,
    track_id: i64,
) -> Result<Track, String> {
    let conn = db.conn().map_err(|e| e.to_string())?;

    let track = library::check_and_update_track_status(&conn, track_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Track with id {} not found", track_id))?;

    // Emit standardized library updated event
    let _ = app.emit_library_updated(LibraryUpdatedEvent::modified(vec![track_id]));

    Ok(track)
}

/// Manually mark a track as missing
#[tauri::command]
pub fn library_mark_missing(
    app: AppHandle,
    db: State<'_, Database>,
    track_id: i64,
) -> Result<Track, String> {
    let conn = db.conn().map_err(|e| e.to_string())?;

    let marked = library::mark_track_missing(&conn, track_id).map_err(|e| e.to_string())?;

    if !marked {
        return Err(format!("Track with id {} not found", track_id));
    }

    let track = library::get_track_by_id(&conn, track_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Track not found after marking".to_string())?;

    // Emit standardized library updated event
    let _ = app.emit_library_updated(LibraryUpdatedEvent::modified(vec![track_id]));

    Ok(track)
}

/// Manually mark a track as present (not missing)
#[tauri::command]
pub fn library_mark_present(
    app: AppHandle,
    db: State<'_, Database>,
    track_id: i64,
) -> Result<Track, String> {
    let conn = db.conn().map_err(|e| e.to_string())?;

    let marked = library::mark_track_present(&conn, track_id).map_err(|e| e.to_string())?;

    if !marked {
        return Err(format!("Track with id {} not found", track_id));
    }

    let track = library::get_track_by_id(&conn, track_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Track not found after marking".to_string())?;

    // Emit standardized library updated event
    let _ = app.emit_library_updated(LibraryUpdatedEvent::modified(vec![track_id]));

    Ok(track)
}

#[derive(Clone, serde::Serialize)]
pub struct ReconcileScanResult {
    pub backfilled: u32,
    pub duplicates_merged: u32,
    pub errors: u32,
}

#[tauri::command]
pub fn library_reconcile_scan(
    app: AppHandle,
    db: State<'_, Database>,
) -> Result<ReconcileScanResult, String> {
    let conn = db.conn().map_err(|e| e.to_string())?;

    let mut backfilled = 0u32;
    let mut errors = 0u32;

    let tracks = library::get_tracks_needing_fingerprints(&conn).map_err(|e| e.to_string())?;

    for track in tracks {
        let path = std::path::Path::new(&track.filepath);
        if !path.exists() {
            continue;
        }

        let fingerprint = match FileFingerprint::from_path(path) {
            Ok(fp) => fp,
            Err(_) => {
                errors += 1;
                continue;
            }
        };

        let content_hash = match compute_content_hash(path) {
            Ok(h) => Some(h),
            Err(_) => {
                errors += 1;
                None
            }
        };

        match library::update_track_fingerprints(
            &conn,
            track.id,
            fingerprint.inode,
            content_hash.as_deref(),
        ) {
            Ok(true) => backfilled += 1,
            Ok(false) => {}
            Err(_) => errors += 1,
        }
    }

    let mut duplicates_merged = 0u32;
    let mut deleted_ids = Vec::new();

    let inode_dups = library::find_duplicates_by_inode(&conn).map_err(|e| e.to_string())?;
    for group in inode_dups {
        if group.len() < 2 {
            continue;
        }
        let keep = &group[0];
        for dup in &group[1..] {
            match library::merge_duplicate_tracks(&conn, keep.id, dup.id) {
                Ok(true) => {
                    duplicates_merged += 1;
                    deleted_ids.push(dup.id);
                }
                Ok(false) => {}
                Err(_) => errors += 1,
            }
        }
    }

    let hash_dups = library::find_duplicates_by_content_hash(&conn).map_err(|e| e.to_string())?;
    for group in hash_dups {
        if group.len() < 2 {
            continue;
        }
        let keep = &group[0];
        for dup in &group[1..] {
            if deleted_ids.contains(&dup.id) {
                continue;
            }
            match library::merge_duplicate_tracks(&conn, keep.id, dup.id) {
                Ok(true) => {
                    duplicates_merged += 1;
                    deleted_ids.push(dup.id);
                }
                Ok(false) => {}
                Err(_) => errors += 1,
            }
        }
    }

    if !deleted_ids.is_empty() {
        let _ = app.emit_library_updated(LibraryUpdatedEvent::deleted(deleted_ids));
    }

    Ok(ReconcileScanResult {
        backfilled,
        duplicates_merged,
        errors,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    // =========================================================================
    // LibraryResponse tests
    // =========================================================================

    #[test]
    fn test_library_response_serialization() {
        let response = LibraryResponse {
            tracks: vec![],
            total: 0,
            limit: 100,
            offset: 0,
        };

        let json = serde_json::to_string(&response).unwrap();
        assert!(json.contains("\"total\":0"));
        assert!(json.contains("\"limit\":100"));
    }

    #[test]
    fn test_library_response_with_pagination() {
        let response = LibraryResponse {
            tracks: vec![],
            total: 500,
            limit: 50,
            offset: 100,
        };

        let json = serde_json::to_string(&response).unwrap();
        assert!(json.contains("\"total\":500"));
        assert!(json.contains("\"limit\":50"));
        assert!(json.contains("\"offset\":100"));
    }

    #[test]
    fn test_library_response_clone() {
        let response = LibraryResponse {
            tracks: vec![],
            total: 10,
            limit: 10,
            offset: 0,
        };

        let cloned = response.clone();
        assert_eq!(response.total, cloned.total);
        assert_eq!(response.limit, cloned.limit);
        assert_eq!(response.offset, cloned.offset);
    }

    #[test]
    fn test_library_response_large_values() {
        let response = LibraryResponse {
            tracks: vec![],
            total: 1_000_000,
            limit: 1000,
            offset: 999_000,
        };

        let json = serde_json::to_string(&response).unwrap();
        assert!(json.contains("\"total\":1000000"));
    }

    // =========================================================================
    // MissingTracksResponse tests
    // =========================================================================

    #[test]
    fn test_missing_tracks_response_serialization() {
        let response = MissingTracksResponse {
            tracks: vec![],
            total: 0,
        };

        let json = serde_json::to_string(&response).unwrap();
        assert!(json.contains("\"tracks\":[]"));
        assert!(json.contains("\"total\":0"));
    }

    #[test]
    fn test_missing_tracks_response_with_count() {
        let response = MissingTracksResponse {
            tracks: vec![],
            total: 25,
        };

        let json = serde_json::to_string(&response).unwrap();
        assert!(json.contains("\"total\":25"));
    }

    #[test]
    fn test_missing_tracks_response_clone() {
        let response = MissingTracksResponse {
            tracks: vec![],
            total: 5,
        };

        let cloned = response.clone();
        assert_eq!(response.total, cloned.total);
        assert_eq!(response.tracks.len(), cloned.tracks.len());
    }

    // =========================================================================
    // ReconcileScanResult tests
    // =========================================================================

    #[test]
    fn test_reconcile_scan_result_serialization() {
        let result = ReconcileScanResult {
            backfilled: 10,
            duplicates_merged: 5,
            errors: 2,
        };

        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("\"backfilled\":10"));
        assert!(json.contains("\"duplicates_merged\":5"));
        assert!(json.contains("\"errors\":2"));
    }

    #[test]
    fn test_reconcile_scan_result_zero_values() {
        let result = ReconcileScanResult {
            backfilled: 0,
            duplicates_merged: 0,
            errors: 0,
        };

        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("\"backfilled\":0"));
        assert!(json.contains("\"duplicates_merged\":0"));
        assert!(json.contains("\"errors\":0"));
    }

    #[test]
    fn test_reconcile_scan_result_clone() {
        let result = ReconcileScanResult {
            backfilled: 100,
            duplicates_merged: 20,
            errors: 3,
        };

        let cloned = result.clone();
        assert_eq!(result.backfilled, cloned.backfilled);
        assert_eq!(result.duplicates_merged, cloned.duplicates_merged);
        assert_eq!(result.errors, cloned.errors);
    }

    #[test]
    fn test_reconcile_scan_result_large_values() {
        let result = ReconcileScanResult {
            backfilled: 10_000,
            duplicates_merged: 5_000,
            errors: 100,
        };

        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("\"backfilled\":10000"));
        assert!(json.contains("\"duplicates_merged\":5000"));
    }

    // =========================================================================
    // Pagination calculation tests
    // =========================================================================

    #[test]
    fn test_pagination_first_page() {
        let limit = 50i64;
        let offset = 0i64;
        let total = 100i64;

        assert_eq!(offset, 0);
        assert!(offset + limit <= total || offset < total);
    }

    #[test]
    fn test_pagination_middle_page() {
        let limit = 50i64;
        let offset = 50i64;

        let current_page = offset / limit + 1;
        assert_eq!(current_page, 2);
    }

    #[test]
    fn test_pagination_last_page() {
        let total = 125i64;
        let offset = 100i64; // Last page with 25 items

        let remaining = total - offset;
        assert_eq!(remaining, 25);
    }

    #[test]
    fn test_pagination_beyond_total() {
        let limit = 50i64;
        let total = 100i64;
        let offset = 150i64; // Beyond total

        let items_to_return = if offset >= total {
            0
        } else {
            (total - offset).min(limit)
        };
        assert_eq!(items_to_return, 0);
    }

    // =========================================================================
    // Sort order parsing tests
    // =========================================================================

    #[test]
    fn test_sort_order_asc() {
        let order_str = "asc";
        let sort_order = if order_str.to_lowercase() == "asc" {
            SortOrder::Asc
        } else {
            SortOrder::Desc
        };
        assert!(matches!(sort_order, SortOrder::Asc));
    }

    #[test]
    fn test_sort_order_desc() {
        let order_str = "desc";
        let sort_order = if order_str.to_lowercase() == "asc" {
            SortOrder::Asc
        } else {
            SortOrder::Desc
        };
        assert!(matches!(sort_order, SortOrder::Desc));
    }

    #[test]
    fn test_sort_order_case_insensitive() {
        let orders = ["ASC", "Asc", "asc", "ASc"];
        for order_str in orders {
            let sort_order = if order_str.to_lowercase() == "asc" {
                SortOrder::Asc
            } else {
                SortOrder::Desc
            };
            assert!(matches!(sort_order, SortOrder::Asc));
        }
    }

    #[test]
    fn test_sort_order_default_to_desc() {
        let order_str = "invalid";
        let sort_order = if order_str.to_lowercase() == "asc" {
            SortOrder::Asc
        } else {
            SortOrder::Desc
        };
        assert!(matches!(sort_order, SortOrder::Desc));
    }

    // =========================================================================
    // Path validation tests
    // =========================================================================

    #[test]
    fn test_path_exists_check() {
        // Using a path that definitely doesn't exist
        let path = Path::new("/nonexistent/path/to/file.mp3");
        assert!(!path.exists());
    }

    #[test]
    fn test_path_from_string() {
        let path_str = "/Users/test/Music/track.mp3";
        let path = Path::new(path_str);
        assert_eq!(path.to_str(), Some(path_str));
    }

    #[test]
    fn test_path_with_spaces() {
        let path_str = "/Users/test/My Music/My Track.mp3";
        let path = Path::new(path_str);
        assert_eq!(path.to_str(), Some(path_str));
    }

    #[test]
    fn test_path_with_unicode() {
        let path_str = "/Users/test/音楽/曲.mp3";
        let path = Path::new(path_str);
        assert_eq!(path.to_str(), Some(path_str));
    }
}
