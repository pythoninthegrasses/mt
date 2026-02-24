pub mod audio;
pub(crate) mod commands;
pub(crate) mod db;
pub(crate) mod dialog;
pub(crate) mod events;
pub(crate) mod lastfm;
pub(crate) mod library;
pub(crate) mod logging;
pub(crate) mod media_keys;
pub(crate) mod metadata;
pub(crate) mod scanner;
pub(crate) mod watcher;

#[cfg(test)]
mod concurrency_test;

use commands::{
    AudioState, audio_get_status, audio_get_volume, audio_load, audio_load_and_play, audio_pause,
    audio_play, audio_seek, audio_set_volume, audio_stop, favorites_add, favorites_check,
    favorites_get, favorites_get_recently_added, favorites_get_recently_played,
    favorites_get_top25, favorites_remove, lastfm_auth_callback, lastfm_cache_loved_tracks,
    lastfm_disconnect, lastfm_get_auth_url, lastfm_get_settings, lastfm_import_loved_tracks,
    lastfm_loved_stats, lastfm_match_loved_tracks, lastfm_now_playing, lastfm_queue_retry,
    lastfm_queue_status, lastfm_reset_loved_cache, lastfm_scrobble, lastfm_update_settings,
    match_loved_tracks_impl, playlist_add_tracks, playlist_create, playlist_delete,
    playlist_generate_name, playlist_get, playlist_list, playlist_remove_track,
    playlist_reorder_tracks, playlist_update, playlists_reorder, queue_add, queue_add_files,
    queue_clear, queue_get, queue_get_playback_state, queue_remove, queue_reorder,
    queue_set_current_index, queue_set_loop, queue_set_shuffle, queue_shuffle, settings_get,
    settings_get_all, settings_reset, settings_set, settings_update,
};
use dialog::{open_add_music_dialog, open_file_dialog, open_folder_dialog};
use library::commands::{
    library_check_status, library_delete_all, library_delete_track, library_delete_tracks,
    library_get_all, library_get_artwork, library_get_artwork_url, library_get_missing,
    library_get_stats, library_get_track, library_locate_track, library_mark_missing,
    library_mark_present, library_purge_missing, library_reconcile_scan, library_rescan_track,
    library_update_play_count,
};
use media_keys::{MediaKeyManager, NowPlayingInfo};
use metadata::{get_track_metadata, get_tracks_metadata_batch, save_track_metadata};
use scanner::commands::{
    extract_file_metadata, get_track_artwork, get_track_artwork_url, scan_paths_metadata,
    scan_paths_to_library,
};
use serde::Serialize;
use std::time::Duration;
use tauri::{Emitter, Manager, State};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};
use tokio::io::AsyncWriteExt;
use tracing::{debug, error, info, warn};
use watcher::{
    WatcherManager, watched_folders_add, watched_folders_get, watched_folders_list,
    watched_folders_remove, watched_folders_rescan, watched_folders_status, watched_folders_update,
};

#[tracing::instrument(skip(state))]
#[tauri::command]
fn media_set_metadata(
    title: Option<String>,
    artist: Option<String>,
    album: Option<String>,
    duration_ms: Option<u64>,
    cover_url: Option<String>,
    state: State<MediaKeyManager>,
) -> Result<(), String> {
    state.set_metadata(NowPlayingInfo {
        title,
        artist,
        album,
        duration: duration_ms.map(Duration::from_millis),
        cover_url,
    })
}

#[tracing::instrument(skip(state))]
#[tauri::command]
fn media_set_playing(
    progress_ms: Option<u64>,
    state: State<MediaKeyManager>,
) -> Result<(), String> {
    state.set_playing(progress_ms.map(Duration::from_millis))
}

#[tracing::instrument(skip(state))]
#[tauri::command]
fn media_set_paused(progress_ms: Option<u64>, state: State<MediaKeyManager>) -> Result<(), String> {
    state.set_paused(progress_ms.map(Duration::from_millis))
}

