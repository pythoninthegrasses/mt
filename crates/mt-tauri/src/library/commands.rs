//! Tauri command adapters for library management.
//!
//! The request handling — turning arguments into a `LibraryQuery`, assembling
//! the section view model, pairing each mutation with the removal records and
//! totals that must share its transaction, and running the fingerprint/dedup
//! pipeline — lives in `mt_core::library`. What stays here is the desktop's
//! half of the boundary: command signatures, tracing spans and slow-command
//! logs, the artwork LRU cache, the `settings.json` read, and event emission.

use tauri::{AppHandle, State};
use tracing::info;

use crate::db::{Database, LibraryStats, Track};
use crate::events::{EventEmitter, LibraryReconcileEvent, LibraryUpdatedEvent};
use crate::scanner::artwork::Artwork;
use crate::scanner::artwork_cache::ArtworkCache;
use crate::sidecar::SidecarState;

/// The core library layer, aliased so that a bare `library::` keeps meaning the
/// SQL layer (`crate::db::library`) as it did before the extraction.
use mt_core::library as core_library;

// The response shapes are core types. They stay reachable through this module
// because the shadow-diff harness and its parity test name them here.
pub use mt_core::library::{
    LibraryResponse, LibrarySectionResponse, MissingTracksResponse, ReconcileScanResult,
};

/// Get all tracks with filtering, sorting, and pagination
#[allow(clippy::too_many_arguments)]
#[tracing::instrument(skip(db, zig_core))]
#[tauri::command]
pub(crate) fn library_get_all(
    db: State<'_, Database>,
    zig_core: State<'_, SidecarState>,
    search: Option<String>,
    artist: Option<String>,
    album: Option<String>,
    sort_by: Option<String>,
    sort_order: Option<String>,
    limit: Option<i64>,
    offset: Option<i64>,
    ignore_words: Option<String>,
    source_filter: Option<String>,
) -> Result<LibraryResponse, String> {
    let start_time = std::time::Instant::now();

    // The query is built by the core so the shadow-diff comparison below asks
    // the sidecar the same question with the same defaults.
    let query = core_library::queries::get_all_query(
        search,
        artist,
        album,
        sort_by,
        sort_order,
        limit,
        offset,
        ignore_words,
        source_filter,
    );

    let response = core_library::queries::get_all(&db, &query)?;
    let track_count = response.tracks.len();

    // Shadow mode (TASK-355.5): also ask the Zig sidecar the same question and
    // log any divergence. Off unless MT_SHADOW_DIFF is set, in which case this
    // returns before the sidecar is touched and the call costs what it always
    // did. Errors are never propagated to the frontend — the Rust response
    // above is the one users see.
    if crate::shadow_diff::enabled() {
        // The sidecar's single-threaded accept loop blocks while it serves a
        // request, and this command runs on Tauri's sync-command pool, so the
        // comparison cannot share this thread's runtime. `block_on` here would
        // panic inside a tokio worker; a detached task on the runtime the
        // sidecar's own health probe uses keeps it off the request path.
        let endpoint_state = zig_core.inner().clone();
        let checked = response.clone();
        tauri::async_runtime::spawn(async move {
            crate::shadow_diff::compare_library_get_all(&endpoint_state, &query, &checked).await;
        });
    }

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
    core_library::queries::get_count(&db, search, artist, album)
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

    let response = core_library::section::get_section(
        &db,
        section,
        search,
        artist,
        album,
        sort_by,
        sort_order,
        limit,
        offset,
        ignore_words,
        days,
    )?;

    info!(
        section = %response.section,
        total_tracks = response.total_tracks,
        track_count = response.tracks.len(),
        duration_ms = start_time.elapsed().as_millis() as u64,
        "library_get_section completed"
    );

    Ok(response)
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
    core_library::queries::find_offset(
        &db,
        search,
        artist,
        album,
        sort_by,
        sort_order,
        ignore_words,
        prefix,
    )
}

/// Find the 0-based offset of a specific track ID in the current sort/filter order.
///
/// Returns `None` if the track is filtered out (e.g. by search) or does not exist.
#[allow(clippy::too_many_arguments)]
#[tracing::instrument(skip(db))]
#[tauri::command]
pub(crate) fn library_find_track_offset(
    db: State<'_, Database>,
    track_id: i64,
    search: Option<String>,
    artist: Option<String>,
    album: Option<String>,
    sort_by: Option<String>,
    sort_order: Option<String>,
    ignore_words: Option<String>,
) -> Result<Option<i64>, String> {
    core_library::queries::find_track_offset(
        &db,
        track_id,
        search,
        artist,
        album,
        sort_by,
        sort_order,
        ignore_words,
    )
}

