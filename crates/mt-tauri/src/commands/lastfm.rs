//! Last.fm integration commands.
//!
//! Provides OAuth authentication, scrobbling, now playing updates, and loved tracks import.

use crate::db::{favorites, library, scrobble, settings, Database};
use crate::events::{LastfmAuthEvent, ScrobbleStatusEvent};
use crate::lastfm::{
    AuthCallbackResponse, AuthUrlResponse, DisconnectResponse, ImportLovedTracksResponse,
    LastFmClient, LastfmSettings, LastfmSettingsUpdate, NowPlayingRequest, QueueRetryResponse,
    QueueStatusResponse, ScrobbleRequest, ScrobbleResponse,
};
use serde_json::json;
use tauri::{AppHandle, Emitter, State};

/// Helper to check if a setting is truthy
fn is_setting_truthy(value: Option<String>) -> bool {
    matches!(value.as_deref(), Some("1") | Some("true") | Some("yes") | Some("on"))
}

/// Helper to parse setting as u8
fn parse_threshold(value: Option<String>, default: u8) -> u8 {
    value
        .and_then(|v| v.parse::<u8>().ok())
        .map(|v| v.clamp(25, 100))
        .unwrap_or(default)
}

/// Get Last.fm settings
#[tauri::command]
pub fn lastfm_get_settings(db: State<Database>) -> Result<LastfmSettings, String> {
    let client = LastFmClient::new();

    db.with_conn(|conn| {
        let enabled = is_setting_truthy(settings::get_setting(conn, "lastfm_scrobbling_enabled")?);
        let username = settings::get_setting(conn, "lastfm_username")?;
        let session_key = settings::get_setting(conn, "lastfm_session_key")?;
        let threshold = parse_threshold(
            settings::get_setting(conn, "lastfm_scrobble_threshold")?,
            90,
        );

        Ok(LastfmSettings {
            enabled,
            username,
            authenticated: session_key.is_some(),
            configured: client.is_configured(),
            scrobble_threshold: threshold,
        })
    })
    .map_err(|e| format!("Failed to get Last.fm settings: {}", e))
}

/// Update Last.fm settings
#[tauri::command]
pub fn lastfm_update_settings(
    db: State<Database>,
    settings_update: LastfmSettingsUpdate,
) -> Result<serde_json::Value, String> {
    let mut updated = Vec::new();

    db.with_conn(|conn| {
        if let Some(enabled) = settings_update.enabled {
            settings::set_setting(conn, "lastfm_scrobbling_enabled", &json!(enabled))?;
            updated.push("enabled");
        }

        if let Some(threshold) = settings_update.scrobble_threshold {
            // Clamp to valid range (25-100%)
            let clamped_threshold = threshold.clamp(25, 100);
            settings::set_setting(
                conn,
                "lastfm_scrobble_threshold",
                &json!(clamped_threshold),
            )?;
            updated.push("scrobble_threshold");
        }

        Ok(())
    })
    .map_err(|e: crate::db::DbError| format!("Failed to update Last.fm settings: {}", e))?;

    Ok(json!({ "updated": updated }))
}

// ============================================
// Authentication Commands
// ============================================

/// Get Last.fm authentication URL and token
#[tauri::command]
pub async fn lastfm_get_auth_url(app: AppHandle) -> Result<AuthUrlResponse, String> {
    let client = LastFmClient::new();

    if !client.is_configured() {
        return Err("Last.fm API keys not configured. Set LASTFM_API_KEY and LASTFM_API_SECRET.".to_string());
    }

    let (auth_url, token) = client
        .get_auth_url()
        .await
        .map_err(|e| format!("Failed to get auth URL: {}", e))?;

    // Emit pending event
    app.emit(
        LastfmAuthEvent::EVENT_NAME,
        LastfmAuthEvent::pending(),
    )
    .map_err(|e| format!("Failed to emit event: {}", e))?;

    Ok(AuthUrlResponse { auth_url, token })
}

