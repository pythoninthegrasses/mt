//! Lyrics commands.
//!
//! Provides LRCLIB lyrics lookup with SQLite caching.

use crate::db::lyrics::CachedLyrics;
use crate::db::{Database, lyrics as lyrics_db};
use crate::lyrics::LrcLibClient;
use serde::Serialize;
use tauri::State;
use tracing::{debug, warn};

#[derive(Clone, Serialize)]
pub(crate) struct LyricsResponse {
    pub plain_lyrics: Option<String>,
    pub synced_lyrics: Option<String>,
    pub instrumental: bool,
}

/// Get lyrics for a track. Checks cache first, fetches from LRCLIB on miss.
#[tracing::instrument(skip(db))]
#[tauri::command]
pub(crate) async fn lyrics_get(
    db: State<'_, Database>,
    artist: String,
    title: String,
    album: Option<String>,
    duration: Option<f64>,
) -> Result<Option<LyricsResponse>, String> {
    // Check cache first
    let cached = db
        .with_conn(|conn| lyrics_db::get_cached_lyrics(conn, &artist, &title))
        .map_err(|e| format!("Database error: {e}"))?;

    if let Some(cached) = cached {
        debug!(artist, title, "Lyrics cache hit");
        // Negative cache: both fields None means no lyrics found previously
        if cached.plain_lyrics.is_none() && cached.synced_lyrics.is_none() {
            return Ok(None);
        }
        return Ok(Some(LyricsResponse {
            plain_lyrics: cached.plain_lyrics,
            synced_lyrics: cached.synced_lyrics,
            instrumental: false,
        }));
    }

    debug!(artist, title, "Lyrics cache miss, fetching from LRCLIB");

    // Fetch from LRCLIB
    let client = LrcLibClient::new();
    let album_str = album.as_deref().unwrap_or("");
    let duration_secs = duration.map(|d| d as i64).unwrap_or(0);

    let result = client
        .fetch_lyrics(&artist, &title, album_str, duration_secs)
        .await;

    match result {
        Ok(Some(response)) => {
            if response.instrumental {
                // Cache instrumental as negative result
                db.with_conn(|conn| {
                    lyrics_db::save_lyrics(conn, &artist, &title, album.as_deref(), None, None)
                })
                .map_err(|e| format!("Database error: {e}"))?;

                return Ok(None);
            }

            // Check if response actually has lyrics content
            let has_content = response
                .plain_lyrics
                .as_ref()
                .is_some_and(|s| !s.is_empty())
                || response
                    .synced_lyrics
                    .as_ref()
                    .is_some_and(|s| !s.is_empty());

            if !has_content {
                // No actual lyrics content — cache as negative
                db.with_conn(|conn| {
                    lyrics_db::save_lyrics(conn, &artist, &title, album.as_deref(), None, None)
                })
                .map_err(|e| format!("Database error: {e}"))?;

                return Ok(None);
            }

            let cached = CachedLyrics {
                plain_lyrics: response.plain_lyrics.clone(),
                synced_lyrics: response.synced_lyrics.clone(),
            };

            db.with_conn(|conn| {
                lyrics_db::save_lyrics(
                    conn,
                    &artist,
                    &title,
                    album.as_deref(),
                    Some(&cached),
                    Some("lrclib.net"),
                )
            })
            .map_err(|e| format!("Database error: {e}"))?;

            Ok(Some(LyricsResponse {
                plain_lyrics: response.plain_lyrics,
                synced_lyrics: response.synced_lyrics,
                instrumental: false,
            }))
        }
        Ok(None) => {
            // 404: cache negative result
            db.with_conn(|conn| {
                lyrics_db::save_lyrics(conn, &artist, &title, album.as_deref(), None, None)
            })
            .map_err(|e| format!("Database error: {e}"))?;

            Ok(None)
        }
        Err(e) => {
            warn!(artist, title, error = %e, "LRCLIB fetch failed");
            // Don't cache network errors — allow retry on next attempt
            Ok(None)
        }
    }
}

/// Clear all cached lyrics.
#[tracing::instrument(skip(db))]
#[tauri::command]
pub(crate) fn lyrics_clear_cache(db: State<Database>) -> Result<(), String> {
    db.with_conn(lyrics_db::clear_cache)
        .map_err(|e| format!("Database error: {e}"))
}