#[tracing::instrument(skip(state))]
#[tauri::command]
fn media_set_stopped(state: State<MediaKeyManager>) -> Result<(), String> {
    state.set_stopped()
}

#[derive(Serialize)]
struct AppInfo {
    version: String,
    build: String,
    platform: String,
}

/// Route a frontend log message into the tracing subscriber.
#[tracing::instrument(level = "debug")]
#[tauri::command]
fn log_frontend_error(level: String, message: String, context: Option<String>) {
    match level.as_str() {
        "error" => tracing::error!(target: "mt::frontend", ?context, "{}", message),
        "warn" => tracing::warn!(target: "mt::frontend", ?context, "{}", message),
        "info" => tracing::info!(target: "mt::frontend", ?context, "{}", message),
        _ => tracing::debug!(target: "mt::frontend", ?context, "{}", message),
    }
}

#[tracing::instrument]
#[tauri::command]
fn app_get_info() -> AppInfo {
    let version = env!("CARGO_PKG_VERSION").to_string();
    let build = option_env!("MT_BUILD_ID").unwrap_or("dev").to_string();
    let platform = format!("{} {}", std::env::consts::OS, std::env::consts::ARCH);

    AppInfo {
        version,
        build,
        platform,
    }
}

#[tracing::instrument]
#[tauri::command]
async fn export_diagnostics(path: String) -> Result<(), String> {
    let mut content = String::new();

    content.push_str("=== mt Diagnostics ===\n\n");

    let info = app_get_info();
    content.push_str(&format!("Version: {}\n", info.version));
    content.push_str(&format!("Build: {}\n", info.build));
    content.push_str(&format!("Platform: {}\n", info.platform));
    content.push_str(&format!("Timestamp: {}\n", chrono::Utc::now().to_rfc3339()));

    content.push_str("\n=== Environment ===\n\n");
    content.push_str(&format!(
        "Rust version: {}\n",
        env!("CARGO_PKG_RUST_VERSION")
    ));

    if let Ok(cwd) = std::env::current_dir() {
        content.push_str(&format!("Working directory: {}\n", cwd.display()));
    }

    // Append runtime logs from the log directory
    if let Some(log_dir) = logging::log_dir_path() {
        content.push_str(&format!("\nLog directory: {}\n", log_dir.display()));
        content.push_str("\n=== Runtime Logs ===\n\n");

        // Collect and sort log files by name (newest first via reverse sort)
        let mut log_files: Vec<_> = std::fs::read_dir(log_dir)
            .ok()
            .into_iter()
            .flatten()
            .flatten()
            .filter(|e| e.file_name().to_string_lossy().starts_with("mt.log"))
            .collect();
        log_files.sort_by_key(|e| std::cmp::Reverse(e.file_name()));

        // Include up to 3 most recent files, capped at 5 MB total
        const MAX_BYTES: usize = 5 * 1024 * 1024;
        let mut total_bytes = 0;
        for entry in log_files.iter().take(3) {
            let remaining = MAX_BYTES.saturating_sub(total_bytes);
            if remaining == 0 {
                break;
            }
            let file_content = match std::fs::read_to_string(entry.path()) {
                Ok(c) => c,
                Err(_) => continue,
            };
            let truncated = if file_content.len() > remaining {
                &file_content[..remaining]
            } else {
                &file_content
            };
            content.push_str(&format!(
                "--- {} ---\n",
                entry.file_name().to_string_lossy()
            ));
            content.push_str(truncated);
            content.push('\n');
            total_bytes += truncated.len();
        }
    }

    let mut file = tokio::fs::File::create(&path)
        .await
        .map_err(|e| format!("Failed to create file: {}", e))?;
    file.write_all(content.as_bytes())
        .await
        .map_err(|e| format!("Failed to write file: {}", e))?;

    Ok(())
}

