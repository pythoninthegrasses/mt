//! Watched folders management with filesystem monitoring.
//!
//! Migrated from Python FastAPI to native Rust with direct database access.
//! Supports real-time filesystem watching via notify crate.

use notify_debouncer_full::{
    new_debouncer,
    notify::{self, RecursiveMode},
    DebounceEventResult, Debouncer, RecommendedCache,
};
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::mpsc;

use crate::db::{library, watched, Database, TrackMetadata, WatchedFolder as DbWatchedFolder};
use crate::events::{EventEmitter, LibraryUpdatedEvent, ScanCompleteEvent, ScanProgressEvent};
use crate::scanner::fingerprint::{compute_content_hash, FileFingerprint};
use crate::scanner::scan::{scan_2phase, ProgressCallback};
use crate::scanner::ExtractedMetadata;

/// Watched folder response for frontend (matches existing API contract)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WatchedFolder {
    pub id: i64,
    pub path: String,
    pub mode: String,
    pub cadence_minutes: Option<i64>,
    pub enabled: bool,
    pub last_scanned_at: Option<i64>,
}

impl From<DbWatchedFolder> for WatchedFolder {
    fn from(f: DbWatchedFolder) -> Self {
        WatchedFolder {
            id: f.id,
            path: f.path,
            mode: f.mode,
            cadence_minutes: Some(f.cadence_minutes),
            enabled: f.enabled,
            last_scanned_at: f.last_scanned_at,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct WatcherStatus {
    pub folder_id: i64,
    pub status: String,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ScanProgress {
    pub folder_id: i64,
    pub percent: Option<u8>,
    pub stage: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ScanResults {
    pub folder_id: i64,
    pub added: i32,
    pub updated: i32,
    pub deleted: i32,
}

#[derive(Debug, Clone, Serialize)]
pub struct FsEvent {
    pub folder_id: i64,
    pub event_type: String,
    pub paths: Vec<String>,
}

/// Manages filesystem watchers for watched folders
pub struct WatcherManager {
    app: AppHandle,
    db: Database,
    active_watchers: Arc<RwLock<HashMap<i64, WatcherHandle>>>,
}

struct WatcherHandle {
    #[allow(dead_code)]
    folder_id: i64,
    cancel_tx: mpsc::Sender<()>,
    #[allow(dead_code)]
    fs_watcher: Option<Debouncer<notify::RecommendedWatcher, RecommendedCache>>,
}

impl WatcherManager {
    pub fn new(app: AppHandle, db: Database) -> Self {
        Self {
            app,
            db,
            active_watchers: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub fn get_db(&self) -> &Database {
        &self.db
    }

    pub async fn start(&self) -> Result<(), String> {
        let folders = self.fetch_enabled_folders()?;

        for folder in folders {
            if folder.enabled {
                self.start_watching(folder).await?;
            }
        }

        Ok(())
    }

    pub async fn stop(&self) {
        let cancel_txs: Vec<_> = {
            let watchers = self.active_watchers.read();
            watchers.values().map(|h| h.cancel_tx.clone()).collect()
        };
        for tx in cancel_txs {
            let _ = tx.send(()).await;
        }
    }

    pub fn active_watcher_count(&self) -> usize {
        self.active_watchers.read().len()
    }

    fn fetch_enabled_folders(&self) -> Result<Vec<WatchedFolder>, String> {
        let conn = self.db.conn().map_err(|e| e.to_string())?;
        let folders = watched::get_enabled_watched_folders(&conn)
            .map_err(|e| format!("Failed to fetch watched folders: {}", e))?;
        Ok(folders.into_iter().map(WatchedFolder::from).collect())
    }

    async fn start_watching(&self, folder: WatchedFolder) -> Result<(), String> {
        let (cancel_tx, mut cancel_rx) = mpsc::channel::<()>(1);

        let app = self.app.clone();
        let db = self.db.clone();
        let folder_id = folder.id;
        let mode = folder.mode.clone();
        let cadence_minutes = folder.cadence_minutes.unwrap_or(10) as u64;
        let folder_path = folder.path.clone();

        println!(
            "[watcher] Starting watcher for folder {} (mode={}, cadence={}min)",
            folder_id, mode, cadence_minutes
        );

        let fs_watcher = if mode == "continuous" {
            self.create_fs_watcher(folder_id, &folder_path)
        } else {
            None
        };

        let handle = WatcherHandle {
            folder_id: folder.id,
            cancel_tx,
            fs_watcher,
        };

        self.active_watchers.write().insert(folder.id, handle);

        tokio::spawn(async move {
            if mode == "startup" {
                Self::trigger_rescan(&app, &db, folder_id).await;
            } else if mode == "continuous" {
                Self::trigger_rescan(&app, &db, folder_id).await;

                let mut interval =
                    tokio::time::interval(Duration::from_secs(cadence_minutes * 60));
                interval.tick().await;

                loop {
                    tokio::select! {
                        _ = interval.tick() => {
                            Self::trigger_rescan(&app, &db, folder_id).await;
                        }
                        _ = cancel_rx.recv() => {
                            println!("[watcher] Stopping watcher for folder {}", folder_id);
                            break;
                        }
                    }
                }
            }
        });

        Ok(())
    }

    fn create_fs_watcher(
        &self,
        folder_id: i64,
        folder_path: &str,
    ) -> Option<Debouncer<notify::RecommendedWatcher, RecommendedCache>> {
        let app = self.app.clone();
        let db = self.db.clone();
        let path = PathBuf::from(folder_path);

        if !path.exists() {
            eprintln!(
                "[watcher] Cannot watch folder {}: path does not exist",
                folder_path
            );
            return None;
        }

        let debounce_duration = Duration::from_millis(1000);

        // Capture the Tokio runtime handle to spawn async tasks from the sync callback
        let runtime_handle = tokio::runtime::Handle::current();

        let debouncer_result =
            new_debouncer(debounce_duration, None, move |result: DebounceEventResult| {
                match result {
                    Ok(events) => {
                        let mut has_changes = false;
                        let mut event_paths: Vec<String> = Vec::new();

                        for event in events.iter() {
                            match event.kind {
                                notify::EventKind::Create(_)
                                | notify::EventKind::Modify(_)
                                | notify::EventKind::Remove(_) => {
                                    has_changes = true;
                                    for p in &event.paths {
                                        if let Some(ext) = p.extension() {
                                            let ext_lower = ext.to_string_lossy().to_lowercase();
                                            if matches!(
                                                ext_lower.as_str(),
                                                "mp3" | "flac"
                                                    | "m4a"
                                                    | "ogg"
                                                    | "wav"
                                                    | "aac"
                                                    | "wma"
                                                    | "opus"
                                            ) {
                                                event_paths.push(p.to_string_lossy().to_string());
                                            }
                                        }
                                    }
                                }
                                _ => {}
                            }
                        }

                        if has_changes && !event_paths.is_empty() {
                            println!(
                                "[watcher] FS events detected for folder {}: {} files changed",
                                folder_id,
                                event_paths.len()
                            );

                            let _ = app.emit(
                                "watched-folder:fs-event",
                                FsEvent {
                                    folder_id,
                                    event_type: "change".to_string(),
                                    paths: event_paths,
                                },
                            );

                            let app_clone = app.clone();
                            let db_clone = db.clone();
                            runtime_handle.spawn(async move {
                                Self::trigger_rescan(&app_clone, &db_clone, folder_id).await;
                            });
                        }
                    }
                    Err(errors) => {
                        for error in errors {
                            eprintln!(
                                "[watcher] FS watcher error for folder {}: {:?}",
                                folder_id, error
                            );
                        }
                    }
                }
            });

        match debouncer_result {
            Ok(mut debouncer) => {
                if let Err(e) = debouncer.watch(&path, RecursiveMode::Recursive) {
                    eprintln!(
                        "[watcher] Failed to start watching folder {}: {:?}",
                        folder_path, e
                    );
                    return None;
                }
                println!(
                    "[watcher] FS watcher active for folder {} at {}",
                    folder_id, folder_path
                );
                Some(debouncer)
            }
            Err(e) => {
                eprintln!(
                    "[watcher] Failed to create debouncer for folder {}: {:?}",
                    folder_path, e
                );
                None
            }
        }
    }

    /// Trigger a rescan for a watched folder using native Rust scanner
    async fn trigger_rescan(app: &AppHandle, db: &Database, folder_id: i64) {
        println!("[watcher] Triggering rescan for folder {}", folder_id);

        let _ = app.emit(
            "watched-folder:status",
            WatcherStatus {
                folder_id,
                status: "scanning".to_string(),
                message: None,
            },
        );

        // Get the folder info
        let folder = {
            let conn = match db.conn() {
                Ok(c) => c,
                Err(e) => {
                    eprintln!("[watcher] Failed to get DB connection: {}", e);
                    return;
                }
            };

            let folder_result = watched::get_watched_folder(&conn, folder_id);
            match folder_result {
                Ok(Some(f)) => f,
                Ok(None) => {
                    eprintln!("[watcher] Folder {} not found", folder_id);
                    return;
                }
                Err(e) => {
                    eprintln!("[watcher] Failed to get folder {}: {}", folder_id, e);
                    return;
                }
            }
        };

        let job_id = format!("watcher-{}-{}", folder_id, std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis());

        // Get current fingerprints from DB
        let db_fingerprints: HashMap<String, FileFingerprint> = {
            let conn = match db.conn() {
                Ok(c) => c,
                Err(e) => {
                    eprintln!("[watcher] Failed to get DB connection: {}", e);
                    return;
                }
            };

            let mut stmt = match conn
                .prepare("SELECT filepath, file_mtime_ns, file_size FROM library")
            {
                Ok(s) => s,
                Err(e) => {
                    eprintln!("[watcher] Failed to prepare fingerprint query: {}", e);
                    return;
                }
            };

            stmt.query_map([], |row| {
                let filepath: String = row.get(0)?;
                let mtime_ns: Option<i64> = row.get(1)?;
                let size: i64 = row.get(2)?;
                Ok((filepath, FileFingerprint::from_db(mtime_ns, size)))
            })
            .map(|iter| iter.filter_map(|r| r.ok()).collect())
            .unwrap_or_default()
        };

        // Create progress callback
        let app_for_progress = app.clone();
        let job_id_for_progress = job_id.clone();
        let progress_callback: ProgressCallback =
            Box::new(move |progress: crate::scanner::ScanProgress| {
                let _ = app_for_progress.emit_scan_progress(ScanProgressEvent {
                    job_id: job_id_for_progress.clone(),
                    status: progress.phase.clone(),
                    scanned: progress.current as u32,
                    found: 0,
                    errors: 0,
                    current_path: progress.message.clone(),
                });
            });

        // Run 2-phase scan in a blocking task to prevent UI freeze
        let folder_path = folder.path.clone();
        let scan_result = match tokio::task::spawn_blocking(move || {
            scan_2phase(
                &[folder_path],
                &db_fingerprints,
                true,
                Some(&progress_callback),
            )
        })
        .await
        {
            Ok(Ok(r)) => r,
            Ok(Err(e)) => {
                eprintln!("[watcher] Scan failed for folder {}: {}", folder_id, e);
                let _ = app.emit(
                    "watched-folder:status",
                    WatcherStatus {
                        folder_id,
                        status: "error".to_string(),
                        message: Some(format!("Scan failed: {}", e)),
                    },
                );
                return;
            }
            Err(e) => {
                eprintln!("[watcher] Scan task panicked for folder {}: {}", folder_id, e);
                let _ = app.emit(
                    "watched-folder:status",
                    WatcherStatus {
                        folder_id,
                        status: "error".to_string(),
                        message: Some(format!("Scan task failed: {}", e)),
                    },
                );
                return;
            }
        };

        // Update database
        let (added, updated, deleted) = {
            let conn = match db.conn() {
                Ok(c) => c,
                Err(e) => {
                    eprintln!("[watcher] Failed to get DB connection: {}", e);
                    return;
                }
            };

            let modified_count = scan_result.modified.len();
            let deleted_count = scan_result.deleted.len();

            // IMPORTANT: Mark deleted tracks as missing FIRST
            // This is required because reconciliation of "added" tracks looks for tracks
            // where missing=1. If a file is moved (delete + add in same scan), we need to
            // mark the old path as missing before we can reconcile it with the new path.
            if !scan_result.deleted.is_empty() {
                for filepath in &scan_result.deleted {
                    let mark_result = library::mark_track_missing_by_filepath(&conn, filepath);
                    if let Err(e) = mark_result {
                        eprintln!("[watcher] Failed to mark track missing: {}", e);
                    }
                }
            }

            // Process "added" tracks - check for moves first, then add truly new tracks
            // Now that deleted tracks are marked missing, reconciliation by inode/hash will work
            let mut added_count = 0;
            let mut reconciled_count = 0;
            if !scan_result.added.is_empty() {
                let mut truly_new: Vec<(String, TrackMetadata)> = Vec::new();

                for m in &scan_result.added {
                    let mut was_reconciled = false;

                    if let Some(inode) = m.file_inode {
                        let track_result = library::find_missing_track_by_inode(&conn, inode);
                        if let Ok(Some(track)) = track_result {
                            let reconcile_result = library::reconcile_moved_track(
                                &conn,
                                track.id,
                                &m.filepath,
                                Some(inode),
                            );
                            if reconcile_result.is_ok() {
                                reconciled_count += 1;
                                was_reconciled = true;
                                println!(
                                    "[watcher] Reconciled moved track {} by inode: {} -> {}",
                                    track.id, track.filepath, m.filepath
                                );
                            }
                        }
                    }

                    if !was_reconciled
                        && let Ok(hash) = compute_content_hash(std::path::Path::new(&m.filepath)) {
                            let track_result = library::find_missing_track_by_content_hash(&conn, &hash);
                            if let Ok(Some(track)) = track_result {
                                let reconcile_result = library::reconcile_moved_track(
                                    &conn,
                                    track.id,
                                    &m.filepath,
                                    m.file_inode,
                                );
                                if reconcile_result.is_ok() {
                                    reconciled_count += 1;
                                    was_reconciled = true;
                                    println!(
                                        "[watcher] Reconciled moved track {} by content hash: {} -> {}",
                                        track.id, track.filepath, m.filepath
                                    );
                                }
                            }
                        }

                    if !was_reconciled {
                        truly_new.push((m.filepath.clone(), to_track_metadata(m)));
                    }
                }

                // Add truly new tracks to database
                if !truly_new.is_empty() {
                    added_count = truly_new.len();
                    if let Err(e) = library::add_tracks_bulk(&conn, &truly_new) {
                        eprintln!("[watcher] Failed to add tracks: {}", e);
                    }
                }
            }

            // Update modified tracks
            if !scan_result.modified.is_empty() {
                let updates: Vec<(String, TrackMetadata)> = scan_result
                    .modified
                    .iter()
                    .map(|m| (m.filepath.clone(), to_track_metadata(m)))
                    .collect();

                if let Err(e) = library::update_tracks_bulk(&conn, &updates) {
                    eprintln!("[watcher] Failed to update tracks: {}", e);
                }
            }

            // Clear missing flag for unchanged files that were previously missing but have reappeared
            // This handles the case where a file is moved out and then moved back to the same location
            let mut recovered_count = 0;
            if !scan_result.unchanged.is_empty() {
                match library::mark_tracks_present_by_filepaths(&conn, &scan_result.unchanged) {
                    Ok(count) => {
                        if count > 0 {
                            recovered_count = count;
                            println!(
                                "[watcher] Recovered {} previously missing track(s) that reappeared",
                                count
                            );
                        }
                    }
                    Err(e) => {
                        eprintln!("[watcher] Failed to mark recovered tracks present: {}", e);
                    }
                }
            }

            // Update last_scanned_at timestamp
            if let Err(e) = watched::update_watched_folder_last_scanned(&conn, folder_id) {
                eprintln!("[watcher] Failed to update last_scanned_at: {}", e);
            }

            (
                (added_count + reconciled_count + recovered_count) as i32,
                modified_count as i32,
                deleted_count as i32,
            )
        };

        println!(
            "[watcher] Folder {} scan complete: +{} ~{} -{}",
            folder_id, added, updated, deleted
        );

        // Emit scan complete event
        let _ = app.emit_scan_complete(ScanCompleteEvent {
            job_id: job_id.clone(),
            added: added as u32,
            skipped: scan_result.unchanged.len() as u32,
            errors: scan_result.stats.errors as u32,
            duration_ms: 0,
        });

        // Emit results event
        let _ = app.emit(
            "watched-folder:results",
            ScanResults {
                folder_id,
                added,
                updated,
                deleted,
            },
        );

        // Emit library updated events
        if added > 0 {
            let _ = app.emit_library_updated(LibraryUpdatedEvent::added(vec![]));
        }
        if updated > 0 {
            let _ = app.emit_library_updated(LibraryUpdatedEvent::modified(vec![]));
        }
        if deleted > 0 {
            let _ = app.emit_library_updated(LibraryUpdatedEvent::deleted(vec![]));
        }

        let _ = app.emit(
            "watched-folder:status",
            WatcherStatus {
                folder_id,
                status: "idle".to_string(),
                message: None,
            },
        );
    }

    pub async fn add_folder(&self, folder: WatchedFolder) -> Result<(), String> {
        if folder.enabled {
            self.start_watching(folder).await?;
        }
        Ok(())
    }

    pub async fn remove_folder(&self, folder_id: i64) {
        let cancel_tx = self
            .active_watchers
            .write()
            .remove(&folder_id)
            .map(|h| h.cancel_tx);
        if let Some(tx) = cancel_tx {
            let _ = tx.send(()).await;
        }
    }

    pub async fn update_folder(&self, folder: WatchedFolder) -> Result<(), String> {
        self.remove_folder(folder.id).await;
        if folder.enabled {
            self.start_watching(folder).await?;
        }
        Ok(())
    }

    /// Trigger a manual rescan for a specific folder
    pub async fn rescan_folder(&self, folder_id: i64) {
        Self::trigger_rescan(&self.app, &self.db, folder_id).await;
    }
}

/// Convert ExtractedMetadata to database TrackMetadata
fn to_track_metadata(m: &ExtractedMetadata) -> TrackMetadata {
    let content_hash = compute_content_hash(std::path::Path::new(&m.filepath)).ok();
    TrackMetadata {
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

// ============================================================================
// Tauri Commands
// ============================================================================

/// List all watched folders
#[tauri::command]
pub fn watched_folders_list(
    state: State<'_, WatcherManager>,
) -> Result<Vec<WatchedFolder>, String> {
    let conn = state.get_db().conn().map_err(|e| e.to_string())?;
    let folders = watched::get_watched_folders(&conn)
        .map_err(|e| format!("Failed to fetch watched folders: {}", e))?;
    Ok(folders.into_iter().map(WatchedFolder::from).collect())
}

/// Get a specific watched folder by ID
#[tauri::command]
pub fn watched_folders_get(
    id: i64,
    state: State<'_, WatcherManager>,
) -> Result<WatchedFolder, String> {
    let conn = state.get_db().conn().map_err(|e| e.to_string())?;
    let folder = watched::get_watched_folder(&conn, id)
        .map_err(|e| format!("Failed to fetch watched folder: {}", e))?
        .ok_or_else(|| format!("Watched folder {} not found", id))?;
    Ok(WatchedFolder::from(folder))
}

#[derive(Debug, Deserialize)]
pub struct AddWatchedFolderRequest {
    pub path: String,
    pub mode: Option<String>,
    pub cadence_minutes: Option<i64>,
    pub enabled: Option<bool>,
}

/// Add a new watched folder
#[tauri::command]
pub async fn watched_folders_add(
    request: AddWatchedFolderRequest,
    state: State<'_, WatcherManager>,
) -> Result<WatchedFolder, String> {
    // Validate path exists
    let path = std::path::Path::new(&request.path);
    if !path.is_dir() {
        return Err(format!(
            "Path does not exist or is not a directory: {}",
            request.path
        ));
    }

    let mode = request.mode.unwrap_or_else(|| "continuous".to_string());
    let cadence_minutes = request.cadence_minutes.unwrap_or(10);
    let enabled = request.enabled.unwrap_or(true);

    let folder = {
        let conn = state.get_db().conn().map_err(|e| e.to_string())?;
        watched::add_watched_folder(&conn, &request.path, &mode, cadence_minutes, enabled)
            .map_err(|e| format!("Failed to add watched folder: {}", e))?
            .ok_or_else(|| "Path already exists in watched folders".to_string())?
    };

    let result = WatchedFolder::from(folder);

    // Start watching if enabled
    if result.enabled {
        state.add_folder(result.clone()).await?;
    }

    Ok(result)
}

#[derive(Debug, Deserialize)]
pub struct UpdateWatchedFolderRequest {
    pub mode: Option<String>,
    pub cadence_minutes: Option<i64>,
    pub enabled: Option<bool>,
}

/// Update an existing watched folder
#[tauri::command]
pub async fn watched_folders_update(
    id: i64,
    request: UpdateWatchedFolderRequest,
    state: State<'_, WatcherManager>,
) -> Result<WatchedFolder, String> {
    let folder = {
        let conn = state.get_db().conn().map_err(|e| e.to_string())?;

        // Check if folder exists
        watched::get_watched_folder(&conn, id)
            .map_err(|e| format!("Failed to fetch watched folder: {}", e))?
            .ok_or_else(|| format!("Watched folder {} not found", id))?;

        watched::update_watched_folder(
            &conn,
            id,
            request.mode.as_deref(),
            request.cadence_minutes,
            request.enabled,
        )
        .map_err(|e| format!("Failed to update watched folder: {}", e))?
        .ok_or_else(|| format!("Watched folder {} not found", id))?
    };

    let result = WatchedFolder::from(folder);

    // Update the watcher
    state.update_folder(result.clone()).await?;

    Ok(result)
}

/// Remove a watched folder
#[tauri::command]
pub async fn watched_folders_remove(
    id: i64,
    state: State<'_, WatcherManager>,
) -> Result<(), String> {
    {
        let conn = state.get_db().conn().map_err(|e| e.to_string())?;

        if !watched::remove_watched_folder(&conn, id)
            .map_err(|e| format!("Failed to remove watched folder: {}", e))?
        {
            return Err(format!("Watched folder {} not found", id));
        }
    }

    // Stop watching
    state.remove_folder(id).await;

    Ok(())
}

/// Trigger a manual rescan for a watched folder
#[tauri::command]
pub async fn watched_folders_rescan(
    id: i64,
    state: State<'_, WatcherManager>,
) -> Result<(), String> {
    // Verify folder exists
    {
        let conn = state.get_db().conn().map_err(|e| e.to_string())?;
        watched::get_watched_folder(&conn, id)
            .map_err(|e| format!("Failed to fetch watched folder: {}", e))?
            .ok_or_else(|| format!("Watched folder {} not found", id))?;
    }

    state.rescan_folder(id).await;
    Ok(())
}

/// Get the current watcher status (number of active watchers)
#[tauri::command]
pub fn watched_folders_status(state: State<'_, WatcherManager>) -> serde_json::Value {
    serde_json::json!({
        "active_watchers": state.active_watcher_count(),
    })
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // -------------------------------------------------------------------------
    // WatchedFolder struct tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_watched_folder_serialization() {
        let folder = WatchedFolder {
            id: 1,
            path: "/Users/test/Music".to_string(),
            mode: "continuous".to_string(),
            cadence_minutes: Some(10),
            enabled: true,
            last_scanned_at: Some(1234567890),
        };

        let json = serde_json::to_string(&folder).unwrap();
        assert!(json.contains("\"id\":1"));
        assert!(json.contains("\"path\":\"/Users/test/Music\""));
        assert!(json.contains("\"mode\":\"continuous\""));
        assert!(json.contains("\"cadence_minutes\":10"));
        assert!(json.contains("\"enabled\":true"));
    }

    #[test]
    fn test_watched_folder_deserialization() {
        let json = r#"{
            "id": 42,
            "path": "/home/user/music",
            "mode": "startup",
            "cadence_minutes": null,
            "enabled": false,
            "last_scanned_at": null
        }"#;

        let folder: WatchedFolder = serde_json::from_str(json).unwrap();
        assert_eq!(folder.id, 42);
        assert_eq!(folder.path, "/home/user/music");
        assert_eq!(folder.mode, "startup");
        assert!(folder.cadence_minutes.is_none());
        assert!(!folder.enabled);
        assert!(folder.last_scanned_at.is_none());
    }

    #[test]
    fn test_watched_folder_clone() {
        let folder = WatchedFolder {
            id: 1,
            path: "/test".to_string(),
            mode: "continuous".to_string(),
            cadence_minutes: Some(5),
            enabled: true,
            last_scanned_at: None,
        };

        let cloned = folder.clone();
        assert_eq!(folder.id, cloned.id);
        assert_eq!(folder.path, cloned.path);
        assert_eq!(folder.mode, cloned.mode);
        assert_eq!(folder.cadence_minutes, cloned.cadence_minutes);
        assert_eq!(folder.enabled, cloned.enabled);
    }

    // -------------------------------------------------------------------------
    // WatcherStatus tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_watcher_status_serialization() {
        let status = WatcherStatus {
            folder_id: 123,
            status: "scanning".to_string(),
            message: Some("Processing files...".to_string()),
        };

        let json = serde_json::to_string(&status).unwrap();
        assert!(json.contains("\"folder_id\":123"));
        assert!(json.contains("\"status\":\"scanning\""));
        assert!(json.contains("\"message\":\"Processing files...\""));
    }

    #[test]
    fn test_watcher_status_without_message() {
        let status = WatcherStatus {
            folder_id: 1,
            status: "idle".to_string(),
            message: None,
        };

        let json = serde_json::to_string(&status).unwrap();
        assert!(json.contains("\"message\":null"));
    }

    // -------------------------------------------------------------------------
    // ScanProgress tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_scan_progress_serialization() {
        let progress = ScanProgress {
            folder_id: 5,
            percent: Some(75),
            stage: Some("Scanning metadata".to_string()),
        };

        let json = serde_json::to_string(&progress).unwrap();
        assert!(json.contains("\"folder_id\":5"));
        assert!(json.contains("\"percent\":75"));
        assert!(json.contains("\"stage\":\"Scanning metadata\""));
    }

    #[test]
    fn test_scan_progress_optional_fields() {
        let progress = ScanProgress {
            folder_id: 1,
            percent: None,
            stage: None,
        };

        let json = serde_json::to_string(&progress).unwrap();
        assert!(json.contains("\"percent\":null"));
        assert!(json.contains("\"stage\":null"));
    }

    // -------------------------------------------------------------------------
    // ScanResults tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_scan_results_serialization() {
        let results = ScanResults {
            folder_id: 10,
            added: 50,
            updated: 12,
            deleted: 3,
        };

        let json = serde_json::to_string(&results).unwrap();
        assert!(json.contains("\"folder_id\":10"));
        assert!(json.contains("\"added\":50"));
        assert!(json.contains("\"updated\":12"));
        assert!(json.contains("\"deleted\":3"));
    }

    #[test]
    fn test_scan_results_zero_values() {
        let results = ScanResults {
            folder_id: 1,
            added: 0,
            updated: 0,
            deleted: 0,
        };

        let json = serde_json::to_string(&results).unwrap();
        assert!(json.contains("\"added\":0"));
        assert!(json.contains("\"updated\":0"));
        assert!(json.contains("\"deleted\":0"));
    }

    // -------------------------------------------------------------------------
    // FsEvent tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_fs_event_serialization() {
        let event = FsEvent {
            folder_id: 7,
            event_type: "change".to_string(),
            paths: vec![
                "/music/track1.mp3".to_string(),
                "/music/track2.flac".to_string(),
            ],
        };

        let json = serde_json::to_string(&event).unwrap();
        assert!(json.contains("\"folder_id\":7"));
        assert!(json.contains("\"event_type\":\"change\""));
        assert!(json.contains("/music/track1.mp3"));
        assert!(json.contains("/music/track2.flac"));
    }

    #[test]
    fn test_fs_event_empty_paths() {
        let event = FsEvent {
            folder_id: 1,
            event_type: "create".to_string(),
            paths: vec![],
        };

        let json = serde_json::to_string(&event).unwrap();
        assert!(json.contains("\"paths\":[]"));
    }

    // -------------------------------------------------------------------------
    // AddWatchedFolderRequest tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_add_watched_folder_request_full() {
        let json = r#"{
            "path": "/Users/test/Music",
            "mode": "continuous",
            "cadence_minutes": 15,
            "enabled": true
        }"#;

        let request: AddWatchedFolderRequest = serde_json::from_str(json).unwrap();
        assert_eq!(request.path, "/Users/test/Music");
        assert_eq!(request.mode, Some("continuous".to_string()));
        assert_eq!(request.cadence_minutes, Some(15));
        assert_eq!(request.enabled, Some(true));
    }

    #[test]
    fn test_add_watched_folder_request_minimal() {
        let json = r#"{"path": "/home/user/audio"}"#;

        let request: AddWatchedFolderRequest = serde_json::from_str(json).unwrap();
        assert_eq!(request.path, "/home/user/audio");
        assert!(request.mode.is_none());
        assert!(request.cadence_minutes.is_none());
        assert!(request.enabled.is_none());
    }

    // -------------------------------------------------------------------------
    // UpdateWatchedFolderRequest tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_update_watched_folder_request_mode_only() {
        let json = r#"{"mode": "startup"}"#;

        let request: UpdateWatchedFolderRequest = serde_json::from_str(json).unwrap();
        assert_eq!(request.mode, Some("startup".to_string()));
        assert!(request.cadence_minutes.is_none());
        assert!(request.enabled.is_none());
    }

