//! Tauri commands for scanner operations.
//!
//! These commands expose the scanner functionality to the frontend
//! with progress events emitted during scanning.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Instant;
use tauri::{AppHandle, Emitter, State};
use tracing::{error, info};
use uuid::Uuid;

use crate::commands::match_new_tracks_against_loved;
use crate::db::{library, Database};
use crate::events::{EventEmitter, LibraryUpdatedEvent, ScanCompleteEvent, ScanProgressEvent};
use crate::scanner::artwork::{get_artwork, Artwork};
use crate::scanner::fingerprint::{compute_content_hash, FileFingerprint};
use crate::scanner::metadata::extract_metadata;
use crate::scanner::scan::{scan_2phase, ProgressCallback, ScanResult2Phase};
use crate::scanner::{ExtractedMetadata, ScanProgress, ScanStats};

/// Internal scan progress event for metadata-only scans
#[derive(Clone, serde::Serialize)]
struct MetadataScanProgress {
    phase: String,
    current: usize,
    total: usize,
    message: Option<String>,
}

/// Job ID counter for generating unique scan job IDs
static JOB_COUNTER: AtomicU64 = AtomicU64::new(0);

/// Generate a unique job ID for a scan operation
fn generate_job_id() -> String {
    let counter = JOB_COUNTER.fetch_add(1, Ordering::SeqCst);
    format!("scan-{}-{}", Uuid::new_v4().as_simple(), counter)
}

/// Scan result sent to frontend
#[derive(Clone, serde::Serialize)]
pub struct ScanResultResponse {
    pub added_count: usize,
    pub modified_count: usize,
    pub unchanged_count: usize,
    pub deleted_count: usize,
    pub error_count: usize,
    pub stats: ScanStats,
}

impl From<&ScanResult2Phase> for ScanResultResponse {
    fn from(result: &ScanResult2Phase) -> Self {
        ScanResultResponse {
            added_count: result.added.len(),
            modified_count: result.modified.len(),
            unchanged_count: result.unchanged.len(),
            deleted_count: result.deleted.len(),
            error_count: result.stats.errors,
            stats: result.stats.clone(),
        }
    }
}

/// Get fingerprints scoped to the given scan paths at the SQL level.
/// Avoids loading the entire library into memory when scanning a single folder.
fn get_scoped_fingerprints(
    db: &Database,
    scan_paths: &[String],
) -> Result<HashMap<String, FileFingerprint>, String> {
    let conn = db.conn().map_err(|e| e.to_string())?;
    let rows =
        library::get_fingerprints_for_paths(&conn, scan_paths).map_err(|e| e.to_string())?;

    Ok(rows
        .into_iter()
        .map(|(filepath, mtime_ns, size)| (filepath, FileFingerprint::from_db(mtime_ns, size)))
        .collect())
}

