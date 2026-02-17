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

    // Transaction 1: mark operations + inode-based reconciliation only.
    // Hash computation is deferred to outside the transaction to avoid holding the
    // SQLite write lock during I/O-heavy SHA-256 reads.
    let modified_count = scan_result.modified.len();
    let (unreconciled_indices, has_missing_hashes, mut reconciled_count, recovered_count) = db
        .transaction(|conn| {
            let mut reconciled_count = 0;

            // IMPORTANT: Mark deleted tracks as missing FIRST
            for filepath in &scan_result.deleted {
                let _ = library::mark_track_missing_by_filepath(conn, filepath);
            }

            let mut unreconciled_indices: Vec<usize> = Vec::new();
            let mut has_missing_hashes = false;

            if !scan_result.added.is_empty() {
                let missing_tracks = library::get_missing_tracks(conn).unwrap_or_default();

                if missing_tracks.is_empty() {
                    // Fast path: no missing tracks, all added files are truly new
                    unreconciled_indices = (0..scan_result.added.len()).collect();
                } else {
                    has_missing_hashes =
                        missing_tracks.iter().any(|t| t.content_hash.is_some());
                    let by_inode: HashMap<i64, &crate::db::Track> = missing_tracks
                        .iter()
                        .filter_map(|t| t.file_inode.map(|i| (i, t)))
                        .collect();

                    for (idx, m) in scan_result.added.iter().enumerate() {
                        let mut was_reconciled = false;

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

                        if !was_reconciled {
                            unreconciled_indices.push(idx);
                        }
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

            // Clear missing flag for unchanged files that were previously missing but reappeared
            let mut recovered_count = 0;
            if !scan_result.unchanged.is_empty()
                && let Ok(count) =
                    library::mark_tracks_present_by_filepaths(conn, &scan_result.unchanged)
            {
                recovered_count = count;
            }

            Ok((
                unreconciled_indices,
                has_missing_hashes,
                reconciled_count,
                recovered_count,
            ))
        })
        .map_err(|e| e.to_string())?;

    // Spacedrive pattern: defer content hashing. Initial import uses "shallow" mode
    // (metadata only). Content hashes are populated later by Manual Scan when needed
    // for move detection and dedup. This eliminates ~8s of parallel SHA-256 I/O.
    let truly_new: Vec<(String, crate::db::TrackMetadata)> = if has_missing_hashes {
        // Rare path: missing tracks exist with hashes — compute hashes for reconciliation
        use rayon::prelude::*;
        let hashed: Vec<(usize, Option<String>)> = unreconciled_indices
            .par_iter()
            .map(|&idx| {
                let m = &scan_result.added[idx];
                let hash = compute_content_hash(std::path::Path::new(&m.filepath)).ok();
                (idx, hash)
            })
            .collect();

        db.transaction(|conn| {
            let missing_tracks = library::get_missing_tracks(conn).unwrap_or_default();
            let by_hash: HashMap<&str, &crate::db::Track> = missing_tracks
                .iter()
                .filter_map(|t| t.content_hash.as_deref().map(|h| (h, t)))
                .collect();

            let mut result = Vec::new();
            for &(idx, ref hash) in &hashed {
                let m = &scan_result.added[idx];
                let mut was_reconciled = false;

                if let Some(h) = hash
                    && let Some(track) = by_hash.get(h.as_str())
                    && library::reconcile_moved_track(conn, track.id, &m.filepath, m.file_inode)
                        .is_ok()
                {
                    reconciled_count += 1;
                    was_reconciled = true;
                }

                if !was_reconciled {
                    result.push((
                        m.filepath.clone(),
                        to_db_metadata_with_hash(m, hash.clone()),
                    ));
                }
            }
            Ok(result)
        })
        .map_err(|e| e.to_string())?
    } else {
        // Common path: insert with content_hash = NULL. Hashes are populated
        // later by Manual Scan (Settings > Library > Run Scan).
        unreconciled_indices
            .iter()
            .map(|&idx| {
                let m = &scan_result.added[idx];
                (m.filepath.clone(), to_db_metadata_with_hash(m, None))
            })
            .collect()
    };

    // Chunked bulk inserts. Committing every ~500 tracks releases the write lock
    // between chunks, allowing concurrent reads (playback, UI queries).
    let added_count = truly_new.len();
    if !truly_new.is_empty() {
        const CHUNK_SIZE: usize = 1000;
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
    let content_hash = precomputed_hash;
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