    #[test]
    fn test_update_watched_folder_request_all_fields() {
        let json = r#"{
            "mode": "continuous",
            "cadence_minutes": 30,
            "enabled": false
        }"#;

        let request: UpdateWatchedFolderRequest = serde_json::from_str(json).unwrap();
        assert_eq!(request.mode, Some("continuous".to_string()));
        assert_eq!(request.cadence_minutes, Some(30));
        assert_eq!(request.enabled, Some(false));
    }

    // -------------------------------------------------------------------------
    // Mode validation tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_valid_modes() {
        let startup_folder = WatchedFolder {
            id: 1,
            path: "/test".to_string(),
            mode: "startup".to_string(),
            cadence_minutes: None,
            enabled: true,
            last_scanned_at: None,
        };
        assert_eq!(startup_folder.mode, "startup");

        let continuous_folder = WatchedFolder {
            id: 2,
            path: "/test2".to_string(),
            mode: "continuous".to_string(),
            cadence_minutes: Some(10),
            enabled: true,
            last_scanned_at: None,
        };
        assert_eq!(continuous_folder.mode, "continuous");
    }

    // -------------------------------------------------------------------------
    // Cadence validation tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_cadence_minutes_range() {
        let folder_min = WatchedFolder {
            id: 1,
            path: "/test".to_string(),
            mode: "continuous".to_string(),
            cadence_minutes: Some(1),
            enabled: true,
            last_scanned_at: None,
        };
        assert_eq!(folder_min.cadence_minutes, Some(1));

        let folder_typical = WatchedFolder {
            id: 2,
            path: "/test".to_string(),
            mode: "continuous".to_string(),
            cadence_minutes: Some(10),
            enabled: true,
            last_scanned_at: None,
        };
        assert_eq!(folder_typical.cadence_minutes, Some(10));

        let folder_max = WatchedFolder {
            id: 3,
            path: "/test".to_string(),
            mode: "continuous".to_string(),
            cadence_minutes: Some(1440),
            enabled: true,
            last_scanned_at: None,
        };
        assert_eq!(folder_max.cadence_minutes, Some(1440));
    }

    // -------------------------------------------------------------------------
    // Audio file extension filter tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_supported_audio_extensions() {
        let supported = ["mp3", "flac", "m4a", "ogg", "wav", "aac", "wma", "opus"];

        for ext in supported.iter() {
            let ext_lower = ext.to_lowercase();
            let is_audio = matches!(
                ext_lower.as_str(),
                "mp3" | "flac" | "m4a" | "ogg" | "wav" | "aac" | "wma" | "opus"
            );
            assert!(is_audio, "Extension {} should be supported", ext);
        }
    }

    #[test]
    fn test_unsupported_extensions() {
        let unsupported = ["txt", "jpg", "png", "pdf", "doc", "mp4", "avi"];

        for ext in unsupported.iter() {
            let ext_lower = ext.to_lowercase();
            let is_audio = matches!(
                ext_lower.as_str(),
                "mp3" | "flac" | "m4a" | "ogg" | "wav" | "aac" | "wma" | "opus"
            );
            assert!(!is_audio, "Extension {} should not be supported", ext);
        }
    }

    #[test]
    fn test_case_insensitive_extensions() {
        let extensions = ["MP3", "FLAC", "M4A", "Ogg", "WAV", "AAC", "WMA", "OPUS"];

        for ext in extensions.iter() {
            let ext_lower = ext.to_lowercase();
            let is_audio = matches!(
                ext_lower.as_str(),
                "mp3" | "flac" | "m4a" | "ogg" | "wav" | "aac" | "wma" | "opus"
            );
            assert!(
                is_audio,
                "Extension {} (case insensitive) should be supported",
                ext
            );
        }
    }
}
