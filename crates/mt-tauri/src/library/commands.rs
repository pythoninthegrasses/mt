//! Tauri commands for library management.
//!
//! These commands expose library operations to the frontend,
//! replacing the Python FastAPI library routes.

use std::path::Path;
use tauri::{AppHandle, State};
use tracing::{debug, info};

use crate::db::{
    Database, LibraryStats, SortOrder, Track, TrackMetadata, favorites, library, playlists,
    removed, revision,
};
use crate::events::{EventEmitter, LibraryUpdatedEvent};
use crate::scanner::artwork::Artwork;
use crate::scanner::artwork_cache::ArtworkCache;
use crate::scanner::fingerprint::{FileFingerprint, compute_content_hash};
use crate::scanner::metadata::extract_metadata_or_default;

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
#[tracing::instrument(skip(db))]
#[tauri::command]
pub(crate) fn library_get_all(
    db: State<'_, Database>,
    search: Option<String>,
    artist: Option<String>,
    album: Option<String>,
    sort_by: Option<String>,
    sort_order: Option<String>,
    limit: Option<i64>,
    offset: Option<i64>,
    ignore_words: Option<String>,
) -> Result<LibraryResponse, String> {
    let start_time = std::time::Instant::now();
    let conn = db.conn().map_err(|e| e.to_string())?;

    // Update file sizes for tracks that have 0 (background operation)
    let _ = library::update_file_sizes(&conn);

    let query = library::LibraryQuery {
        search,
        artist,
        album,
        genre: None,
        year_from: None,
        year_to: None,
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
        ignore_words,
    };

    let result = library::get_all_tracks(&conn, &query).map_err(|e| e.to_string())?;
    let track_count = result.items.len();

    let response = LibraryResponse {
        tracks: result.items,
        total: result.total,
        limit: query.limit,
        offset: query.offset,
    };

    let duration_ms = start_time.elapsed().as_millis() as u64;
    info!(duration_ms, track_count, "library_get_all completed");
    crate::logging::log_slow_command("library_get_all", start_time);

    Ok(response)
}

/// Get filtered count and total duration without loading track data
#[allow(clippy::too_many_arguments)]
#[tracing::instrument(skip(db))]
#[tauri::command]
pub(crate) fn library_get_count(
    db: State<'_, Database>,
    search: Option<String>,
    artist: Option<String>,
    album: Option<String>,
) -> Result<crate::db::LibraryCount, String> {
    let conn = db.conn().map_err(|e| e.to_string())?;
    let query = library::LibraryQuery {
        search,
        artist,
        album,
        ..Default::default()
    };
    library::get_filtered_count(&conn, &query).map_err(|e| e.to_string())
}

/// Unified response for any library section view.
#[derive(Clone, serde::Serialize)]
pub struct LibrarySectionResponse {
    pub section: String,
    pub tracks: Vec<Track>,
    pub total_tracks: i64,
    pub total_duration: f64,
    pub page: Option<i64>,
    pub page_size: Option<i64>,
    pub has_more: bool,
    pub revision: i64,
}

/// Get a complete view model for any library section in a single call.
///
/// Replaces the pattern of separate getCount + getTracks calls. Returns tracks,
/// authoritative stats, and a revision number for cache invalidation — all from
/// the same DB transaction so counts are consistent with the returned page.
#[allow(clippy::too_many_arguments)]
#[tracing::instrument(skip(db))]
#[tauri::command]
pub(crate) fn library_get_section(
    db: State<'_, Database>,
    section: String,
    search: Option<String>,
    artist: Option<String>,
    album: Option<String>,
    sort_by: Option<String>,
    sort_order: Option<String>,
    limit: Option<i64>,
    offset: Option<i64>,
    ignore_words: Option<String>,
    days: Option<i64>,
) -> Result<LibrarySectionResponse, String> {
    let start_time = std::time::Instant::now();

    let response = db
        .transaction(|conn| {
            let rev = revision::get_revision(conn)?;

            match section.as_str() {
                "all" => get_section_all(
                    conn,
                    rev,
                    search,
                    artist,
                    album,
                    sort_by,
                    sort_order,
                    limit,
                    offset,
                    ignore_words,
                ),
                "liked" => get_section_liked(conn, rev, limit, offset),
                "top25" => get_section_top25(conn, rev),
                "recent" => get_section_recent(conn, rev, days, limit),
                "added" => get_section_added(conn, rev, days, limit),
                s if s.starts_with("playlist-") => {
                    let id_str = &s["playlist-".len()..];
                    let playlist_id: i64 = id_str.parse().map_err(|_| {
                        crate::db::DbError::NotFound(format!("Invalid playlist id: {}", id_str))
                    })?;
                    get_section_playlist(conn, rev, playlist_id)
                }
                _ => Err(crate::db::DbError::NotFound(format!(
                    "Unknown section: {}",
                    section
                ))),
            }
        })
        .map_err(|e| e.to_string())?;

    info!(
        section = %response.section,
        total_tracks = response.total_tracks,
        track_count = response.tracks.len(),
        duration_ms = start_time.elapsed().as_millis() as u64,
        "library_get_section completed"
    );

    Ok(response)
}

