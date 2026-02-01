pub mod audio;
pub mod commands;
pub mod db;
pub mod dialog;
pub mod events;
pub mod lastfm;
pub mod library;
pub mod media_keys;
pub mod metadata;
pub mod scanner;
pub mod watcher;

// Re-export FFI from mt-core for backward compatibility
pub use mt_core::ffi;

#[cfg(test)]
mod concurrency_test;

use commands::{
    audio_get_status, audio_get_volume, audio_load, audio_pause, audio_play, audio_seek,
    audio_set_volume, audio_stop, favorites_add, favorites_check, favorites_get,
    favorites_get_recently_added, favorites_get_recently_played, favorites_get_top25,
    favorites_remove, lastfm_auth_callback, lastfm_disconnect, lastfm_get_auth_url,
    lastfm_get_settings, lastfm_import_loved_tracks, lastfm_now_playing, lastfm_queue_retry,
    lastfm_queue_status, lastfm_scrobble, lastfm_update_settings, playlist_add_tracks,
    playlist_create, playlist_delete, playlist_generate_name, playlist_get, playlist_list,
    playlist_remove_track, playlist_reorder_tracks, playlist_update, playlists_reorder,
    queue_add, queue_add_files, queue_clear, queue_get, queue_get_playback_state, queue_remove,
    queue_reorder, queue_set_current_index, queue_set_loop, queue_set_shuffle, queue_shuffle,
    settings_get, settings_get_all, settings_reset, settings_set, settings_update, AudioState,
};
use dialog::{open_add_music_dialog, open_file_dialog, open_folder_dialog};
use media_keys::{MediaKeyManager, NowPlayingInfo};
use metadata::{get_track_metadata, save_track_metadata};
use scanner::commands::{
    extract_file_metadata, get_track_artwork, get_track_artwork_url, scan_paths_metadata,
    scan_paths_to_library,
};
use library::commands::{
    library_check_status, library_delete_track, library_get_all, library_get_artwork,
    library_get_artwork_url, library_get_missing, library_get_stats, library_get_track,
    library_locate_track, library_mark_missing, library_mark_present, library_reconcile_scan,
    library_rescan_track, library_update_play_count,
};
use watcher::{
    watched_folders_add, watched_folders_get, watched_folders_list, watched_folders_remove,
    watched_folders_rescan, watched_folders_status, watched_folders_update, WatcherManager,
};
use serde::Serialize;
use std::time::Duration;
use tokio::io::AsyncWriteExt;
use tauri::{Emitter, Manager, State};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};

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

#[tauri::command]
fn media_set_playing(progress_ms: Option<u64>, state: State<MediaKeyManager>) -> Result<(), String> {
    state.set_playing(progress_ms.map(Duration::from_millis))
}

#[tauri::command]
fn media_set_paused(progress_ms: Option<u64>, state: State<MediaKeyManager>) -> Result<(), String> {
    state.set_paused(progress_ms.map(Duration::from_millis))
}

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

#[tauri::command]
fn app_get_info() -> AppInfo {
    let version = env!("CARGO_PKG_VERSION").to_string();
    let build = option_env!("MT_BUILD_ID")
        .unwrap_or("dev")
        .to_string();
    let platform = format!(
        "{} {}",
        std::env::consts::OS,
        std::env::consts::ARCH
    );
    
    AppInfo {
        version,
        build,
        platform,
    }
}

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
    content.push_str(&format!("Rust version: {}\n", env!("CARGO_PKG_RUST_VERSION")));

    if let Ok(cwd) = std::env::current_dir() {
        content.push_str(&format!("Working directory: {}\n", cwd.display()));
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

    app.handle().plugin(
        tauri_plugin_global_shortcut::Builder::new()
            .with_handler(move |_app, shortcut, event| {
                if event.state() != tauri_plugin_global_shortcut::ShortcutState::Pressed {
                    return;
                }
                
                let event_name = if shortcut == &play_pause {
                    println!("Media key: Play/Pause");
                    Some("mediakey://toggle")
                } else if shortcut == &next_track {
                    println!("Media key: Next");
                    Some("mediakey://next")
                } else if shortcut == &prev_track {
                    println!("Media key: Previous");
                    Some("mediakey://previous")
                } else if shortcut == &stop {
                    println!("Media key: Stop");
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
        eprintln!("Failed to register MediaPlayPause: {}", e);
    }
    if let Err(e) = global_shortcut.register(next_track) {
        eprintln!("Failed to register MediaTrackNext: {}", e);
    }
    if let Err(e) = global_shortcut.register(prev_track) {
        eprintln!("Failed to register MediaTrackPrevious: {}", e);
    }
    if let Err(e) = global_shortcut.register(stop) {
        eprintln!("Failed to register MediaStop: {}", e);
    }

    println!("Global media shortcuts registered");
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
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
            get_track_metadata,
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
            library_delete_track,
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
            println!("Database initialized at: {}", db_path.display());

            // Initialize artwork cache (Zig FFI-backed LRU cache)
            let artwork_cache = scanner::artwork_cache::ArtworkCache::new()
                .expect("Failed to initialize artwork cache");
            app.manage(artwork_cache);
            println!("Artwork cache initialized (Zig LRU cache, size: 100)");

            // Pass database clone to watcher manager
            let watcher = WatcherManager::new(app.handle().clone(), database_for_watcher);
            app.manage(watcher);
            println!("Watcher manager initialized (using native Rust)");

            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(Duration::from_secs(2)).await;
                if let Some(watcher) = app_handle.try_state::<WatcherManager>() {
                    if let Err(e) = watcher.start().await {
                        eprintln!("Failed to start watched folder watchers: {}", e);
                    } else {
                        println!("Watched folder watchers started ({} active)", watcher.active_watcher_count());
                    }
                }
            });

            app.manage(AudioState::new(app.handle().clone()));
            println!("Audio engine initialized");

            match MediaKeyManager::new(app.handle().clone()) {
                Ok(media_keys) => {
                    app.manage(media_keys);
                    println!("Media keys (Now Playing) initialized");
                }
                Err(e) => {
                    eprintln!("Failed to initialize media keys: {}", e);
                }
            }

            if let Err(e) = setup_global_shortcuts(app) {
                eprintln!("Failed to setup global shortcuts: {}", e);
            }

            #[cfg(feature = "mcp")]
            {
                app.handle().plugin(tauri_plugin_mcp_bridge::init())?;
                println!("MCP bridge initialized (WebSocket port 9223)");
            }

            // Start Last.fm scrobble retry background task
            let app_handle_lastfm = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                use std::time::Duration;

                // Wait 30 seconds before starting background retries
                tokio::time::sleep(Duration::from_secs(30)).await;
                println!("Last.fm scrobble retry task started (5-minute interval)");

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
                                    println!("[lastfm] Background retry: {}", response.status);
                                }
                                Err(e) => {
                                    eprintln!("[lastfm] Background retry failed: {}", e);
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