/// Complete Last.fm authentication with token
#[tauri::command]
pub async fn lastfm_auth_callback(
    app: AppHandle,
    db: State<'_, Database>,
    token: String,
) -> Result<AuthCallbackResponse, String> {
    let client = LastFmClient::new();

    if !client.is_configured() {
        return Err("Last.fm API not configured".to_string());
    }

    // Exchange token for session
    let session = client
        .get_session(&token)
        .await
        .map_err(|e| format!("Authentication failed: {}", e))?;

    let username = session.name.clone();
    let session_key = session.key.clone();

    // Store session data in database
    db.with_conn(|conn| {
        settings::set_setting(conn, "lastfm_session_key", &json!(session_key))?;
        settings::set_setting(conn, "lastfm_username", &json!(username))?;
        settings::set_setting(conn, "lastfm_scrobbling_enabled", &json!(true))?;
        Ok(())
    })
    .map_err(|e: crate::db::DbError| format!("Failed to save session: {}", e))?;

    // Emit authenticated event
    app.emit(
        LastfmAuthEvent::EVENT_NAME,
        LastfmAuthEvent::authenticated(username.clone()),
    )
    .map_err(|e| format!("Failed to emit event: {}", e))?;

    Ok(AuthCallbackResponse {
        status: "success".to_string(),
        username,
        message: format!("Successfully connected as {}", session.name),
    })
}

/// Disconnect from Last.fm
#[tauri::command]
pub fn lastfm_disconnect(
    app: AppHandle,
    db: State<Database>,
) -> Result<DisconnectResponse, String> {
    db.with_conn(|conn| {
        settings::set_setting(conn, "lastfm_session_key", &json!(""))?;
        settings::set_setting(conn, "lastfm_username", &json!(""))?;
        settings::set_setting(conn, "lastfm_scrobbling_enabled", &json!(false))?;
        Ok(())
    })
    .map_err(|e: crate::db::DbError| format!("Failed to disconnect: {}", e))?;

    // Emit disconnected event
    app.emit(
        LastfmAuthEvent::EVENT_NAME,
        LastfmAuthEvent::disconnected(),
    )
    .map_err(|e| format!("Failed to emit event: {}", e))?;

    Ok(DisconnectResponse {
        status: "success".to_string(),
        message: "Disconnected from Last.fm".to_string(),
    })
}

// ============================================
// Scrobbling Commands
// ============================================

/// Check if a track should be scrobbled based on threshold
///
/// Last.fm rules: scrobble if ALL of these conditions are met:
/// 1. played_time >= 30 seconds (absolute minimum)
/// 2. fraction_played >= threshold (percentage requirement)
/// 3. played_time >= min(duration * threshold, 240 seconds) (4-minute max cap)
fn should_scrobble(duration: f64, played_time: f64, threshold_percent: u8) -> bool {
    if duration <= 0.0 {
        return false;
    }

    let threshold_fraction = threshold_percent as f64 / 100.0;
    let fraction_played = played_time / duration;
    let threshold_time = duration * threshold_fraction;

    // All three conditions must be met
    let meets_minimum = played_time >= 30.0;
    let meets_fraction = fraction_played >= threshold_fraction;
    let meets_threshold_or_cap = played_time >= f64::min(threshold_time, 240.0);

    meets_minimum && meets_fraction && meets_threshold_or_cap
}

/// Update "Now Playing" status on Last.fm
#[tauri::command]
pub async fn lastfm_now_playing(
    db: State<'_, Database>,
    request: NowPlayingRequest,
) -> Result<serde_json::Value, String> {
    // Check if scrobbling is enabled
    let enabled = db
        .with_conn(|conn| Ok(is_setting_truthy(settings::get_setting(conn, "lastfm_scrobbling_enabled")?)))
        .map_err(|e: crate::db::DbError| format!("Database error: {}", e))?;

    if !enabled {
        return Ok(json!({ "status": "disabled", "message": "Scrobbling is disabled" }));
    }

    // Check if authenticated
    let session_key = db
        .with_conn(|conn| settings::get_setting(conn, "lastfm_session_key"))
        .map_err(|e: crate::db::DbError| format!("Database error: {}", e))?;

    if session_key.is_none() || session_key.as_deref() == Some("") {
        return Ok(json!({ "status": "not_authenticated", "message": "Not authenticated with Last.fm" }));
    }

    let session_key = session_key.unwrap();
    let client = LastFmClient::new();

    // Update now playing (non-critical - silent errors)
    let result = client
        .update_now_playing(
            &session_key,
            &request.artist,
            &request.track,
            request.album.as_deref(),
            request.duration,
        )
        .await;

    match result {
        Ok(_) => Ok(json!({ "status": "success" })),
        Err(e) => {
            // Now Playing updates are not critical, just log and return success
            eprintln!("[lastfm] Now Playing update failed: {}", e);
            Ok(json!({ "status": "error", "message": e.to_string() }))
        }
    }
}