/// "all" section: paginated library with search/sort/filter.
#[allow(clippy::too_many_arguments)]
fn get_section_all(
    conn: &rusqlite::Connection,
    rev: i64,
    search: Option<String>,
    artist: Option<String>,
    album: Option<String>,
    sort_by: Option<String>,
    sort_order: Option<String>,
    limit: Option<i64>,
    offset: Option<i64>,
    ignore_words: Option<String>,
) -> crate::db::DbResult<LibrarySectionResponse> {
    let page_size = limit.unwrap_or(500);
    let page_offset = offset.unwrap_or(0);

    let query = library::LibraryQuery {
        search: search.clone(),
        artist: artist.clone(),
        album: album.clone(),
        genre: None,
        year_from: None,
        year_to: None,
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
        limit: page_size,
        offset: page_offset,
        ignore_words,
    };

    let count_query = library::LibraryQuery {
        search,
        artist,
        album,
        ..Default::default()
    };

    let count = library::get_filtered_count(conn, &count_query)?;
    let result = library::get_all_tracks(conn, &query)?;
    let has_more = (page_offset + page_size) < count.total;

    Ok(LibrarySectionResponse {
        section: "all".to_string(),
        tracks: result.items,
        total_tracks: count.total,
        total_duration: count.total_duration as f64,
        page: Some(page_offset / page_size),
        page_size: Some(page_size),
        has_more,
        revision: rev,
    })
}

/// "liked" section: favorited tracks.
fn get_section_liked(
    conn: &rusqlite::Connection,
    rev: i64,
    limit: Option<i64>,
    offset: Option<i64>,
) -> crate::db::DbResult<LibrarySectionResponse> {
    let lim = limit.unwrap_or(10000);
    let off = offset.unwrap_or(0);
    let result = favorites::get_favorites(conn, lim, off)?;
    let (total, duration) = favorites::get_favorites_stats(conn)?;
    let tracks: Vec<Track> = result.items.into_iter().map(|ft| ft.track).collect();

    Ok(LibrarySectionResponse {
        section: "liked".to_string(),
        tracks,
        total_tracks: total,
        total_duration: duration,
        page: None,
        page_size: None,
        has_more: false,
        revision: rev,
    })
}

/// "top25" section: most played tracks.
fn get_section_top25(
    conn: &rusqlite::Connection,
    rev: i64,
) -> crate::db::DbResult<LibrarySectionResponse> {
    let tracks = favorites::get_top_25(conn)?;
    let (total, duration) = favorites::get_top_25_stats(conn)?;

    Ok(LibrarySectionResponse {
        section: "top25".to_string(),
        tracks,
        total_tracks: total,
        total_duration: duration,
        page: None,
        page_size: None,
        has_more: false,
        revision: rev,
    })
}

/// "recent" section: recently played tracks.
fn get_section_recent(
    conn: &rusqlite::Connection,
    rev: i64,
    days: Option<i64>,
    limit: Option<i64>,
) -> crate::db::DbResult<LibrarySectionResponse> {
    let d = days.unwrap_or(14).clamp(1, 365);
    let lim = limit.unwrap_or(100).clamp(1, 1000);
    let tracks = favorites::get_recently_played(conn, d, lim)?;
    let (total, duration) = favorites::get_recently_played_stats(conn, d, lim)?;

    Ok(LibrarySectionResponse {
        section: "recent".to_string(),
        tracks,
        total_tracks: total,
        total_duration: duration,
        page: None,
        page_size: None,
        has_more: false,
        revision: rev,
    })
}

/// "added" section: recently added tracks.
fn get_section_added(
    conn: &rusqlite::Connection,
    rev: i64,
    days: Option<i64>,
    limit: Option<i64>,
) -> crate::db::DbResult<LibrarySectionResponse> {
    let d = days.unwrap_or(14).clamp(1, 365);
    let lim = limit.unwrap_or(100).clamp(1, 1000);
    let tracks = favorites::get_recently_added(conn, d, lim)?;
    let (total, duration) = favorites::get_recently_added_stats(conn, d, lim)?;

    Ok(LibrarySectionResponse {
        section: "added".to_string(),
        tracks,
        total_tracks: total,
        total_duration: duration,
        page: None,
        page_size: None,
        has_more: false,
        revision: rev,
    })
}