fn setup_global_shortcuts(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let app_handle = app.handle().clone();

    let play_pause = Shortcut::new(Some(Modifiers::empty()), Code::MediaPlayPause);
    let next_track = Shortcut::new(Some(Modifiers::empty()), Code::MediaTrackNext);
    let prev_track = Shortcut::new(Some(Modifiers::empty()), Code::MediaTrackPrevious);
    let stop = Shortcut::new(Some(Modifiers::empty()), Code::MediaStop);
    // macOS keyboard F7/F9 send NX_KEYTYPE_REWIND (20) / NX_KEYTYPE_FAST (19),
    // not NX_KEYTYPE_PREVIOUS (18) / NX_KEYTYPE_NEXT (17).
    // The latter come from AirPods/Bluetooth headphone buttons.
    // Register both to handle keyboard and headphone controls.
    let fast_forward = Shortcut::new(Some(Modifiers::empty()), Code::MediaFastForward);
    let rewind = Shortcut::new(Some(Modifiers::empty()), Code::MediaRewind);

    app.handle().plugin(
        tauri_plugin_global_shortcut::Builder::new()
            .with_handler(move |_app, shortcut, event| {
                if event.state() != tauri_plugin_global_shortcut::ShortcutState::Pressed {
                    return;
                }

                let event_name = if shortcut == &play_pause {
                    debug!("Global shortcut: MediaPlayPause");
                    Some("mediakey://toggle")
                } else if shortcut == &next_track || shortcut == &fast_forward {
                    debug!("Global shortcut: MediaTrackNext/FastForward");
                    Some("mediakey://next")
                } else if shortcut == &prev_track || shortcut == &rewind {
                    debug!("Global shortcut: MediaTrackPrevious/Rewind");
                    Some("mediakey://previous")
                } else if shortcut == &stop {
                    debug!("Global shortcut: MediaStop");
                    Some("mediakey://stop")
                } else {
                    None
                };

                if let Some(name) = event_name {
                    let _ = app_handle.emit(name, ());
                }
            })
            .build(),
    )?;

    let global_shortcut = app.global_shortcut();

    if let Err(e) = global_shortcut.register(play_pause) {
        warn!(error = %e, "Failed to register MediaPlayPause shortcut");
    }
    if let Err(e) = global_shortcut.register(next_track) {
        warn!(error = %e, "Failed to register MediaTrackNext shortcut");
    }
    if let Err(e) = global_shortcut.register(prev_track) {
        warn!(error = %e, "Failed to register MediaTrackPrevious shortcut");
    }
    if let Err(e) = global_shortcut.register(fast_forward) {
        warn!(error = %e, "Failed to register MediaFastForward shortcut");
    }
    if let Err(e) = global_shortcut.register(rewind) {
        warn!(error = %e, "Failed to register MediaRewind shortcut");
    }
    if let Err(e) = global_shortcut.register(stop) {
        warn!(error = %e, "Failed to register MediaStop shortcut");
    }

    info!("Global media shortcuts registered");
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Initialize structured logging before anything else.
    // The WorkerGuard must live until run() returns to flush file output.
    let log_dir = logging::compute_log_dir("com.mt.desktop");
    let _log_guard = logging::init_tracing(&log_dir);
    tracing::info!(log_dir = %log_dir.display(), "Tracing initialized");

    // Reduce glibc malloc arena bloat in multi-process WebKitGTK.
    // Each arena reserves ~64 MB virtual; WebKit spawns many threads.
    // MALLOC_ARENA_MAX=2 limits per-process arenas.
    // MALLOC_TRIM_THRESHOLD_=131072 returns freed memory to OS sooner.
    // These env vars are inherited by WebKit child processes.
    #[cfg(target_os = "linux")]
    {
        // SAFETY: called before any threads are spawned
        unsafe {
            std::env::set_var("MALLOC_ARENA_MAX", "2");
            std::env::set_var("MALLOC_TRIM_THRESHOLD_", "131072");
        }
    }

    // Limit rayon thread pool: default creates 1 thread per core with 8 MB stacks.
    // Music scanning only needs a few parallel workers; cap at 4 threads with 2 MB stacks.
    let available_cpus = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4);
    let num_threads = available_cpus.clamp(2, 4);
    rayon::ThreadPoolBuilder::new()
        .num_threads(num_threads)
        .stack_size(2 * 1024 * 1024)
        .build_global()
        .ok();

    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default();

    #[cfg(feature = "devtools")]
    {
        builder = builder.plugin(tauri_plugin_devtools::init());
    }

    builder
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            audio_load,
            audio_load_and_play,
            audio_play,
            audio_pause,
            audio_stop,
            audio_seek,
            audio_set_volume,
            audio_get_volume,
            audio_get_status,
            open_file_dialog,
            open_folder_dialog,
            open_add_music_dialog,
            media_set_metadata,
            media_set_playing,
            media_set_paused,
            media_set_stopped,
            app_get_info,
            export_diagnostics,
            log_frontend_error,
            get_track_metadata,
            get_tracks_metadata_batch,
            save_track_metadata,
            watched_folders_list,
            watched_folders_get,
            watched_folders_add,
            watched_folders_update,
            watched_folders_remove,
            watched_folders_rescan,
            watched_folders_status,
            scan_paths_to_library,
            scan_paths_metadata,
            extract_file_metadata,
            get_track_artwork,
            get_track_artwork_url,
            library_get_all,
            library_get_stats,
            library_get_track,
            library_get_artwork,
            library_get_artwork_url,
            library_delete_all,
            library_delete_track,
            library_delete_tracks,
            library_purge_missing,
            library_rescan_track,
            library_update_play_count,
            library_get_missing,
            library_locate_track,
            library_check_status,
            library_mark_missing,
            library_mark_present,
            library_reconcile_scan,
            queue_get,
            queue_add,
            queue_add_files,
            queue_remove,
            queue_clear,
            queue_reorder,
            queue_shuffle,
            queue_get_playback_state,
            queue_set_current_index,
            queue_set_shuffle,
            queue_set_loop,
            playlist_list,
            playlist_create,
            playlist_get,
            playlist_update,
            playlist_delete,
            playlist_add_tracks,
            playlist_remove_track,
            playlist_reorder_tracks,
            playlists_reorder,
            playlist_generate_name,
            favorites_get,
            favorites_check,
            favorites_add,
            favorites_remove,
            favorites_get_top25,
            favorites_get_recently_played,
            favorites_get_recently_added,
            lastfm_get_settings,
            lastfm_update_settings,
            lastfm_get_auth_url,
            lastfm_auth_callback,
            lastfm_disconnect,
            lastfm_now_playing,
            lastfm_scrobble,
            lastfm_queue_status,
            lastfm_queue_retry,
            lastfm_import_loved_tracks,
            lastfm_cache_loved_tracks,
            lastfm_match_loved_tracks,
            lastfm_loved_stats,
            lastfm_reset_loved_cache,
            settings_get_all,
            settings_get,
            settings_set,
            settings_update,
            settings_reset,
        ])
        .setup(|app| {
            // Initialize database
            let db_path = app.path().app_data_dir()
                .expect("Failed to get app data directory")
                .join("mt.db");

            // Ensure parent directory exists
            if let Some(parent) = db_path.parent() {
                std::fs::create_dir_all(parent).ok();
            }

            let database = db::Database::new(&db_path)
                .expect("Failed to initialize database");
            let database_for_watcher = database.clone();
            app.manage(database);
            info!(path = %db_path.display(), "Database initialized");

            // Initialize artwork cache (Rust LRU cache)
            let artwork_cache = scanner::artwork_cache::ArtworkCache::with_capacity(50);
            app.manage(artwork_cache);
            debug!("Artwork cache initialized (LRU, capacity: 50)");

            // Pass database clone to watcher manager
            let watcher = WatcherManager::new(app.handle().clone(), database_for_watcher);
            app.manage(watcher);
            debug!("Watcher manager initialized");

            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(Duration::from_secs(2)).await;
                if let Some(watcher) = app_handle.try_state::<WatcherManager>() {
                    if let Err(e) = watcher.start().await {
                        error!(error = %e, "Failed to start watched folder watchers");
                    } else {
                        info!(active = watcher.active_watcher_count(), "Watched folder watchers started");
                    }
                }
            });

            app.manage(AudioState::new(app.handle().clone()));
            info!("Audio engine initialized");

            match MediaKeyManager::new(app.handle().clone()) {
                Ok(media_keys) => {
                    app.manage(media_keys);
                    info!("Media keys (Now Playing) initialized");
                }
                Err(e) => {
                    warn!(error = %e, "Failed to initialize media keys");
                }
            }

            if let Err(e) = setup_global_shortcuts(app) {
                warn!(error = %e, "Failed to setup global media shortcuts");
            }

            #[cfg(feature = "mcp")]
            {
                app.handle().plugin(tauri_plugin_mcp_bridge::init())?;
                info!("MCP bridge initialized (WebSocket port 9223)");
            }

            // Start Last.fm scrobble retry background task
            let app_handle_lastfm = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                use std::time::Duration;

                // Wait 30 seconds before starting background retries
                tokio::time::sleep(Duration::from_secs(30)).await;
                info!("Last.fm scrobble retry task started (5-minute interval)");

                loop {
                    // Wait 5 minutes between retry attempts
                    tokio::time::sleep(Duration::from_secs(300)).await;

                    // Attempt to retry queued scrobbles
                    if let Some(db) = app_handle_lastfm.try_state::<db::Database>() {
                        // Check if there are any queued scrobbles
                        let has_queued = db
                            .with_conn(|conn| {
                                db::scrobble::get_queued_scrobbles(conn, 1).map(|q| !q.is_empty())
                            })
                            .unwrap_or(false);

                        if has_queued {
                            // Trigger retry
                            match lastfm_queue_retry(app_handle_lastfm.clone(), db.clone()).await {
                                Ok(response) => {
                                    debug!(status = %response.status, "Background scrobble retry");
                                }
                                Err(e) => {
                                    warn!(error = %e, "Background scrobble retry failed");
                                }
                            }
                        }
                    }
                }
            });

            // Start Last.fm loved tracks matching background task
            let app_handle_loved = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                use std::time::Duration;

                // Wait 60 seconds before starting background matching
                tokio::time::sleep(Duration::from_secs(60)).await;
                info!("Last.fm loved tracks matcher started (30-minute interval)");

                loop {
                    // Wait 30 minutes between match attempts
                    tokio::time::sleep(Duration::from_secs(1800)).await;

                    // Check for unmatched loved tracks and try to match them
                    if let Some(db) = app_handle_loved.try_state::<db::Database>() {
                        let has_unmatched = db
                            .with_conn(|conn| {
                                db::lastfm_loved::get_unmatched_loved_tracks(conn, Some(1))
                                    .map(|tracks| !tracks.is_empty())
                            })
                            .unwrap_or(false);

                        if has_unmatched {
                            let db_clone = db.inner().clone();
                            match tokio::spawn(async move {
                                match_loved_tracks_impl(&db_clone).await
                            })
                            .await
                            {
                                Ok(Ok(response)) => {
                                    if response.new_favorites > 0 {
                                        info!(
                                            new_favorites = response.new_favorites,
                                            "Background loved track match"
                                        );
                                    }
                                }
                                Ok(Err(e)) => {
                                    warn!(error = %e, "Background loved track match failed");
                                }
                                Err(e) => {
                                    error!(error = %e, "Background loved track match task panicked");
                                }
                            }
                        }
                    }
                }
            });

            Ok(())
        })
        .on_window_event(|_window, _event| {
            // Window event handler (sidecar removed in migration)
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
