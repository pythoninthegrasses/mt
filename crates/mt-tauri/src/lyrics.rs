//! LRCLIB lyrics fetching client.
//!
//! Fetches lyrics from lrclib.net API with configurable timeout and User-Agent.

use serde::Deserialize;
use std::time::Duration;
use thiserror::Error;
use tracing::{debug, warn};

const LRCLIB_API_URL: &str = "https://lrclib.net/api/get";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Error, Debug)]
pub(crate) enum LrcLibError {
    #[error("HTTP request failed: {0}")]
    Http(#[from] reqwest::Error),
}

/// Raw LRCLIB API response (JSON)
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LrcLibResponse {
    pub plain_lyrics: Option<String>,
    pub synced_lyrics: Option<String>,
    pub instrumental: bool,
}

/// LRCLIB HTTP client
pub(crate) struct LrcLibClient {
    http: reqwest::Client,
}

impl LrcLibClient {
    pub(crate) fn new() -> Self {
        let user_agent = format!("mt-desktop/{}", env!("CARGO_PKG_VERSION"));
        let http = reqwest::Client::builder()
            .user_agent(user_agent)
            .timeout(REQUEST_TIMEOUT)
            .build()
            .expect("failed to build reqwest client");
        Self { http }
    }

    /// Fetch lyrics from LRCLIB.
    /// Returns `Ok(Some(response))` on 200, `Ok(None)` on 404, or `Err` on network/timeout.
    pub(crate) async fn fetch_lyrics(
        &self,
        artist: &str,
        title: &str,
        album: &str,
        duration_secs: i64,
    ) -> Result<Option<LrcLibResponse>, LrcLibError> {
        debug!(
            artist,
            title, album, duration_secs, "Fetching lyrics from LRCLIB"
        );

        let response = self
            .http
            .get(LRCLIB_API_URL)
            .query(&[
                ("artist_name", artist),
                ("track_name", title),
                ("album_name", album),
            ])
            .query(&[("duration", duration_secs)])
            .send()
            .await?;

        let status = response.status();

        if status == reqwest::StatusCode::NOT_FOUND {
            debug!(artist, title, "LRCLIB: track not found (404)");
            return Ok(None);
        }

        if !status.is_success() {
            warn!(artist, title, status = %status, "LRCLIB: unexpected status");
            // Treat non-200/non-404 as no lyrics rather than propagating an error
            return Ok(None);
        }

        let body = response.json::<LrcLibResponse>().await?;
        debug!(
            artist,
            title,
            instrumental = body.instrumental,
            has_plain = body.plain_lyrics.is_some(),
            has_synced = body.synced_lyrics.is_some(),
            "LRCLIB: response received"
        );
        Ok(Some(body))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_200_with_lyrics() {
        let json = r#"{
            "id": 12345,
            "trackName": "Bohemian Rhapsody",
            "artistName": "Queen",
            "albumName": "A Night at the Opera",
            "duration": 354.0,
            "instrumental": false,
            "plainLyrics": "Is this the real life?\nIs this just fantasy?",
            "syncedLyrics": "[00:00.00] Is this the real life?\n[00:04.50] Is this just fantasy?"
        }"#;

        let response: LrcLibResponse = serde_json::from_str(json).unwrap();
        assert!(!response.instrumental);
        assert_eq!(
            response.plain_lyrics.as_deref(),
            Some("Is this the real life?\nIs this just fantasy?")
        );
        assert_eq!(
            response.synced_lyrics.as_deref(),
            Some("[00:00.00] Is this the real life?\n[00:04.50] Is this just fantasy?")
        );
    }

    #[test]
    fn test_parse_200_instrumental() {
        let json = r#"{
            "id": 67890,
            "trackName": "Orion",
            "artistName": "Metallica",
            "albumName": "Master of Puppets",
            "duration": 508.0,
            "instrumental": true,
            "plainLyrics": null,
            "syncedLyrics": null
        }"#;

        let response: LrcLibResponse = serde_json::from_str(json).unwrap();
        assert!(response.instrumental);
        assert!(response.plain_lyrics.is_none());
        assert!(response.synced_lyrics.is_none());
    }

    #[test]
    fn test_parse_200_plain_only() {
        let json = r#"{
            "id": 11111,
            "trackName": "Some Song",
            "artistName": "Some Artist",
            "albumName": "Some Album",
            "duration": 200.0,
            "instrumental": false,
            "plainLyrics": "Hello world",
            "syncedLyrics": null
        }"#;

        let response: LrcLibResponse = serde_json::from_str(json).unwrap();
        assert!(!response.instrumental);
        assert_eq!(response.plain_lyrics.as_deref(), Some("Hello world"));
        assert!(response.synced_lyrics.is_none());
    }

    #[test]
    fn test_parse_200_empty_strings() {
        let json = r#"{
            "id": 22222,
            "trackName": "Track",
            "artistName": "Artist",
            "albumName": "Album",
            "duration": 100.0,
            "instrumental": false,
            "plainLyrics": "",
            "syncedLyrics": ""
        }"#;

        let response: LrcLibResponse = serde_json::from_str(json).unwrap();
        assert_eq!(response.plain_lyrics.as_deref(), Some(""));
        assert_eq!(response.synced_lyrics.as_deref(), Some(""));
    }

    #[test]
    fn test_client_user_agent() {
        let client = LrcLibClient::new();
        // Just verify it constructs without panicking
        let _ = client;
    }
}
