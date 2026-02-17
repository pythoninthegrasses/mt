//! Last.fm integration commands.
//!
//! Provides OAuth authentication, scrobbling, now playing updates, and loved tracks import.

use crate::db::{favorites, lastfm_loved, library, scrobble, settings, Database};
use crate::events::{LastfmAuthEvent, ScrobbleStatusEvent};
use crate::lastfm::{
    AuthCallbackResponse, AuthUrlResponse, CacheLovedTracksResponse, DisconnectResponse,
    ImportLovedTracksResponse, LastFmClient, LastfmSettings, LastfmSettingsUpdate,
    LovedTracksStatsResponse, MatchLovedTracksResponse, NowPlayingRequest, QueueRetryResponse,
    QueueStatusResponse, ScrobbleRequest, ScrobbleResponse,
};
use serde_json::json;
use tauri::{AppHandle, Emitter, State};
use tracing::{debug, error, info, warn};

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
#[tracing::instrument(skip(db))]
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
#[tracing::instrument(skip(db, settings_update))]
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
#[tracing::instrument(skip(app))]
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
#[tracing::instrument(skip(app, db))]
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
#[tracing::instrument(skip(app, db))]
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
#[tracing::instrument(skip(db, request))]
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
            warn!(error = %e, "Now Playing update failed");
            Ok(json!({ "status": "error", "message": e.to_string() }))
        }
    }
}