/// Scan paths and add/update tracks in the database
#[tracing::instrument(skip(app, db, paths))]
#[tauri::command]
pub async fn scan_paths_to_library(
    app: AppHandle,
    db: State<'_, Database>,
    paths: Vec<String>,
    recursive: bool,
) -> Result<ScanResultResponse, String> {
    let job_id = generate_job_id();
    let start_time = Instant::now();

    // Get DB fingerprints scoped to the scan paths only.
    // Without scoping, scanning a single file would mark every other track in the
    // library as "deleted" because the inventory phase only walks the provided paths.
    // Scope fingerprint query at SQL level — for a 13k-track library scanning 1 folder,
    // this avoids loading 13k rows and filtering in memory.
    let db_fingerprints = get_scoped_fingerprints(&db, &paths)?;

    // Create progress callback that emits standardized Tauri events
    let app_handle = app.clone();
    let job_id_clone = job_id.clone();
    let progress_callback: ProgressCallback = Box::new(move |progress: ScanProgress| {
        let _ = app_handle.emit_scan_progress(ScanProgressEvent {
            job_id: job_id_clone.clone(),
            status: progress.phase.clone(),
            scanned: progress.current as u32,
            found: 0, // Will be updated in final event
            errors: 0,
            current_path: progress.message.clone(),
        });
    });

    // Run 2-phase scan
    let scan_result = scan_2phase(&paths, &db_fingerprints, recursive, Some(&progress_callback))
        .map_err(|e| e.to_string())?;

    // Transaction 1: reconciliation and updates (mark missing, reconcile moves, update modified,
    // mark present). These are interdependent and need atomicity.
    let modified_count = scan_result.modified.len();
    let (truly_new, reconciled_count, recovered_count) = db
        .transaction(|conn| {
            let mut reconciled_count = 0;

            // IMPORTANT: Mark deleted tracks as missing FIRST
            // This is required because reconciliation of "added" tracks looks for tracks
            // where missing=1. If a file is moved (delete + add in same scan), we need to
            // mark the old path as missing before we can reconcile it with the new path.
            for filepath in &scan_result.deleted {
                let _ = library::mark_track_missing_by_filepath(conn, filepath);
            }

            // Process "added" tracks - check for moves first, collect truly new tracks
            // Now that deleted tracks are marked missing, reconciliation by inode/hash will work
            let mut truly_new: Vec<(String, crate::db::TrackMetadata)> = Vec::new();

            if !scan_result.added.is_empty() {
                // Pre-fetch all missing tracks once for O(1) lookups instead of per-file queries
                let missing_tracks = library::get_missing_tracks(conn).unwrap_or_default();
                let by_inode: HashMap<i64, &crate::db::Track> = missing_tracks
                    .iter()
                    .filter_map(|t| t.file_inode.map(|i| (i, t)))
                    .collect();
                let by_hash: HashMap<&str, &crate::db::Track> = missing_tracks
                    .iter()
                    .filter_map(|t| t.content_hash.as_deref().map(|h| (h, t)))
                    .collect();

                for m in &scan_result.added {
                    let mut was_reconciled = false;
                    let mut computed_hash: Option<String> = None;

                    // O(1) inode lookup instead of per-file DB query
                    if let Some(inode) = m.file_inode
                        && let Some(track) = by_inode.get(&(inode as i64))
                        && library::reconcile_moved_track(
                            conn,
                            track.id,
                            &m.filepath,
                            Some(inode),
                        )
                        .is_ok()
                    {
                        reconciled_count += 1;
                        was_reconciled = true;
                    }

                    // O(1) hash lookup instead of per-file DB query
                    if !was_reconciled
                        && let Ok(hash) =
                            compute_content_hash(std::path::Path::new(&m.filepath))
                    {
                        if let Some(track) = by_hash.get(hash.as_str()) {
                            let reconcile_result = library::reconcile_moved_track(
                                conn,
                                track.id,
                                &m.filepath,
                                m.file_inode,
                            );
                            if reconcile_result.is_ok() {
                                reconciled_count += 1;
                                was_reconciled = true;
                            }
                        }
                        // Preserve the hash so to_db_metadata doesn't recompute it
                        if !was_reconciled {
                            computed_hash = Some(hash);
                        }
                    }

                    if !was_reconciled {
                        truly_new.push((
                            m.filepath.clone(),
                            to_db_metadata_with_hash(m, computed_hash),
                        ));
                    }
                }
            }

            // Update modified tracks
            if !scan_result.modified.is_empty() {
                let updates: Vec<(String, crate::db::TrackMetadata)> = scan_result
                    .modified
                    .iter()
                    .map(|m| (m.filepath.clone(), to_db_metadata(m)))
                    .collect();

                library::update_tracks_bulk(conn, &updates)?;
            }

            // Clear missing flag for unchanged files that were previously missing but have reappeared
            // This handles the case where a file is moved out and then moved back to the same location
            let mut recovered_count = 0;
            if !scan_result.unchanged.is_empty()
                && let Ok(count) =
                    library::mark_tracks_present_by_filepaths(conn, &scan_result.unchanged)
            {
                recovered_count = count;
            }

            Ok((truly_new, reconciled_count, recovered_count))
        })
        .map_err(|e| e.to_string())?;

    // Transaction 2+: chunked bulk inserts. Committing every ~500 tracks releases the write
    // lock between chunks, allowing concurrent reads (playback, UI queries).
    let added_count = truly_new.len();
    if !truly_new.is_empty() {
        const CHUNK_SIZE: usize = 500;
        for chunk in truly_new.chunks(CHUNK_SIZE) {
            db.transaction(|conn| library::add_tracks_bulk(conn, chunk))
                .map_err(|e| e.to_string())?;
        }

        // Auto-favorite tracks that match cached Last.fm loved tracks
        db.transaction(|conn| {
            let new_filepaths: Vec<String> =
                truly_new.iter().map(|(fp, _)| fp.clone()).collect();
            if let Ok(new_track_ids) = library::get_track_ids_by_filepaths(conn, &new_filepaths)
                && !new_track_ids.is_empty()
            {
                match match_new_tracks_against_loved(conn, &new_track_ids) {
                    Ok(favorited) if favorited > 0 => {
                        info!(count = favorited, "Auto-favorited tracks from Last.fm loved cache");
                    }
                    Err(e) => {
                        error!(error = %e, "Failed to auto-favorite from loved cache");
                    }
                    _ => {}
                }
            }
            Ok(())
        })
        .map_err(|e| e.to_string())?;
    }

    let duration_ms = start_time.elapsed().as_millis() as u64;
    info!(
        duration_ms,
        added = added_count,
        modified = modified_count,
        reconciled = reconciled_count,
        recovered = recovered_count,
        unchanged = scan_result.unchanged.len(),
        deleted = scan_result.deleted.len(),
        errors = scan_result.stats.errors,
        "Scan complete"
    );
    crate::logging::log_slow_command("scan_paths_to_library", start_time);

    // Emit scan complete event
    let _ = app.emit_scan_complete(ScanCompleteEvent {
        job_id: job_id.clone(),
        added: added_count as u32,
        skipped: scan_result.unchanged.len() as u32,
        errors: scan_result.stats.errors as u32,
        duration_ms,
    });

    // Emit library updated events (empty track_ids signals a bulk change - frontend should refresh)
    if added_count > 0 || reconciled_count > 0 || recovered_count > 0 {
        let _ = app.emit_library_updated(LibraryUpdatedEvent::added(vec![]));
    }
    if modified_count > 0 {
        let _ = app.emit_library_updated(LibraryUpdatedEvent::modified(vec![]));
    }

    Ok(ScanResultResponse::from(&scan_result))
}