/// Scrobble a track to Last.fm
#[tauri::command]
pub async fn lastfm_scrobble(
    app: AppHandle,
    db: State<'_, Database>,
    request: ScrobbleRequest,
) -> Result<ScrobbleResponse, String> {
    // Check if scrobbling is enabled
    let enabled = db
        .with_conn(|conn| Ok(is_setting_truthy(settings::get_setting(conn, "lastfm_scrobbling_enabled")?)))
        .map_err(|e: crate::db::DbError| format!("Database error: {}", e))?;

    if !enabled {
        return Ok(ScrobbleResponse {
            status: "disabled".to_string(),
            message: Some("Scrobbling is disabled".to_string()),
        });
    }

    // Check if authenticated
    let session_key = db
        .with_conn(|conn| settings::get_setting(conn, "lastfm_session_key"))
        .map_err(|e: crate::db::DbError| format!("Database error: {}", e))?;

    if session_key.is_none() || session_key.as_deref() == Some("") {
        return Ok(ScrobbleResponse {
            status: "not_authenticated".to_string(),
            message: Some("Not authenticated with Last.fm".to_string()),
        });
    }

    // Get threshold
    let threshold = db
        .with_conn(|conn| Ok(parse_threshold(settings::get_setting(conn, "lastfm_scrobble_threshold")?, 90)))
        .map_err(|e: crate::db::DbError| format!("Database error: {}", e))?;

    // Check if track meets threshold
    if !should_scrobble(
        request.duration as f64,
        request.played_time as f64,
        threshold,
    ) {
        return Ok(ScrobbleResponse {
            status: "threshold_not_met".to_string(),
            message: None,
        });
    }

    let session_key = session_key.unwrap();
    let client = LastFmClient::new();

    // Attempt to scrobble
    let result = client
        .scrobble(
            &session_key,
            &request.artist,
            &request.track,
            request.timestamp,
            request.album.as_deref(),
        )
        .await;

    match result {
        Ok(accepted) => {
            if accepted > 0 {
                // Emit success event
                let _ = app.emit(
                    ScrobbleStatusEvent::EVENT_NAME,
                    ScrobbleStatusEvent::success(request.artist.clone(), request.track.clone()),
                );

                Ok(ScrobbleResponse {
                    status: "success".to_string(),
                    message: None,
                })
            } else {
                // Not accepted - queue for retry
                queue_scrobble_for_retry(&app, &db, &request)?;

                Ok(ScrobbleResponse {
                    status: "queued".to_string(),
                    message: Some("Scrobble queued for retry".to_string()),
                })
            }
        }
        Err(e) => {
            // Network or API error - queue for retry
            queue_scrobble_for_retry(&app, &db, &request)?;

            Ok(ScrobbleResponse {
                status: "queued".to_string(),
                message: Some(format!("Scrobble queued for retry: {}", e)),
            })
        }
    }
}

/// Helper to queue a failed scrobble for later retry
fn queue_scrobble_for_retry(
    app: &AppHandle,
    db: &State<Database>,
    request: &ScrobbleRequest,
) -> Result<(), String> {
    db.with_conn(|conn| {
        scrobble::queue_scrobble(
            conn,
            &request.artist,
            &request.track,
            request.album.as_deref(),
            request.timestamp,
        )
    })
    .map_err(|e: crate::db::DbError| format!("Failed to queue scrobble: {}", e))?;

    // Emit queued event
    let _ = app.emit(
        ScrobbleStatusEvent::EVENT_NAME,
        ScrobbleStatusEvent::queued(request.artist.clone(), request.track.clone()),
    );

    Ok(())
}