/// Scrobble a track to Last.fm
#[tracing::instrument(skip(app, db, request))]
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
#[tracing::instrument(skip(db))]
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
#[tracing::instrument(skip(app, db))]
#[tauri::command]
pub async fn lastfm_queue_retry(
    app: AppHandle,
    db: State<'_, Database>,
) -> Result<QueueRetryResponse, String> {
    use crate::events::LastfmQueueUpdatedEvent;
    use crate::lastfm::QueueRetryResponse;
    let start = std::time::Instant::now();

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
                        error!(error = %e, "Failed to remove scrobble from queue");
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
                        error!(error = %e, "Failed to increment retry count");
                    }
                    failed += 1;
                }
            }
            Err(e) => {
                warn!(
                    artist = %queued_scrobble.artist,
                    track = %queued_scrobble.track,
                    error = %e,
                    "Retry failed for scrobble"
                );

                // Increment retry count
                if let Err(e) = db
                    .with_conn(|conn| scrobble::increment_scrobble_retry(conn, queued_scrobble.id))
                {
                    error!(error = %e, "Failed to increment retry count");
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

    crate::logging::log_slow_command("lastfm_queue_retry", start);

    Ok(QueueRetryResponse {
        status,
        remaining_queued,
    })
}

// ============================================
// Loved Tracks Import
// ============================================

/// Import loved tracks from Last.fm and add them to favorites
#[tracing::instrument(skip(db))]
#[tauri::command]
pub async fn lastfm_import_loved_tracks(
    db: State<'_, Database>,
) -> Result<ImportLovedTracksResponse, String> {
    use crate::db::library::LibraryQuery;
    use crate::db::{LibrarySortColumn, SortOrder};
    let start = std::time::Instant::now();

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
    info!(count = total_loved, "Fetched loved tracks from Last.fm (import)");

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
            debug!(artist = %artist_name, track = %track_name, "No match found for loved track");
            continue;
        }

        if let Some(first_track) = search_results.items.first() {
            debug!(
                artist = %artist_name,
                track = %track_name,
                filepath = %first_track.filepath,
                track_id = first_track.id,
                "Found match for loved track"
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
                        error!(
                            artist = %artist_name,
                            track = %track_name,
                            error = %e,
                            "Failed to add to favorites"
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

    info!(imported, already_favorited, not_in_library, "Import loved tracks complete");
    crate::logging::log_slow_command("lastfm_import_loved_tracks", start);

    Ok(ImportLovedTracksResponse {
        status: "success".to_string(),
        total_loved_tracks: total_loved,
        imported_count: imported,
        message,
    })
}

// ============================================
// Loved Tracks Cache Commands
// ============================================

/// Fetch loved tracks from Last.fm and cache them in the database
///
/// This command fetches all loved tracks from Last.fm (or incrementally since last fetch)
/// and stores them in the local cache. It does NOT automatically match against the library
/// or add to favorites - use `lastfm_match_loved_tracks` for that.
#[tracing::instrument(skip(db))]
#[tauri::command]
pub async fn lastfm_cache_loved_tracks(
    db: State<'_, Database>,
    incremental: Option<bool>,
) -> Result<CacheLovedTracksResponse, String> {
    let start = std::time::Instant::now();

    // Check if authenticated
    let username = db
        .with_conn(|conn| settings::get_setting(conn, "lastfm_username"))
        .map_err(|e| format!("Database error: {}", e))?;

    if username.is_none() || username.as_deref() == Some("") {
        return Err("Not authenticated with Last.fm".to_string());
    }

    let username = username.unwrap();
    let client = LastFmClient::new();

    if !client.is_configured() {
        return Err("Last.fm API not configured".to_string());
    }

    // For incremental updates, get the most recent loved_at timestamp
    let incremental = incremental.unwrap_or(false);
    let since_timestamp = if incremental {
        db.with_conn(lastfm_loved::get_most_recent_loved_at)
            .map_err(|e| format!("Database error: {}", e))?
    } else {
        None
    };

    info!(incremental, ?since_timestamp, "Fetching loved tracks for cache");

    // Fetch all loved tracks (paginated)
    let mut all_loved_tracks = Vec::new();
    let per_page = 200;
    let mut page = 1;
    let mut stop_fetching = false;

    loop {
        match client.get_loved_tracks(&username, per_page, page).await {
            Ok(tracks) => {
                let track_count = tracks.len();

                // For incremental updates, check if we've reached tracks older than our last fetch
                for track in tracks {
                    if let Some(since_ts) = since_timestamp
                        && let Some(date) = &track.date
                        && let Some(ts) = date.timestamp()
                        && ts <= since_ts
                    {
                        // We've reached tracks we already have
                        stop_fetching = true;
                        break;
                    }
                    all_loved_tracks.push(track);
                }

                if stop_fetching {
                    break;
                }

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

    let total_fetched = all_loved_tracks.len();
    info!(count = total_fetched, "Fetched loved tracks from Last.fm (cache)");

    // Store in cache
    let tracks_to_cache: Vec<(String, String, Option<i64>)> = all_loved_tracks
        .iter()
        .map(|t| {
            let artist = t.artist.name().to_string();
            let track = t.name.clone();
            let loved_at = t.date.as_ref().and_then(|d| d.timestamp());
            (artist, track, loved_at)
        })
        .collect();

    let newly_cached = db
        .with_conn(|conn| lastfm_loved::bulk_insert_loved_tracks(conn, &tracks_to_cache))
        .map_err(|e| format!("Failed to cache loved tracks: {}", e))?;

    let message = if incremental && since_timestamp.is_some() {
        format!(
            "Fetched {} new loved tracks, cached {} total",
            total_fetched, newly_cached
        )
    } else {
        format!(
            "Fetched {} loved tracks from Last.fm, cached {}",
            total_fetched, newly_cached
        )
    };

    info!(total_fetched, newly_cached, incremental, "Cache loved tracks complete");
    crate::logging::log_slow_command("lastfm_cache_loved_tracks", start);

    Ok(CacheLovedTracksResponse {
        status: "success".to_string(),
        total_fetched,
        newly_cached,
        message,
    })
}

/// Synchronous implementation of loved tracks matching.
///
/// Extracted so it can be called from both the Tauri command (via `spawn_blocking`)
/// and from background tasks without going through the command system.
pub fn match_loved_tracks_impl(db: &Database) -> Result<MatchLovedTracksResponse, String> {
    use crate::db::library::LibraryQuery;
    use crate::db::{LibrarySortColumn, SortOrder};

    // Get all unmatched loved tracks from cache
    let unmatched = db
        .with_conn(|conn| lastfm_loved::get_unmatched_loved_tracks(conn, None))
        .map_err(|e| format!("Failed to get unmatched tracks: {}", e))?;

    let total_unmatched = unmatched.len();
    info!(count = total_unmatched, "Matching unmatched loved tracks");

    let mut matched = 0;
    let mut already_matched = 0;
    let mut no_match = 0;
    let mut new_favorites = 0;

    for loved_track in unmatched.iter() {
        // Try to find in library with artist filter first
        let query = LibraryQuery {
            search: Some(loved_track.track.clone()),
            artist: Some(loved_track.artist.clone()),
            album: None,
            sort_by: LibrarySortColumn::Title,
            sort_order: SortOrder::Asc,
            limit: 5,
            offset: 0,
        };

        let mut search_results = db
            .with_conn(|conn| library::get_all_tracks(conn, &query))
            .map_err(|e| format!("Library search error: {}", e))?;

        // Fallback to combined search if no results
        if search_results.items.is_empty() {
            let fallback_query = LibraryQuery {
                search: Some(format!("{} {}", loved_track.artist, loved_track.track)),
                artist: None,
                album: None,
                sort_by: LibrarySortColumn::Title,
                sort_order: SortOrder::Asc,
                limit: 5,
                offset: 0,
            };

            search_results = db
                .with_conn(|conn| library::get_all_tracks(conn, &fallback_query))
                .map_err(|e| format!("Library search error: {}", e))?;
        }

        if search_results.items.is_empty() {
            // Mark as checked even if not found
            let _ = db.with_conn(|conn| lastfm_loved::mark_checked(conn, loved_track.id));
            no_match += 1;
            continue;
        }

        if let Some(library_track) = search_results.items.first() {
            // Set the match in the cache
            db.with_conn(|conn| {
                lastfm_loved::set_matched_track(conn, loved_track.id, library_track.id)
            })
            .map_err(|e| format!("Failed to set match: {}", e))?;

            matched += 1;

            // Check if already favorited
            let (is_fav, _) = db
                .with_conn(|conn| favorites::is_favorite(conn, library_track.id))
                .map_err(|e| format!("Favorites check error: {}", e))?;

            if is_fav {
                already_matched += 1;
            } else {
                // Add to favorites
                match db.with_conn(|conn| favorites::add_favorite(conn, library_track.id)) {
                    Ok(Some(_)) => {
                        new_favorites += 1;
                        debug!(
                            artist = %loved_track.artist,
                            track = %loved_track.track,
                            "Added to favorites"
                        );
                    }
                    Ok(None) => {
                        // Race condition - already favorited
                        already_matched += 1;
                    }
                    Err(e) => {
                        error!(
                            artist = %loved_track.artist,
                            track = %loved_track.track,
                            error = %e,
                            "Failed to add to favorites"
                        );
                    }
                }
            }
        }
    }

    let message = format!(
        "Matched {} tracks ({} new favorites, {} already favorited), {} not in library",
        matched, new_favorites, already_matched, no_match
    );

    info!(matched, new_favorites, already_matched, no_match, "Match loved tracks complete");

    Ok(MatchLovedTracksResponse {
        status: "success".to_string(),
        matched,
        already_matched,
        no_match,
        new_favorites,
        message,
    })
}

/// Match cached loved tracks against the local library and add to favorites
///
/// This command doesn't make any API calls - it only matches existing cached
/// loved tracks against the local library and adds matches to favorites.
/// Runs on a blocking thread to avoid freezing the UI.
#[tracing::instrument(skip(db))]
#[tauri::command]
pub async fn lastfm_match_loved_tracks(
    db: State<'_, Database>,
) -> Result<MatchLovedTracksResponse, String> {
    let start = std::time::Instant::now();
    let db = db.inner().clone();
    let result = tokio::task::spawn_blocking(move || match_loved_tracks_impl(&db))
        .await
        .map_err(|e| format!("Task join error: {}", e))?;
    crate::logging::log_slow_command("lastfm_match_loved_tracks", start);
    result
}

/// Get statistics about cached loved tracks
#[tracing::instrument(skip(db))]
#[tauri::command]
pub fn lastfm_loved_stats(db: State<Database>) -> Result<LovedTracksStatsResponse, String> {
    let stats = db
        .with_conn(lastfm_loved::get_loved_stats)
        .map_err(|e| format!("Failed to get loved stats: {}", e))?;

    let most_recent_loved = db
        .with_conn(lastfm_loved::get_most_recent_loved_at)
        .map_err(|e| format!("Failed to get most recent loved: {}", e))?;

    Ok(LovedTracksStatsResponse {
        total_cached: stats.total_cached,
        matched: stats.matched_count,
        unmatched: stats.unmatched_count,
        most_recent_loved,
    })
}

/// Match newly added tracks against cached loved tracks
///
/// This is called internally after scanner adds new tracks to automatically
/// favorite tracks that match the loved tracks cache.
pub fn match_new_tracks_against_loved(
    conn: &rusqlite::Connection,
    new_track_ids: &[i64],
) -> Result<usize, String> {
    let mut favorited = 0;

    // Get all unmatched loved tracks
    let unmatched = lastfm_loved::get_unmatched_loved_tracks(conn, None)
        .map_err(|e| format!("Failed to get unmatched loved tracks: {}", e))?;

    if unmatched.is_empty() {
        return Ok(0);
    }

    // For each new track, check if it matches any unmatched loved track
    for track_id in new_track_ids {
        let track = library::get_track_by_id(conn, *track_id)
            .map_err(|e| format!("Failed to get track: {}", e))?;

        let Some(track) = track else {
            continue;
        };

        let track_artist = track.artist.as_deref().unwrap_or("").to_lowercase();
        let track_title = track.title.as_deref().unwrap_or("").to_lowercase();

        // Check against each unmatched loved track
        for loved in unmatched.iter() {
            let loved_artist = loved.artist.to_lowercase();
            let loved_track = loved.track.to_lowercase();

            // Simple fuzzy match - check if both artist and title contain the keywords
            let artist_match = track_artist.contains(&loved_artist)
                || loved_artist.contains(&track_artist);
            let title_match =
                track_title.contains(&loved_track) || loved_track.contains(&track_title);

            if artist_match && title_match {
                // Found a match!
                debug!(
                    artist = track.artist.as_deref().unwrap_or("Unknown"),
                    title = track.title.as_deref().unwrap_or("Unknown"),
                    track_id,
                    "Auto-matched new track against loved cache"
                );

                // Set the match
                lastfm_loved::set_matched_track(conn, loved.id, *track_id)
                    .map_err(|e| format!("Failed to set match: {}", e))?;

                // Add to favorites
                match favorites::add_favorite(conn, *track_id) {
                    Ok(Some(_)) => {
                        favorited += 1;
                        debug!(
                            artist = track.artist.as_deref().unwrap_or("Unknown"),
                            title = track.title.as_deref().unwrap_or("Unknown"),
                            "Auto-favorited"
                        );
                    }
                    Ok(None) => {
                        // Already favorited
                    }
                    Err(e) => {
                        error!(track_id, error = %e, "Failed to auto-favorite track");
                    }
                }

                break; // Move to next new track
            }
        }
    }

    Ok(favorited)
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