/// Get library statistics
#[tracing::instrument(skip(db))]
#[tauri::command]
pub(crate) fn library_get_stats(db: State<'_, Database>) -> Result<LibraryStats, String> {
    core_library::queries::get_stats(&db)
}

/// Get a single track by ID
#[tracing::instrument(skip(db))]
#[tauri::command]
pub(crate) fn library_get_track(
    db: State<'_, Database>,
    track_id: i64,
) -> Result<Option<Track>, String> {
    core_library::queries::get_track(&db, track_id)
}

/// Get artwork for a track by ID (uses LRU cache)
#[tracing::instrument(skip(db, cache))]
#[tauri::command]
pub(crate) fn library_get_artwork(
    db: State<'_, Database>,
    cache: State<'_, ArtworkCache>,
    track_id: i64,
) -> Result<Option<Artwork>, String> {
    match core_library::queries::get_track(&db, track_id)? {
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
    match core_library::queries::get_track(&db, track_id)? {
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
    let deleted = core_library::mutations::delete_track(&db, track_id)?;

    if deleted {
        let stats = core_library::mutations::reconcile_stats(&db)?;
        let _ = app.emit_library_reconcile(LibraryReconcileEvent::delete(
            vec![track_id],
            stats.total_tracks,
            stats.local_file_count,
            stats.total_duration,
            stats.revision,
        ));
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
    let deleted = core_library::mutations::purge_missing(&db)?;
    if deleted > 0 {
        info!(count = deleted, "Purged missing tracks from database");
        let stats = core_library::mutations::reconcile_stats(&db)?;
        let _ = app.emit_library_reconcile(LibraryReconcileEvent::delete(
            vec![],
            stats.total_tracks,
            stats.local_file_count,
            stats.total_duration,
            stats.revision,
        ));
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
    let deleted = core_library::mutations::delete_tracks(&db, &track_ids)?;
    info!(count = deleted, "Batch deleted tracks");
    crate::logging::log_slow_command("library_delete_tracks", start);
    if deleted > 0 {
        let stats = core_library::mutations::reconcile_stats(&db)?;
        let _ = app.emit_library_reconcile(LibraryReconcileEvent::delete(
            track_ids,
            stats.total_tracks,
            stats.local_file_count,
            stats.total_duration,
            stats.revision,
        ));
    }
    Ok(deleted)
}

/// Delete ALL tracks from the library (favorites, playlist_items, library rows).
/// Also clears the removed tracks list for a clean slate.
#[tracing::instrument(skip(app, db))]
#[tauri::command]
pub(crate) fn library_delete_all(app: AppHandle, db: State<'_, Database>) -> Result<usize, String> {
    let start = std::time::Instant::now();
    let deleted = core_library::mutations::delete_all(&db)?;
    info!(count = deleted, "Deleted all tracks from library");
    crate::logging::log_slow_command("library_delete_all", start);
    if deleted > 0 {
        let _ = app.emit_library_reconcile(LibraryReconcileEvent::delete(vec![], 0, 0, 0.0, 0));
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
    let updated_track = core_library::mutations::rescan_track(&db, track_id)?;

    // Invalidate artwork cache since metadata (and potentially artwork) changed
    cache.invalidate(track_id);

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
    let track = core_library::mutations::update_play_count(&db, track_id)?;

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
    core_library::queries::get_missing(&db)
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
    let outcome = core_library::mutations::locate_track(&db, track_id, &new_path)?;

    // Emit library updated events
    let _ = app.emit_library_updated(LibraryUpdatedEvent::modified(vec![track_id]));

    // If we removed a duplicate, emit reconcile event for it
    if let Some(dup_id) = outcome.deleted_duplicate_id {
        let stats = core_library::mutations::reconcile_stats(&db)?;
        let _ = app.emit_library_reconcile(LibraryReconcileEvent::delete(
            vec![dup_id],
            stats.total_tracks,
            stats.local_file_count,
            stats.total_duration,
            stats.revision,
        ));
    }

    Ok(outcome.track)
}

/// Check if a track's file exists and update its missing status
#[tracing::instrument(skip(app, db))]
#[tauri::command]
pub(crate) fn library_check_status(
    app: AppHandle,
    db: State<'_, Database>,
    track_id: i64,
) -> Result<Track, String> {
    let track = core_library::mutations::check_status(&db, track_id)?;

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
    let track = core_library::mutations::mark_missing(&db, track_id)?;

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
    let track = core_library::mutations::mark_present(&db, track_id)?;

    // Emit standardized library updated event
    let _ = app.emit_library_updated(LibraryUpdatedEvent::modified(vec![track_id]));

    Ok(track)
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
        super::reconcile::run_backfill_and_dedup(&conn, &app_handle)
    })
    .await
    .map_err(|e| format!("Reconcile scan task failed: {e}"))?
}