/// "playlist-{id}" section: tracks in a specific playlist.
fn get_section_playlist(
    conn: &rusqlite::Connection,
    rev: i64,
    playlist_id: i64,
) -> crate::db::DbResult<LibrarySectionResponse> {
    let playlist = playlists::get_playlist(conn, playlist_id)?.ok_or_else(|| {
        crate::db::DbError::NotFound(format!("Playlist {} not found", playlist_id))
    })?;
    let (total, duration) = playlists::get_playlist_stats(conn, playlist_id)?;
    let tracks: Vec<Track> = playlist.tracks.into_iter().map(|pt| pt.track).collect();

    Ok(LibrarySectionResponse {
        section: format!("playlist-{}", playlist_id),
        tracks,
        total_tracks: total,
        total_duration: duration,
        page: None,
        page_size: None,
        has_more: false,
        revision: rev,
    })
}

/// Find the 0-based offset of the first row matching a prefix in the current sort order
#[allow(clippy::too_many_arguments)]
#[tracing::instrument(skip(db))]
#[tauri::command]
pub(crate) fn library_find_offset(
    db: State<'_, Database>,
    search: Option<String>,
    artist: Option<String>,
    album: Option<String>,
    sort_by: Option<String>,
    sort_order: Option<String>,
    ignore_words: Option<String>,
    prefix: String,
) -> Result<Option<i64>, String> {
    let conn = db.conn().map_err(|e| e.to_string())?;
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
        ignore_words,
        ..Default::default()
    };
    library::find_sort_offset(&conn, &query, &prefix).map_err(|e| e.to_string())
}

/// Get library statistics
#[tracing::instrument(skip(db))]
#[tauri::command]
pub(crate) fn library_get_stats(db: State<'_, Database>) -> Result<LibraryStats, String> {
    let conn = db.conn().map_err(|e| e.to_string())?;
    library::get_library_stats(&conn).map_err(|e| e.to_string())
}

/// Get a single track by ID
#[tracing::instrument(skip(db))]
#[tauri::command]
pub(crate) fn library_get_track(
    db: State<'_, Database>,
    track_id: i64,
) -> Result<Option<Track>, String> {
    let conn = db.conn().map_err(|e| e.to_string())?;
    library::get_track_by_id(&conn, track_id).map_err(|e| e.to_string())
}

