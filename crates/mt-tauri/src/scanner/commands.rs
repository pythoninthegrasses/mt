//! Tauri commands for scanner operations.
//!
//! These commands expose the scanner functionality to the frontend
//! with progress events emitted during scanning.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Instant;
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

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

/// Get fingerprints from the database for comparison
fn get_db_fingerprints(db: &Database) -> Result<HashMap<String, FileFingerprint>, String> {
    let conn = db.conn().map_err(|e| e.to_string())?;

    // Get all tracks with their fingerprints
    let mut stmt = conn
        .prepare("SELECT filepath, file_mtime_ns, file_size FROM library")
        .map_err(|e| e.to_string())?;

    let fingerprints: HashMap<String, FileFingerprint> = stmt
        .query_map([], |row| {
            let filepath: String = row.get(0)?;
            let mtime_ns: Option<i64> = row.get(1)?;
            let size: i64 = row.get(2)?;
            Ok((filepath, FileFingerprint::from_db(mtime_ns, size)))
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(fingerprints)
}

/// Scan paths and add/update tracks in the database
#[tauri::command]
pub async fn scan_paths_to_library(
    app: AppHandle,
    db: State<'_, Database>,
    paths: Vec<String>,
    recursive: bool,
) -> Result<ScanResultResponse, String> {
    let job_id = generate_job_id();
    let start_time = Instant::now();

    // Get current fingerprints from DB
    let db_fingerprints = get_db_fingerprints(&db)?;

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

    // Get database connection for updates
    let conn = db.conn().map_err(|e| e.to_string())?;

    let mut added_count = 0;
    let mut reconciled_count = 0;
    let modified_count = scan_result.modified.len();

    // IMPORTANT: Mark deleted tracks as missing FIRST
    // This is required because reconciliation of "added" tracks looks for tracks
    // where missing=1. If a file is moved (delete + add in same scan), we need to
    // mark the old path as missing before we can reconcile it with the new path.
    for filepath in &scan_result.deleted {
        let _ = library::mark_track_missing_by_filepath(&conn, filepath);
    }

    // Process "added" tracks - check for moves first, then add truly new tracks
    // Now that deleted tracks are marked missing, reconciliation by inode/hash will work
    if !scan_result.added.is_empty() {
        let mut truly_new: Vec<(String, crate::db::TrackMetadata)> = Vec::new();

        for m in &scan_result.added {
            let mut was_reconciled = false;

            if let Some(inode) = m.file_inode {
                let track_result = library::find_missing_track_by_inode(&conn, inode);
                if let Ok(Some(track)) = track_result {
                    let reconcile_result = library::reconcile_moved_track(&conn, track.id, &m.filepath, Some(inode));
                    if reconcile_result.is_ok() {
                        reconciled_count += 1;
                        was_reconciled = true;
                    }
                }
            }

            if !was_reconciled
                && let Ok(hash) = compute_content_hash(std::path::Path::new(&m.filepath)) {
                    let track_result = library::find_missing_track_by_content_hash(&conn, &hash);
                    if let Ok(Some(track)) = track_result {
                        let reconcile_result = library::reconcile_moved_track(&conn, track.id, &m.filepath, m.file_inode);
                        if reconcile_result.is_ok() {
                            reconciled_count += 1;
                            was_reconciled = true;
                        }
                    }
                }

            if !was_reconciled {
                truly_new.push((m.filepath.clone(), to_db_metadata(m)));
            }
        }

        // Add truly new tracks to database
        if !truly_new.is_empty() {
            added_count = truly_new.len();
            library::add_tracks_bulk(&conn, &truly_new).map_err(|e| e.to_string())?;
        }
    }

    // Update modified tracks
    if !scan_result.modified.is_empty() {
        let updates: Vec<(String, crate::db::TrackMetadata)> = scan_result
            .modified
            .iter()
            .map(|m| (m.filepath.clone(), to_db_metadata(m)))
            .collect();

        library::update_tracks_bulk(&conn, &updates).map_err(|e| e.to_string())?;
    }

    // Clear missing flag for unchanged files that were previously missing but have reappeared
    // This handles the case where a file is moved out and then moved back to the same location
    let mut recovered_count = 0;
    if !scan_result.unchanged.is_empty()
        && let Ok(count) = library::mark_tracks_present_by_filepaths(&conn, &scan_result.unchanged) {
            recovered_count = count;
        }

    let duration_ms = start_time.elapsed().as_millis() as u64;

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
#[tauri::command]
pub fn extract_file_metadata(filepath: String) -> Result<ExtractedMetadata, String> {
    extract_metadata(&filepath).map_err(|e| e.to_string())
}

/// Get artwork for a track
#[tauri::command]
pub fn get_track_artwork(filepath: String) -> Option<Artwork> {
    get_artwork(&filepath)
}

/// Get artwork as a data URL for use in img src
#[tauri::command]
pub fn get_track_artwork_url(filepath: String) -> Option<String> {
    crate::scanner::artwork::get_artwork_data_url(&filepath)
}

/// Convert ExtractedMetadata to database TrackMetadata
fn to_db_metadata(m: &ExtractedMetadata) -> crate::db::TrackMetadata {
    let content_hash = compute_content_hash(std::path::Path::new(&m.filepath)).ok();
    crate::db::TrackMetadata {
        title: m.title.clone(),
        artist: m.artist.clone(),
        album: m.album.clone(),
        album_artist: m.album_artist.clone(),
        track_number: m.track_number.clone(),
        track_total: m.track_total.clone(),
        date: m.date.clone(),
        duration: m.duration,
        file_size: Some(m.file_size),
        file_mtime_ns: m.file_mtime_ns,
        file_inode: m.file_inode,
        content_hash,
    }
}