/// Scrobble a track from the audio thread (synchronous, called at 90% threshold)
///
/// This function is called by the audio thread when playback reaches the scrobble
/// threshold. It queues the scrobble for immediate processing by the retry mechanism.
pub(crate) fn scrobble_from_audio_thread(
    app: &AppHandle,
    conn: &rusqlite::Connection,
    track_id: i64,
) -> Result<(), String> {
    // Check if scrobbling is enabled
    let enabled = is_setting_truthy(settings::get_setting(conn, "lastfm_scrobbling_enabled")
        .map_err(|e| format!("Database error: {}", e))?);

    if !enabled {
        return Ok(());
    }

    // Check if authenticated
    let session_key = settings::get_setting(conn, "lastfm_session_key")
        .map_err(|e| format!("Database error: {}", e))?;

    if session_key.is_none() || session_key.as_deref() == Some("") {
        return Ok(());
    }

    // Load track metadata
    let track = library::get_track_by_id(conn, track_id)
        .map_err(|e| format!("Failed to load track: {}", e))?
        .ok_or_else(|| format!("Track {} not found", track_id))?;

    // Check duration requirement (>=30s)
    if track.duration.unwrap_or(0.0) < 30.0 {
        return Ok(());
    }

    // Queue for scrobbling (bypass threshold check since audio thread already validated)
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();

    let artist = track.artist.as_deref().unwrap_or("Unknown Artist");
    let title = track.title.as_deref().unwrap_or("Unknown Track");
    let album = track.album.as_deref();

    scrobble::queue_scrobble(
        conn,
        artist,
        title,
        album,
        timestamp as i64,
    )
    .map_err(|e| format!("Failed to queue scrobble: {}", e))?;

    // Emit queued event
    let _ = app.emit(
        ScrobbleStatusEvent::EVENT_NAME,
        ScrobbleStatusEvent::queued(artist.to_string(), title.to_string()),
    );

    Ok(())
}

// ============================================
// Queue Commands
// ============================================

/// Get status of scrobble queue
#[tauri::command]
pub fn lastfm_queue_status(db: State<Database>) -> Result<QueueStatusResponse, String> {
    let queued_scrobbles = db
        .with_conn(|conn| scrobble::get_queued_scrobbles(conn, 1000))
        .map_err(|e: crate::db::DbError| format!("Failed to get queue status: {}", e))?;

    Ok(QueueStatusResponse {
        queued_scrobbles: queued_scrobbles.len(),
    })
}