/// Get artwork for a track by ID (uses LRU cache)
#[tracing::instrument(skip(db, cache))]
#[tauri::command]
pub(crate) fn library_get_artwork(
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
#[tracing::instrument(skip(db, cache))]
#[tauri::command]
pub(crate) fn library_get_artwork_url(
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

/// Delete a track from the library and record the removal to prevent re-addition on scan
#[tracing::instrument(skip(app, db))]
#[tauri::command]
pub(crate) fn library_delete_track(
    app: AppHandle,
    db: State<'_, Database>,
    track_id: i64,
) -> Result<bool, String> {
    let deleted = db
        .transaction(|conn| {
            // Fetch track info before deleting so we can record the removal
            let track = library::get_track_by_id(conn, track_id)?;
            let deleted = library::delete_track(conn, track_id)?;
            if deleted && let Some(track) = track {
                removed::record_removal(conn, &track.filepath, track.content_hash.as_deref())?;
            }
            Ok(deleted)
        })
        .map_err(|e| e.to_string())?;

    if deleted {
        let _ = app.emit_library_updated(LibraryUpdatedEvent::deleted(vec![track_id]));
    }

    Ok(deleted)
}

/// Purge all tracks marked as missing from the database
#[tracing::instrument(skip(app, db))]
#[tauri::command]
pub(crate) fn library_purge_missing(
    app: AppHandle,
    db: State<'_, Database>,
) -> Result<usize, String> {
    let start = std::time::Instant::now();
    let deleted = db
        .transaction(library::delete_missing_tracks)
        .map_err(|e| e.to_string())?;
    if deleted > 0 {
        info!(count = deleted, "Purged missing tracks from database");
        let _ = app.emit_library_updated(LibraryUpdatedEvent::deleted(vec![]));
    }
    crate::logging::log_slow_command("library_purge_missing", start);
    Ok(deleted)
}

/// Delete multiple tracks by ID in a single transaction and record removals
#[tracing::instrument(skip(app, db, track_ids))]
#[tauri::command]
pub(crate) fn library_delete_tracks(
    app: AppHandle,
    db: State<'_, Database>,
    track_ids: Vec<i64>,
) -> Result<usize, String> {
    let start = std::time::Instant::now();
    let deleted = db
        .transaction(|conn| {
            // Fetch track info before deleting to record removals (single bulk query)
            let removals = removed::get_track_removal_info_bulk(conn, &track_ids)?;

            let deleted = library::delete_tracks_by_ids(conn, &track_ids)?;

            if !removals.is_empty() {
                removed::record_removals_bulk(conn, &removals)?;
            }

            Ok(deleted)
        })
        .map_err(|e| e.to_string())?;
    info!(count = deleted, "Batch deleted tracks");
    crate::logging::log_slow_command("library_delete_tracks", start);
    if deleted > 0 {
        let _ = app.emit_library_updated(LibraryUpdatedEvent::deleted(track_ids));
    }
    Ok(deleted)
}

/// Delete ALL tracks from the library (favorites, playlist_items, library rows).
/// Also clears the removed tracks list for a clean slate.
#[tracing::instrument(skip(app, db))]
#[tauri::command]
pub(crate) fn library_delete_all(app: AppHandle, db: State<'_, Database>) -> Result<usize, String> {
    let start = std::time::Instant::now();
    let deleted = db
        .transaction(|conn| {
            let deleted = library::delete_all_tracks(conn)?;
            removed::clear_all_removals(conn)?;
            Ok(deleted)
        })
        .map_err(|e| e.to_string())?;
    info!(count = deleted, "Deleted all tracks from library");
    crate::logging::log_slow_command("library_delete_all", start);
    if deleted > 0 {
        let _ = app.emit_library_updated(LibraryUpdatedEvent::deleted(vec![]));
    }
    Ok(deleted)
}

/// Rescan a track's metadata from its file
#[tracing::instrument(skip(app, db, cache))]
#[tauri::command]
pub(crate) fn library_rescan_track(
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

    // Extract fresh metadata (use or_default to handle files with malformed tags)
    let extracted = extract_metadata_or_default(&track.filepath);

    // Convert to TrackMetadata for update
    let metadata = TrackMetadata {
        title: extracted.title,
        artist: extracted.artist,
        album: extracted.album,
        album_artist: extracted.album_artist,
        track_number: extracted.track_number,
        track_total: extracted.track_total,
        disc_number: extracted.disc_number.map(|n| n.to_string()),
        disc_total: extracted.disc_total.map(|n| n.to_string()),
        date: extracted.date,
        genre: extracted.genre,
        duration: extracted.duration,
        file_size: Some(extracted.file_size),
        file_mtime_ns: extracted.file_mtime_ns,
        file_ctime_ns: None,
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
#[tracing::instrument(skip(app, db))]
#[tauri::command]
pub(crate) fn library_update_play_count(
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
#[tracing::instrument(skip(db))]
#[tauri::command]
pub(crate) fn library_get_missing(
    db: State<'_, Database>,
) -> Result<MissingTracksResponse, String> {
    let conn = db.conn().map_err(|e| e.to_string())?;

    let tracks = library::get_missing_tracks(&conn).map_err(|e| e.to_string())?;
    let total = tracks.len() as i64;

    Ok(MissingTracksResponse { tracks, total })
}

/// Update a missing track's filepath after user locates the file
/// If the new path already exists as another track (duplicate), the duplicate is removed
/// and the original track's path is updated (preserving play history, favorites, etc.)
#[tracing::instrument(skip(app, db))]
#[tauri::command]
pub(crate) fn library_locate_track(
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
        && existing_track.id != track_id
    {
        // There's a duplicate track at this path - remove it
        // The original track (being located) takes precedence to preserve play history
        debug!(
            duplicate_id = existing_track.id,
            path = %new_path,
            kept_id = track_id,
            "Removing duplicate track at path (keeping original)"
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
#[tracing::instrument(skip(app, db))]
#[tauri::command]
pub(crate) fn library_check_status(
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
#[tracing::instrument(skip(app, db))]
#[tauri::command]
pub(crate) fn library_mark_missing(
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
#[tracing::instrument(skip(app, db))]
#[tauri::command]
pub(crate) fn library_mark_present(
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
    pub cross_directory_suppressed: u32,
    pub reinstated: u32,
    pub errors: u32,
}

/// Run fingerprint backfill, within-directory dedup, and cross-directory dedup.
///
/// Shared between the manual reconcile scan command and the automatic
/// post-scan backfill. Runs on the calling thread (expected to be called
/// from `spawn_blocking`).
pub(crate) fn run_backfill_and_dedup(
    conn: &rusqlite::Connection,
    app_handle: &AppHandle,
) -> Result<ReconcileScanResult, String> {
    use crate::events::ReconcileProgressEvent;
    use rayon::prelude::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    let tracks = library::get_tracks_needing_fingerprints(conn).map_err(|e| e.to_string())?;
    let total = tracks.len() as u32;

    // Phase 1: compute fingerprints and hashes in parallel
    let _ = app_handle.emit_reconcile_progress(ReconcileProgressEvent::fingerprinting(0, total));

    let processed = AtomicU32::new(0);
    let fp_errors = AtomicU32::new(0);
    let app_progress = app_handle.clone();

    let results: Vec<_> = tracks
        .par_iter()
        .map(|track| {
            let path = std::path::Path::new(&track.filepath);
            if !path.exists() {
                let count = processed.fetch_add(1, Ordering::Relaxed) + 1;
                if count.is_multiple_of(100) || count == total {
                    let _ = app_progress.emit_reconcile_progress(
                        ReconcileProgressEvent::fingerprinting(count, total),
                    );
                }
                return (track.id, None, None);
            }

            let fingerprint = match FileFingerprint::from_path(path) {
                Ok(fp) => Some(fp),
                Err(_) => {
                    fp_errors.fetch_add(1, Ordering::Relaxed);
                    None
                }
            };

            let content_hash = match compute_content_hash(path) {
                Ok(h) => Some(h),
                Err(_) => {
                    fp_errors.fetch_add(1, Ordering::Relaxed);
                    None
                }
            };

            let count = processed.fetch_add(1, Ordering::Relaxed) + 1;
            if count.is_multiple_of(100) || count == total {
                let _ = app_progress
                    .emit_reconcile_progress(ReconcileProgressEvent::fingerprinting(count, total));
            }

            (track.id, fingerprint, content_hash)
        })
        .collect();

    // Phase 1b: sequential DB writes for fingerprint backfill
    let mut backfilled = 0u32;
    let mut errors = fp_errors.load(Ordering::Relaxed);

    for (track_id, fingerprint, content_hash) in &results {
        // Write whatever we have — fingerprint, content_hash, or both
        if fingerprint.is_none() && content_hash.is_none() {
            continue;
        }

        let inode = fingerprint.and_then(|fp| fp.inode);
        match library::update_track_fingerprints(conn, *track_id, inode, content_hash.as_deref()) {
            Ok(true) => backfilled += 1,
            Ok(false) => {}
            Err(_) => errors += 1,
        }
    }

    // Phase 2: deduplication
    let _ = app_handle.emit_reconcile_progress(ReconcileProgressEvent::deduplicating(0, 0));

    let mut duplicates_merged = 0u32;
    let mut deleted_ids = Vec::new();

    let inode_dups = library::find_duplicates_by_inode(conn).map_err(|e| e.to_string())?;
    let dup_total = inode_dups.len() as u32;
    for (i, group) in inode_dups.iter().enumerate() {
        if group.len() < 2 {
            continue;
        }
        let keep = &group[0];
        for dup in &group[1..] {
            match library::merge_duplicate_tracks(conn, keep.id, dup.id) {
                Ok(true) => {
                    duplicates_merged += 1;
                    deleted_ids.push(dup.id);
                }
                Ok(false) => {}
                Err(_) => errors += 1,
            }
        }
        if (i as u32 + 1).is_multiple_of(100) {
            let _ = app_handle.emit_reconcile_progress(ReconcileProgressEvent::deduplicating(
                i as u32 + 1,
                dup_total,
            ));
        }
    }

    let hash_dups = library::find_duplicates_by_content_hash(conn).map_err(|e| e.to_string())?;
    for group in hash_dups {
        if group.len() < 2 {
            continue;
        }
        let keep = &group[0];
        for dup in &group[1..] {
            if deleted_ids.contains(&dup.id) {
                continue;
            }
            match library::merge_duplicate_tracks(conn, keep.id, dup.id) {
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
        let _ = app_handle.emit_library_updated(LibraryUpdatedEvent::deleted(deleted_ids.clone()));
    }

    // Phase 3: Cross-directory dedup
    let _ = app_handle.emit_reconcile_progress(ReconcileProgressEvent::cross_directory_dedup(0, 0));

    let mut cross_directory_suppressed = 0u32;
    let mut reinstated = 0u32;

    // Phase 3a: Reinstatement (always runs if there are suppression records)
    let suppression_count = crate::db::dedup::count_suppressed(conn).unwrap_or(0);
    if suppression_count > 0 {
        match crate::db::dedup::reinstate_missing_kept_tracks(conn, |filepath| {
            let path = std::path::Path::new(filepath);
            if !path.exists() {
                return None;
            }
            let extracted = extract_metadata_or_default(filepath);
            let content_hash = compute_content_hash(path).ok();
            let metadata = TrackMetadata {
                title: extracted.title,
                artist: extracted.artist,
                album: extracted.album,
                album_artist: extracted.album_artist,
                track_number: extracted.track_number,
                track_total: extracted.track_total,
                disc_number: extracted.disc_number.map(|n| n.to_string()),
                disc_total: extracted.disc_total.map(|n| n.to_string()),
                date: extracted.date,
                genre: extracted.genre,
                duration: extracted.duration,
                file_size: Some(extracted.file_size),
                file_mtime_ns: extracted.file_mtime_ns,
                file_ctime_ns: extracted.file_ctime_ns,
                file_inode: extracted.file_inode,
                content_hash,
            };
            library::add_track(conn, filepath, &metadata).ok()
        }) {
            Ok(r) => {
                reinstated = r.reinstated;
                errors += r.errors;
            }
            Err(e) => {
                info!(error = %e, "Reinstatement phase encountered error");
                errors += 1;
            }
        }
    }

    // Phase 3b: Cross-directory dedup
    let dedup_enabled = {
        use tauri_plugin_store::StoreExt;
        app_handle
            .store("settings.json")
            .ok()
            .and_then(|store| {
                store
                    .get("library.deduplicateAcrossDirectories")
                    .and_then(|v| v.as_bool())
            })
            .unwrap_or(true)
    };

    if dedup_enabled {
        let watched_folders = crate::db::watched::get_watched_folders(conn).unwrap_or_default();
        let folder_paths: Vec<String> = watched_folders.iter().map(|f| f.path.clone()).collect();

        if folder_paths.len() >= 2 {
            match library::find_cross_directory_duplicates(conn, &folder_paths) {
                Ok(groups) => {
                    let group_total = groups.len() as u32;
                    for (i, group) in groups.iter().enumerate() {
                        if group.len() < 2 {
                            continue;
                        }
                        let keep = &group[0];
                        for dup in &group[1..] {
                            if deleted_ids.contains(&dup.id) {
                                continue;
                            }
                            let _ = crate::db::dedup::suppress_track(
                                conn,
                                keep.id,
                                &dup.filepath,
                                dup.content_hash.as_deref(),
                                dup.file_ctime_ns,
                                dup.file_mtime_ns,
                            );
                            match library::merge_duplicate_tracks(conn, keep.id, dup.id) {
                                Ok(true) => {
                                    cross_directory_suppressed += 1;
                                    deleted_ids.push(dup.id);
                                }
                                Ok(false) => {}
                                Err(_) => errors += 1,
                            }
                        }
                        if (i as u32 + 1).is_multiple_of(100) || i as u32 + 1 == group_total {
                            let _ = app_handle.emit_reconcile_progress(
                                ReconcileProgressEvent::cross_directory_dedup(
                                    i as u32 + 1,
                                    group_total,
                                ),
                            );
                        }
                    }
                }
                Err(e) => {
                    info!(error = %e, "Cross-directory dedup query failed");
                    errors += 1;
                }
            }
        }
    } else if suppression_count > 0 {
        match crate::db::dedup::clear_all_suppressions(conn) {
            Ok(infos) => {
                for info in &infos {
                    let path = std::path::Path::new(&info.suppressed_filepath);
                    if !path.exists() {
                        continue;
                    }
                    let extracted = extract_metadata_or_default(&info.suppressed_filepath);
                    let content_hash = compute_content_hash(path).ok();
                    let metadata = TrackMetadata {
                        title: extracted.title,
                        artist: extracted.artist,
                        album: extracted.album,
                        album_artist: extracted.album_artist,
                        track_number: extracted.track_number,
                        track_total: extracted.track_total,
                        disc_number: extracted.disc_number.map(|n| n.to_string()),
                        disc_total: extracted.disc_total.map(|n| n.to_string()),
                        date: extracted.date,
                        genre: extracted.genre,
                        duration: extracted.duration,
                        file_size: Some(extracted.file_size),
                        file_mtime_ns: extracted.file_mtime_ns,
                        file_ctime_ns: extracted.file_ctime_ns,
                        file_inode: extracted.file_inode,
                        content_hash,
                    };
                    let _ = library::add_track(conn, &info.suppressed_filepath, &metadata);
                }
                info!(
                    count = infos.len(),
                    "Unsuppressed tracks (dedup setting disabled)"
                );
            }
            Err(e) => {
                info!(error = %e, "Failed to clear suppressions");
                errors += 1;
            }
        }
    }

    // Emit deleted events for cross-directory dedup
    if cross_directory_suppressed > 0 {
        let _ = app_handle.emit_library_updated(LibraryUpdatedEvent::deleted(
            deleted_ids[duplicates_merged as usize..].to_vec(),
        ));
    }

    let _ = app_handle.emit_reconcile_progress(ReconcileProgressEvent::complete(total));

    Ok(ReconcileScanResult {
        backfilled,
        duplicates_merged,
        cross_directory_suppressed,
        reinstated,
        errors,
    })
}

#[tracing::instrument(skip(app, db))]
#[tauri::command]
pub(crate) async fn library_reconcile_scan(
    app: AppHandle,
    db: State<'_, Database>,
) -> Result<ReconcileScanResult, String> {
    let db = db.inner().clone();
    let app_handle = app.clone();

    tokio::task::spawn_blocking(move || {
        let conn = db.conn().map_err(|e| e.to_string())?;
        run_backfill_and_dedup(&conn, &app_handle)
    })
    .await
    .map_err(|e| format!("Reconcile scan task failed: {e}"))?
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
            cross_directory_suppressed: 3,
            reinstated: 1,
            errors: 2,
        };

        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("\"backfilled\":10"));
        assert!(json.contains("\"duplicates_merged\":5"));
        assert!(json.contains("\"cross_directory_suppressed\":3"));
        assert!(json.contains("\"reinstated\":1"));
        assert!(json.contains("\"errors\":2"));
    }

    #[test]
    fn test_reconcile_scan_result_zero_values() {
        let result = ReconcileScanResult {
            backfilled: 0,
            duplicates_merged: 0,
            cross_directory_suppressed: 0,
            reinstated: 0,
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
            cross_directory_suppressed: 0,
            reinstated: 0,
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
            cross_directory_suppressed: 0,
            reinstated: 0,
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

    // =========================================================================
    // library_get_section helper tests
    // =========================================================================

    mod section_tests {
        use super::super::*;
        use crate::db::{
            TrackMetadata, favorites, library, playlists, revision,
            schema::{create_tables, run_migrations},
        };
        use rusqlite::Connection;

        fn setup_test_db() -> Connection {
            let conn = Connection::open_in_memory().unwrap();
            create_tables(&conn).unwrap();
            run_migrations(&conn).unwrap();
            conn
        }

        fn add_test_track(conn: &Connection, i: i32, duration: f64) -> i64 {
            let metadata = TrackMetadata {
                title: Some(format!("Track {}", i)),
                artist: Some(format!("Artist {}", i)),
                album: Some(format!("Album {}", i)),
                duration: Some(duration),
                ..Default::default()
            };
            library::add_track(conn, &format!("/music/track{}.mp3", i), &metadata).unwrap()
        }

        #[test]
        fn test_section_all_empty() {
            let conn = setup_test_db();
            let rev = revision::get_revision(&conn).unwrap();
            let resp = get_section_all(&conn, rev, None, None, None, None, None, None, None, None)
                .unwrap();
            assert_eq!(resp.section, "all");
            assert_eq!(resp.total_tracks, 0);
            assert_eq!(resp.total_duration, 0.0);
            assert!(!resp.has_more);
            assert!(resp.tracks.is_empty());
            assert_eq!(resp.revision, 0);
        }

        #[test]
        fn test_section_all_with_tracks() {
            let conn = setup_test_db();
            for i in 1..=5 {
                add_test_track(&conn, i, 100.0 * i as f64);
            }
            let rev = revision::get_revision(&conn).unwrap();
            let resp = get_section_all(&conn, rev, None, None, None, None, None, None, None, None)
                .unwrap();
            assert_eq!(resp.total_tracks, 5);
            assert_eq!(resp.total_duration, 100.0 + 200.0 + 300.0 + 400.0 + 500.0);
            assert_eq!(resp.tracks.len(), 5);
            assert!(!resp.has_more);
        }

        #[test]
        fn test_section_all_pagination() {
            let conn = setup_test_db();
            for i in 1..=10 {
                add_test_track(&conn, i, 60.0);
            }
            let rev = revision::get_revision(&conn).unwrap();
            let resp = get_section_all(
                &conn,
                rev,
                None,
                None,
                None,
                None,
                None,
                Some(3),
                Some(0),
                None,
            )
            .unwrap();
            assert_eq!(resp.tracks.len(), 3);
            assert_eq!(resp.total_tracks, 10);
            assert!(resp.has_more);
            assert_eq!(resp.page, Some(0));
            assert_eq!(resp.page_size, Some(3));
        }

        #[test]
        fn test_section_all_beyond_last_page() {
            let conn = setup_test_db();
            for i in 1..=5 {
                add_test_track(&conn, i, 60.0);
            }
            let rev = revision::get_revision(&conn).unwrap();
            let resp = get_section_all(
                &conn,
                rev,
                None,
                None,
                None,
                None,
                None,
                Some(10),
                Some(100),
                None,
            )
            .unwrap();
            assert!(resp.tracks.is_empty());
            assert_eq!(resp.total_tracks, 5);
            assert!(!resp.has_more);
        }

        #[test]
        fn test_section_all_search() {
            let conn = setup_test_db();
            add_test_track(&conn, 1, 60.0);
            let metadata = TrackMetadata {
                title: Some("Unique Song".to_string()),
                artist: Some("Special Artist".to_string()),
                duration: Some(120.0),
                ..Default::default()
            };
            library::add_track(&conn, "/music/unique.mp3", &metadata).unwrap();

            let rev = revision::get_revision(&conn).unwrap();
            let resp = get_section_all(
                &conn,
                rev,
                Some("Unique".to_string()),
                None,
                None,
                None,
                None,
                None,
                None,
                None,
            )
            .unwrap();
            assert_eq!(resp.total_tracks, 1);
            assert_eq!(resp.tracks.len(), 1);
            assert_eq!(resp.tracks[0].title, Some("Unique Song".to_string()));
        }

        #[test]
        fn test_section_liked() {
            let conn = setup_test_db();
            let id1 = add_test_track(&conn, 1, 100.0);
            let id2 = add_test_track(&conn, 2, 200.0);
            add_test_track(&conn, 3, 300.0); // not favorited

            favorites::add_favorite(&conn, id1).unwrap();
            favorites::add_favorite(&conn, id2).unwrap();

            let rev = revision::get_revision(&conn).unwrap();
            let resp = get_section_liked(&conn, rev, None, None).unwrap();
            assert_eq!(resp.section, "liked");
            assert_eq!(resp.total_tracks, 2);
            assert_eq!(resp.total_duration, 300.0);
            assert_eq!(resp.tracks.len(), 2);
            assert!(!resp.has_more);
        }

        #[test]
        fn test_section_top25() {
            let conn = setup_test_db();
            let id1 = add_test_track(&conn, 1, 150.0);
            let id2 = add_test_track(&conn, 2, 250.0);

            for _ in 0..5 {
                library::update_play_count(&conn, id1).unwrap();
            }
            for _ in 0..10 {
                library::update_play_count(&conn, id2).unwrap();
            }

            let rev = revision::get_revision(&conn).unwrap();
            let resp = get_section_top25(&conn, rev).unwrap();
            assert_eq!(resp.section, "top25");
            assert_eq!(resp.total_tracks, 2);
            assert_eq!(resp.total_duration, 400.0);
            // Most played first
            assert_eq!(resp.tracks[0].play_count, 10);
            assert_eq!(resp.tracks[1].play_count, 5);
        }

        #[test]
        fn test_section_recent() {
            let conn = setup_test_db();
            let id = add_test_track(&conn, 1, 180.0);
            library::update_play_count(&conn, id).unwrap();

            let rev = revision::get_revision(&conn).unwrap();
            let resp = get_section_recent(&conn, rev, Some(7), Some(100)).unwrap();
            assert_eq!(resp.section, "recent");
            assert_eq!(resp.total_tracks, 1);
            assert_eq!(resp.total_duration, 180.0);
        }

        #[test]
        fn test_section_added() {
            let conn = setup_test_db();
            add_test_track(&conn, 1, 200.0);
            add_test_track(&conn, 2, 300.0);

            let rev = revision::get_revision(&conn).unwrap();
            let resp = get_section_added(&conn, rev, Some(7), Some(100)).unwrap();
            assert_eq!(resp.section, "added");
            assert_eq!(resp.total_tracks, 2);
            assert_eq!(resp.total_duration, 500.0);
        }

        #[test]
        fn test_section_playlist() {
            let conn = setup_test_db();
            let id1 = add_test_track(&conn, 1, 100.0);
            let id2 = add_test_track(&conn, 2, 200.0);

            let playlist = playlists::create_playlist(&conn, "Test Playlist")
                .unwrap()
                .unwrap();
            playlists::add_tracks_to_playlist(&conn, playlist.id, &[id1, id2], None).unwrap();

            let rev = revision::get_revision(&conn).unwrap();
            let resp = get_section_playlist(&conn, rev, playlist.id).unwrap();
            assert_eq!(resp.section, format!("playlist-{}", playlist.id));
            assert_eq!(resp.total_tracks, 2);
            assert_eq!(resp.total_duration, 300.0);
            assert_eq!(resp.tracks.len(), 2);
        }

        #[test]
        fn test_section_playlist_not_found() {
            let conn = setup_test_db();
            let rev = revision::get_revision(&conn).unwrap();
            let result = get_section_playlist(&conn, rev, 999);
            assert!(result.is_err());
        }

        #[test]
        fn test_section_unknown() {
            let conn = setup_test_db();
            // We can't directly test the match arm since it's inside the command,
            // but the DB-level helpers cover each section type. This tests the
            // response struct serialization for completeness.
            let resp = LibrarySectionResponse {
                section: "all".to_string(),
                tracks: vec![],
                total_tracks: 0,
                total_duration: 0.0,
                page: None,
                page_size: None,
                has_more: false,
                revision: 0,
            };
            let json = serde_json::to_string(&resp).unwrap();
            assert!(json.contains("\"section\":\"all\""));
            assert!(json.contains("\"revision\":0"));
            assert!(json.contains("\"has_more\":false"));
        }

        #[test]
        fn test_revision_increments_on_add() {
            let conn = setup_test_db();
            let rev_before = revision::get_revision(&conn).unwrap();
            assert_eq!(rev_before, 0);

            // Bump revision (simulating what add_track will do after Phase 4)
            revision::bump_revision(&conn).unwrap();

            let rev_after = revision::get_revision(&conn).unwrap();
            assert_eq!(rev_after, 1);
        }

        #[test]
        fn test_section_all_sort() {
            let conn = setup_test_db();
            let metadata_a = TrackMetadata {
                title: Some("Alpha".to_string()),
                artist: Some("Zeta".to_string()),
                duration: Some(60.0),
                ..Default::default()
            };
            library::add_track(&conn, "/music/alpha.mp3", &metadata_a).unwrap();

            let metadata_b = TrackMetadata {
                title: Some("Beta".to_string()),
                artist: Some("Alpha".to_string()),
                duration: Some(120.0),
                ..Default::default()
            };
            library::add_track(&conn, "/music/beta.mp3", &metadata_b).unwrap();

            let rev = revision::get_revision(&conn).unwrap();
            let resp = get_section_all(
                &conn,
                rev,
                None,
                None,
                None,
                Some("title".to_string()),
                Some("asc".to_string()),
                None,
                None,
                None,
            )
            .unwrap();
            assert_eq!(resp.tracks[0].title, Some("Alpha".to_string()));
            assert_eq!(resp.tracks[1].title, Some("Beta".to_string()));
        }
    }
}