/// Scan a single path (file or directory) without database integration
#[tracing::instrument(skip(app, paths))]
#[tauri::command]
pub async fn scan_paths_metadata(
    app: AppHandle,
    paths: Vec<String>,
    recursive: bool,
) -> Result<Vec<ExtractedMetadata>, String> {
    let db_fingerprints: HashMap<String, FileFingerprint> = HashMap::new();

    // Create progress callback (uses internal event format for metadata-only scans)
    let app_handle = app.clone();
    let progress_callback: ProgressCallback = Box::new(move |progress: ScanProgress| {
        let _ = app_handle.emit(
            "scan-progress",
            MetadataScanProgress {
                phase: progress.phase,
                current: progress.current,
                total: progress.total,
                message: progress.message,
            },
        );
    });

    let scan_result = scan_2phase(&paths, &db_fingerprints, recursive, Some(&progress_callback))
        .map_err(|e| e.to_string())?;

    // Return all metadata (added is everything since we have no DB fingerprints)
    Ok(scan_result.added)
}

/// Extract metadata from a single file
#[tracing::instrument]
#[tauri::command]
pub fn extract_file_metadata(filepath: String) -> Result<ExtractedMetadata, String> {
    extract_metadata(&filepath).map_err(|e| e.to_string())
}

/// Get artwork for a track
#[tracing::instrument]
#[tauri::command]
pub fn get_track_artwork(filepath: String) -> Option<Artwork> {
    get_artwork(&filepath)
}

/// Get artwork as a data URL for use in img src
#[tracing::instrument]
#[tauri::command]
pub fn get_track_artwork_url(filepath: String) -> Option<String> {
    crate::scanner::artwork::get_artwork_data_url(&filepath)
}

/// Convert ExtractedMetadata to database TrackMetadata
/// Convert extracted metadata to DB metadata.
/// If `precomputed_hash` is provided, it is used directly instead of re-hashing the file.
fn to_db_metadata_with_hash(
    m: &ExtractedMetadata,
    precomputed_hash: Option<String>,
) -> crate::db::TrackMetadata {
    let content_hash =
        precomputed_hash.or_else(|| compute_content_hash(std::path::Path::new(&m.filepath)).ok());
    crate::db::TrackMetadata {
        title: m.title.clone(),
        artist: m.artist.clone(),
        album: m.album.clone(),
        album_artist: m.album_artist.clone(),
        track_number: m.track_number.clone(),
        track_total: m.track_total.clone(),
        disc_number: m.disc_number.map(|n| n.to_string()),
        disc_total: m.disc_total.map(|n| n.to_string()),
        date: m.date.clone(),
        genre: m.genre.clone(),
        duration: m.duration,
        file_size: Some(m.file_size),
        file_mtime_ns: m.file_mtime_ns,
        file_inode: m.file_inode,
        content_hash,
    }
}

fn to_db_metadata(m: &ExtractedMetadata) -> crate::db::TrackMetadata {
    to_db_metadata_with_hash(m, None)
}