/// Manually retry queued scrobbles
#[tauri::command]
pub async fn lastfm_queue_retry(
    app: AppHandle,
    db: State<'_, Database>,
) -> Result<QueueRetryResponse, String> {
    use crate::events::LastfmQueueUpdatedEvent;
    use crate::lastfm::QueueRetryResponse;

    // Check if authenticated
    let session_key = db
        .with_conn(|conn| settings::get_setting(conn, "lastfm_session_key"))
        .map_err(|e: crate::db::DbError| format!("Database error: {}", e))?;

    if session_key.is_none() || session_key.as_deref() == Some("") {
        return Err("Not authenticated with Last.fm".to_string());
    }

    let session_key = session_key.unwrap();
    let client = LastFmClient::new();

    // Get queued scrobbles (limit to 100 per retry batch)
    let queued = db
        .with_conn(|conn| scrobble::get_queued_scrobbles(conn, 100))
        .map_err(|e: crate::db::DbError| format!("Failed to get queued scrobbles: {}", e))?;

    let mut successful = 0;
    let mut failed = 0;

    // Attempt to submit each queued scrobble
    for queued_scrobble in queued.iter() {
        match client
            .scrobble(
                &session_key,
                &queued_scrobble.artist,
                &queued_scrobble.track,
                queued_scrobble.timestamp,
                queued_scrobble.album.as_deref(),
            )
            .await
        {
            Ok(accepted) => {
                if accepted > 0 {
                    // Remove from queue
                    if let Err(e) = db.with_conn(|conn| {
                        scrobble::remove_queued_scrobble(conn, queued_scrobble.id)
                    }) {
                        eprintln!("[lastfm] Failed to remove scrobble from queue: {}", e);
                    }

                    // Emit success event
                    let _ = app.emit(
                        ScrobbleStatusEvent::EVENT_NAME,
                        ScrobbleStatusEvent::success(
                            queued_scrobble.artist.clone(),
                            queued_scrobble.track.clone(),
                        ),
                    );

                    successful += 1;
                } else {
                    // Not accepted - increment retry count
                    if let Err(e) = db.with_conn(|conn| {
                        scrobble::increment_scrobble_retry(conn, queued_scrobble.id)
                    }) {
                        eprintln!("[lastfm] Failed to increment retry count: {}", e);
                    }
                    failed += 1;
                }
            }
            Err(e) => {
                eprintln!(
                    "[lastfm] Retry failed for {}/{}: {}",
                    queued_scrobble.artist, queued_scrobble.track, e
                );

                // Increment retry count
                if let Err(e) = db
                    .with_conn(|conn| scrobble::increment_scrobble_retry(conn, queued_scrobble.id))
                {
                    eprintln!("[lastfm] Failed to increment retry count: {}", e);
                }
                failed += 1;
            }
        }
    }

    // Get updated queue count
    let remaining_queued = db
        .with_conn(|conn| scrobble::get_queued_scrobbles(conn, 1000))
        .map_err(|e: crate::db::DbError| format!("Failed to get queue status: {}", e))?
        .len();

    // Emit queue updated event
    let _ = app.emit(
        LastfmQueueUpdatedEvent::EVENT_NAME,
        LastfmQueueUpdatedEvent::new(remaining_queued),
    );

    let status = if successful > 0 {
        if failed > 0 {
            format!("Retried {} scrobbles ({} successful, {} failed)", successful + failed, successful, failed)
        } else {
            format!("Successfully retried {} scrobbles", successful)
        }
    } else if failed > 0 {
        "All retry attempts failed".to_string()
    } else {
        "No queued scrobbles to retry".to_string()
    };

    Ok(QueueRetryResponse {
        status,
        remaining_queued,
    })
}

// ============================================
// Loved Tracks Import
// ============================================

/// Import loved tracks from Last.fm and add them to favorites
#[tauri::command]
pub async fn lastfm_import_loved_tracks(
    db: State<'_, Database>,
) -> Result<ImportLovedTracksResponse, String> {
    use crate::db::library::LibraryQuery;
    use crate::db::{LibrarySortColumn, SortOrder};

    // Check if authenticated
    let username = db
        .with_conn(|conn| settings::get_setting(conn, "lastfm_username"))
        .map_err(|e: crate::db::DbError| format!("Database error: {}", e))?;

    if username.is_none() || username.as_deref() == Some("") {
        return Err("Not authenticated with Last.fm".to_string());
    }

    let username = username.unwrap();
    let client = LastFmClient::new();

    if !client.is_configured() {
        return Err("Last.fm API not configured".to_string());
    }

    // Fetch all loved tracks (paginated)
    let mut all_loved_tracks = Vec::new();
    let per_page = 200;
    let mut page = 1;

    loop {
        match client.get_loved_tracks(&username, per_page, page).await {
            Ok(tracks) => {
                let track_count = tracks.len();
                all_loved_tracks.extend(tracks);

                // If we got fewer tracks than requested, we've reached the end
                if track_count < per_page as usize {
                    break;
                }

                page += 1;
            }
            Err(e) => {
                return Err(format!("Failed to fetch loved tracks: {}", e));
            }
        }
    }

    let total_loved = all_loved_tracks.len();
    println!(
        "[lastfm] Fetched {} loved tracks from Last.fm",
        total_loved
    );

    // Match loved tracks against local library and add to favorites
    let mut imported = 0;
    let mut already_favorited = 0;
    let mut not_in_library = 0;

    for loved_track in all_loved_tracks.iter() {
        let artist_name = loved_track.artist.name();
        let track_name = &loved_track.name;

        // Find matching track in library using separate artist and title filters
        // This is more accurate than combining them into a single search string
        let query = LibraryQuery {
            search: Some(track_name.clone()),  // Search in title field
            artist: Some(artist_name.to_string()),  // Exact artist filter
            album: None,
            sort_by: LibrarySortColumn::Title,
            sort_order: SortOrder::Asc,
            limit: 5,  // Get top 5 matches to find best one
            offset: 0,
        };

        let mut search_results = db
            .with_conn(|conn| library::get_all_tracks(conn, &query))
            .map_err(|e: crate::db::DbError| format!("Library search error: {}", e))?;

        // If no results with artist filter, try a more lenient search
        if search_results.items.is_empty() {
            let fallback_query = LibraryQuery {
                search: Some(format!("{} {}", artist_name, track_name)),
                artist: None,
                album: None,
                sort_by: LibrarySortColumn::Title,
                sort_order: SortOrder::Asc,
                limit: 5,
                offset: 0,
            };

            search_results = db
                .with_conn(|conn| library::get_all_tracks(conn, &fallback_query))
                .map_err(|e: crate::db::DbError| format!("Library search error: {}", e))?;
        }

        // Check if we found any matches
        if search_results.items.is_empty() {
            not_in_library += 1;
            println!(
                "[lastfm] No match found for: {} - {}",
                artist_name, track_name
            );
            continue;
        }

        if let Some(first_track) = search_results.items.first() {
            println!(
                "[lastfm] Found match: {} - {} -> {} (ID: {})",
                artist_name, track_name, first_track.filepath, first_track.id
            );
            // Check if already favorited
            let (is_fav, _) = db
                .with_conn(|conn| favorites::is_favorite(conn, first_track.id))
                .map_err(|e: crate::db::DbError| format!("Favorites check error: {}", e))?;

            if is_fav {
                already_favorited += 1;
            } else {
                // Add to favorites
                let add_result = db.with_conn(|conn| favorites::add_favorite(conn, first_track.id));
                match add_result {
                    Ok(Some(_)) => {
                        imported += 1;
                    }
                    Ok(None) => {
                        // Race condition - already favorited
                        already_favorited += 1;
                    }
                    Err(e) => {
                        eprintln!(
                            "[lastfm] Failed to add {} - {} to favorites: {}",
                            artist_name, track_name, e
                        );
                    }
                }
            }
        } else {
            not_in_library += 1;
        }
    }

    let message = format!(
        "Imported {} tracks, {} already favorited, {} not in library",
        imported, already_favorited, not_in_library
    );

    println!("[lastfm] {}", message);

    Ok(ImportLovedTracksResponse {
        status: "success".to_string(),
        total_loved_tracks: total_loved,
        imported_count: imported,
        message,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_setting_truthy() {
        assert!(is_setting_truthy(Some("1".to_string())));
        assert!(is_setting_truthy(Some("true".to_string())));
        assert!(is_setting_truthy(Some("yes".to_string())));
        assert!(is_setting_truthy(Some("on".to_string())));
        assert!(!is_setting_truthy(Some("0".to_string())));
        assert!(!is_setting_truthy(Some("false".to_string())));
        assert!(!is_setting_truthy(None));
    }

    #[test]
    fn test_parse_threshold() {
        assert_eq!(parse_threshold(Some("90".to_string()), 90), 90);
        assert_eq!(parse_threshold(Some("50".to_string()), 90), 50);
        // Clamps to 25-100 range
        assert_eq!(parse_threshold(Some("10".to_string()), 90), 25);
        assert_eq!(parse_threshold(Some("150".to_string()), 90), 100);
        // Invalid values use default
        assert_eq!(parse_threshold(Some("invalid".to_string()), 90), 90);
        assert_eq!(parse_threshold(None, 90), 90);
    }

    #[test]
    fn test_should_scrobble_basic() {
        // Track duration: 200 seconds, threshold: 50%
        // Should scrobble if played >= 100s (50%) AND >= 30s AND >= min(100s, 240s)

        // Played 100s (exactly 50%) - should scrobble
        assert!(should_scrobble(200.0, 100.0, 50));

        // Played 150s (75%) - should scrobble
        assert!(should_scrobble(200.0, 150.0, 50));

        // Played 50s (25%) - should NOT scrobble (below threshold)
        assert!(!should_scrobble(200.0, 50.0, 50));

        // Played 99s (49.5%) - should NOT scrobble (just below threshold)
        assert!(!should_scrobble(200.0, 99.0, 50));
    }

    #[test]
    fn test_should_scrobble_minimum_time() {
        // Track duration: 60 seconds, threshold: 90%
        // Required: >= 54s (90%) AND >= 30s AND >= min(54s, 240s)

        // Played 54s (exactly 90%) - should scrobble
        assert!(should_scrobble(60.0, 54.0, 90));

        // Played 55s (91.67%) - should scrobble
        assert!(should_scrobble(60.0, 55.0, 90));

        // Played 29s - should NOT scrobble (below 30s minimum)
        assert!(!should_scrobble(60.0, 29.0, 90));

        // Played 30s - still should NOT scrobble (below 90% threshold)
        assert!(!should_scrobble(60.0, 30.0, 90));
    }

    #[test]
    fn test_should_scrobble_max_cap() {
        // Track duration: 600 seconds (10 minutes), threshold: 50%
        // Required: >= 50% (300s) AND >= 30s AND >= min(300s, 240s) = 240s
        // All three conditions must be met

        // Played 240s (40%) - should NOT scrobble (below 50% threshold)
        assert!(!should_scrobble(600.0, 240.0, 50));

        // Played 300s (50%) - should scrobble (meets all conditions)
        assert!(should_scrobble(600.0, 300.0, 50));

        // Played 299s (49.83%) - should NOT scrobble (just below 50%)
        assert!(!should_scrobble(600.0, 299.0, 50));

        // For a very long track (20 minutes), 240s max cap means you only need 240s if >= threshold
        // Track: 1200s, threshold: 50% (600s), max cap: 240s
        // Playing 600s (50%) - should scrobble (meets all: 50%, 240s cap, 30s min)
        assert!(should_scrobble(1200.0, 600.0, 50));

        // Playing 240s (20%) - should NOT scrobble (below 50% even though meets 240s cap)
        assert!(!should_scrobble(1200.0, 240.0, 50));
    }

    #[test]
    fn test_should_scrobble_edge_cases() {
        // Zero duration - should NOT scrobble
        assert!(!should_scrobble(0.0, 100.0, 50));

        // Negative duration - should NOT scrobble
        assert!(!should_scrobble(-10.0, 100.0, 50));

        // Very short track (20s) with 90% threshold
        // Required: >= 18s (90%) AND >= 30s
        // Can never scrobble because 30s minimum is longer than track
        assert!(!should_scrobble(20.0, 18.0, 90));
        assert!(!should_scrobble(20.0, 20.0, 90));

        // Track with minimum scrobblable length (40s)
        // With 90% threshold: >= 36s AND >= 30s AND >= min(36s, 240s)
        assert!(should_scrobble(40.0, 36.0, 90));
        assert!(!should_scrobble(40.0, 35.0, 90));
    }

    #[test]
    fn test_should_scrobble_threshold_variations() {
        // Track duration: 300 seconds

        // 25% threshold (minimum)
        assert!(should_scrobble(300.0, 75.0, 25));  // 75s = 25%
        assert!(!should_scrobble(300.0, 74.0, 25));

        // 50% threshold
        assert!(should_scrobble(300.0, 150.0, 50)); // 150s = 50%
        assert!(!should_scrobble(300.0, 149.0, 50));

        // 90% threshold
        assert!(should_scrobble(300.0, 270.0, 90)); // 270s = 90%
        assert!(!should_scrobble(300.0, 269.0, 90));

        // 100% threshold (maximum)
        assert!(should_scrobble(300.0, 300.0, 100)); // 300s = 100%
        assert!(!should_scrobble(300.0, 299.0, 100));
    }
}
