use super::config::ApiKeyConfig;
use super::rate_limiter::RateLimiter;
use super::signature;
use super::types::*;
use std::collections::BTreeMap;
use std::sync::Arc;

/// Last.fm API client
pub struct LastFmClient {
    config: ApiKeyConfig,
    rate_limiter: Arc<RateLimiter>,
    http_client: reqwest::Client,
    base_url: String,
}

impl LastFmClient {
    /// Create a new Last.fm API client
    pub(crate) fn new() -> Self {
        Self {
            config: ApiKeyConfig::load(),
            rate_limiter: Arc::new(RateLimiter::new()),
            http_client: reqwest::Client::new(),
            base_url: "https://ws.audioscrobbler.com/2.0/".to_string(),
        }
    }

    #[cfg(test)]
    pub(crate) fn new_unconfigured() -> Self {
        Self {
            config: ApiKeyConfig {
                api_key: None,
                api_secret: None,
            },
            rate_limiter: Arc::new(RateLimiter::new()),
            http_client: reqwest::Client::new(),
            base_url: "https://ws.audioscrobbler.com/2.0/".to_string(),
        }
    }

    /// Check if API is properly configured
    pub(crate) fn is_configured(&self) -> bool {
        self.config.is_configured()
    }

    /// Make an authenticated Last.fm API call
    ///
    /// # Arguments
    /// * `method` - Last.fm API method name (e.g., "track.scrobble")
    /// * `params` - Parameters to send (excluding method, api_key, format, sk, api_sig)
    /// * `session_key` - Optional session key for authenticated calls
    /// * `use_post` - Whether to use POST instead of GET (required for write operations)
    pub(crate) async fn api_call(
        &self,
        method: &str,
        params: BTreeMap<String, String>,
        session_key: Option<&str>,
        use_post: bool,
    ) -> Result<serde_json::Value, LastFmError> {
        if !self.config.is_configured() {
            return Err(LastFmError::NotConfigured);
        }

        // Wait for rate limiting
        self.rate_limiter.wait_if_needed().await;

        // Build parameters
        let mut all_params = params;
        all_params.insert("method".to_string(), method.to_string());
        all_params.insert("api_key".to_string(), self.config.api_key().to_string());
        all_params.insert("format".to_string(), "json".to_string());

        // Add session key if provided
        if let Some(sk) = session_key {
            all_params.insert("sk".to_string(), sk.to_string());
        }

        // Generate signature if session key is present (pure Rust MD5)
        if session_key.is_some() {
            // Signature excludes 'format' parameter
            let params_for_signing: BTreeMap<String, String> = all_params
                .iter()
                .filter(|(k, _)| k.as_str() != "format")
                .map(|(k, v)| (k.clone(), v.clone()))
                .collect();

            let sig = signature::sign_params(&params_for_signing, self.config.api_secret());
            all_params.insert("api_sig".to_string(), sig);
        }

        // Make HTTP request
        let response = if use_post {
            self.http_client
                .post(&self.base_url)
                .form(&all_params)
                .send()
                .await
                .map_err(|e| LastFmError::NetworkError(e.to_string()))?
        } else {
            self.http_client
                .get(&self.base_url)
                .query(&all_params)
                .send()
                .await
                .map_err(|e| LastFmError::NetworkError(e.to_string()))?
        };

        // Check HTTP status
        let status = response.status();
        let body = response
            .text()
            .await
            .map_err(|e| LastFmError::NetworkError(e.to_string()))?;

        // Parse JSON response
        let json: serde_json::Value =
            serde_json::from_str(&body).map_err(|e| LastFmError::ParseError(e.to_string()))?;

        // Check for Last.fm API errors
        if let Some(error_code) = json.get("error").and_then(|e| e.as_u64()) {
            let message = json
                .get("message")
                .and_then(|m| m.as_str())
                .unwrap_or("Unknown error")
                .to_string();

            return match error_code {
                4 => Err(LastFmError::AuthenticationFailed),
                9 => Err(LastFmError::InvalidSession),
                11 => Err(LastFmError::ServiceOffline),
                26 => Err(LastFmError::Suspended),
                29 => Err(LastFmError::RateLimitExceeded),
                _ => Err(LastFmError::ApiError(error_code as u32, message)),
            };
        }

        // Check HTTP status for non-200 responses without error field
        if !status.is_success() {
            return Err(LastFmError::HttpError(status.as_u16(), body));
        }

        Ok(json)
    }

    /// Get authentication token and URL
    pub(crate) async fn get_auth_url(&self) -> Result<(String, String), LastFmError> {
        let params = BTreeMap::new();
        let response = self.api_call("auth.getToken", params, None, false).await?;

        let token = response
            .get("token")
            .and_then(|t| t.as_str())
            .ok_or_else(|| LastFmError::ParseError("Missing token in response".to_string()))?
            .to_string();

        let auth_url = format!(
            "https://www.last.fm/api/auth/?api_key={}&token={}",
            self.config.api_key(),
            token
        );

        Ok((auth_url, token))
    }

    /// Exchange token for session key
    pub(crate) async fn get_session(&self, token: &str) -> Result<SessionInfo, LastFmError> {
        let mut params = BTreeMap::new();
        params.insert("token".to_string(), token.to_string());

        // Note: auth.getSession requires signature but no session key (pure Rust MD5)
        let mut params_for_signing = params.clone();
        params_for_signing.insert("method".to_string(), "auth.getSession".to_string());
        params_for_signing.insert("api_key".to_string(), self.config.api_key().to_string());

        let sig = signature::sign_params(&params_for_signing, self.config.api_secret());
        params.insert("api_sig".to_string(), sig);
        params.insert("method".to_string(), "auth.getSession".to_string());
        params.insert("api_key".to_string(), self.config.api_key().to_string());
        params.insert("format".to_string(), "json".to_string());

        // Wait for rate limiting
        self.rate_limiter.wait_if_needed().await;

        // Make request directly (auth.getSession is special - requires signature but no session key)
        let response = self
            .http_client
            .get(&self.base_url)
            .query(&params)
            .send()
            .await
            .map_err(|e| LastFmError::NetworkError(e.to_string()))?;

        let json: SessionResponse = response
            .json()
            .await
            .map_err(|e| LastFmError::ParseError(e.to_string()))?;

        Ok(json.session)
    }

    /// Get user's loved tracks (paginated)
    pub(crate) async fn get_loved_tracks(
        &self,
        user: &str,
        limit: u32,
        page: u32,
    ) -> Result<Vec<LovedTrack>, LastFmError> {
        let mut params = BTreeMap::new();
        params.insert("user".to_string(), user.to_string());
        params.insert("limit".to_string(), limit.to_string());
        params.insert("page".to_string(), page.to_string());

        let response = self
            .api_call("user.getLovedTracks", params, None, false)
            .await?;

        let loved_tracks: LovedTracksResponse =
            serde_json::from_value(response).map_err(|e| LastFmError::ParseError(e.to_string()))?;

        Ok(loved_tracks.lovedtracks.track)
    }

    /// Update "Now Playing" status
    pub(crate) async fn update_now_playing(
        &self,
        session_key: &str,
        artist: &str,
        track: &str,
        album: Option<&str>,
        duration: u32,
    ) -> Result<(), LastFmError> {
        let mut params = BTreeMap::new();
        params.insert("artist".to_string(), artist.to_string());
        params.insert("track".to_string(), track.to_string());

        if let Some(album_name) = album {
            params.insert("album".to_string(), album_name.to_string());
        }

        if duration > 0 {
            params.insert("duration".to_string(), duration.to_string());
        }

        self.api_call("track.updateNowPlaying", params, Some(session_key), true)
            .await?;

        Ok(())
    }

    /// Get track info, returning the album title if available.
    ///
    /// Calls `track.getInfo` (unauthenticated GET). Used for disambiguation
    /// when multiple library tracks match the same artist+title.
    pub(crate) async fn get_track_info(
        &self,
        artist: &str,
        track: &str,
    ) -> Result<Option<String>, LastFmError> {
        let mut params = BTreeMap::new();
        params.insert("artist".to_string(), artist.to_string());
        params.insert("track".to_string(), track.to_string());

        let response = self.api_call("track.getInfo", params, None, false).await?;

        // Extract album title: response.track.album.title
        let album = response
            .get("track")
            .and_then(|t| t.get("album"))
            .and_then(|a| a.get("title"))
            .and_then(|t| t.as_str())
            .map(|s| s.to_string());

        Ok(album)
    }

    /// Love a track on Last.fm
    pub(crate) async fn love_track(
        &self,
        session_key: &str,
        artist: &str,
        track: &str,
    ) -> Result<(), LastFmError> {
        let mut params = BTreeMap::new();
        params.insert("artist".to_string(), artist.to_string());
        params.insert("track".to_string(), track.to_string());

        self.api_call("track.love", params, Some(session_key), true)
            .await?;

        Ok(())
    }

    /// Unlove a track on Last.fm
    pub(crate) async fn unlove_track(
        &self,
        session_key: &str,
        artist: &str,
        track: &str,
    ) -> Result<(), LastFmError> {
        let mut params = BTreeMap::new();
        params.insert("artist".to_string(), artist.to_string());
        params.insert("track".to_string(), track.to_string());

        self.api_call("track.unlove", params, Some(session_key), true)
            .await?;

        Ok(())
    }

    /// Scrobble a track
    pub(crate) async fn scrobble(
        &self,
        session_key: &str,
        artist: &str,
        track: &str,
        timestamp: i64,
        album: Option<&str>,
    ) -> Result<u32, LastFmError> {
        let mut params = BTreeMap::new();
        params.insert("artist".to_string(), artist.to_string());
        params.insert("track".to_string(), track.to_string());
        params.insert("timestamp".to_string(), timestamp.to_string());

        if let Some(album_name) = album {
            params.insert("album".to_string(), album_name.to_string());
        }

        let response = self
            .api_call("track.scrobble", params, Some(session_key), true)
            .await?;

        let scrobble_response: ScrobbleApiResponse =
            serde_json::from_value(response).map_err(|e| LastFmError::ParseError(e.to_string()))?;

        Ok(scrobble_response.scrobbles.attr.accepted)
    }

    #[cfg(feature = "agent")]
    pub(crate) async fn get_similar_tracks(
        &self,
        artist: &str,
        track: &str,
        limit: u32,
    ) -> Result<Vec<SimilarTrack>, LastFmError> {
        let mut params = BTreeMap::new();
        params.insert("artist".to_string(), artist.to_string());
        params.insert("track".to_string(), track.to_string());
        params.insert("limit".to_string(), limit.to_string());
        params.insert("autocorrect".to_string(), "1".to_string());

        let response = self
            .api_call("track.getSimilar", params, None, false)
            .await?;

        let parsed: SimilarTracksResponse =
            serde_json::from_value(response).map_err(|e| LastFmError::ParseError(e.to_string()))?;

        Ok(parsed.similartracks.track)
    }

    #[cfg(feature = "agent")]
    pub(crate) async fn get_similar_artists(
        &self,
        artist: &str,
        limit: u32,
    ) -> Result<Vec<SimilarArtist>, LastFmError> {
        let mut params = BTreeMap::new();
        params.insert("artist".to_string(), artist.to_string());
        params.insert("limit".to_string(), limit.to_string());
        params.insert("autocorrect".to_string(), "1".to_string());

        let response = self
            .api_call("artist.getSimilar", params, None, false)
            .await?;

        let parsed: SimilarArtistsResponse =
            serde_json::from_value(response).map_err(|e| LastFmError::ParseError(e.to_string()))?;

        Ok(parsed.similarartists.artist)
    }

    #[cfg(feature = "agent")]
    pub(crate) async fn get_track_top_tags(
        &self,
        artist: &str,
        track: &str,
    ) -> Result<Vec<TagInfo>, LastFmError> {
        let mut params = BTreeMap::new();
        params.insert("artist".to_string(), artist.to_string());
        params.insert("track".to_string(), track.to_string());
        params.insert("autocorrect".to_string(), "1".to_string());

        let response = self
            .api_call("track.getTopTags", params, None, false)
            .await?;

        let parsed: TopTagsResponse =
            serde_json::from_value(response).map_err(|e| LastFmError::ParseError(e.to_string()))?;

        Ok(parsed.toptags.tag)
    }

    #[cfg(feature = "agent")]
    pub(crate) async fn get_top_artists_by_tag(
        &self,
        tag: &str,
        limit: u32,
    ) -> Result<Vec<TagArtist>, LastFmError> {
        let mut params = BTreeMap::new();
        params.insert("tag".to_string(), tag.to_string());
        params.insert("limit".to_string(), limit.to_string());

        let response = self
            .api_call("tag.getTopArtists", params, None, false)
            .await?;

        let parsed: TagTopArtistsResponse =
            serde_json::from_value(response).map_err(|e| LastFmError::ParseError(e.to_string()))?;

        Ok(parsed.topartists.artist)
    }

    #[cfg(feature = "agent")]
    pub(crate) async fn get_top_tracks_by_country(
        &self,
        country: &str,
        limit: u32,
    ) -> Result<Vec<GeoTrack>, LastFmError> {
        let mut params = BTreeMap::new();
        params.insert("country".to_string(), country.to_string());
        params.insert("limit".to_string(), limit.to_string());

        let response = self
            .api_call("geo.getTopTracks", params, None, false)
            .await?;

        let parsed: GeoTopTracksResponse =
            serde_json::from_value(response).map_err(|e| LastFmError::ParseError(e.to_string()))?;

        Ok(parsed.tracks.track)
    }
}

impl Default for LastFmClient {
    fn default() -> Self {
        Self::new()
    }
}

/// Last.fm API error types
#[derive(Debug, thiserror::Error)]
pub enum LastFmError {
    #[error("Last.fm API not configured (missing API key or secret)")]
    NotConfigured,

    #[error("Network error: {0}")]
    NetworkError(String),

    #[error("Failed to parse response: {0}")]
    ParseError(String),

    #[error("Authentication failed")]
    AuthenticationFailed,

    #[error("Invalid or expired session")]
    InvalidSession,

    #[error("Last.fm service is offline")]
    ServiceOffline,

    #[error("Account suspended")]
    Suspended,

    #[error("Rate limit exceeded")]
    RateLimitExceeded,

    #[error("Last.fm API error {0}: {1}")]
    ApiError(u32, String),

    #[error("HTTP error {0}: {1}")]
    HttpError(u16, String),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_client_creation() {
        let client = LastFmClient::new();
        // Client should be created successfully even without API keys
        assert!(!client.base_url.is_empty());
    }

    #[test]
    fn test_is_configured() {
        let client = LastFmClient::new();
        // In test environment, keys may or may not be set
        let _ = client.is_configured();
    }

    #[test]
    fn test_parse_track_info_with_album() {
        let json: serde_json::Value = serde_json::from_str(
            r#"{
                "track": {
                    "name": "Everlong",
                    "artist": { "name": "Foo Fighters" },
                    "album": { "title": "The Colour and the Shape", "artist": "Foo Fighters" }
                }
            }"#,
        )
        .unwrap();

        let album = json
            .get("track")
            .and_then(|t| t.get("album"))
            .and_then(|a| a.get("title"))
            .and_then(|t| t.as_str())
            .map(|s| s.to_string());

        assert_eq!(album, Some("The Colour and the Shape".to_string()));
    }

    #[test]
    fn test_parse_track_info_without_album() {
        let json: serde_json::Value = serde_json::from_str(
            r#"{
                "track": {
                    "name": "Some Track",
                    "artist": { "name": "Some Artist" }
                }
            }"#,
        )
        .unwrap();

        let album = json
            .get("track")
            .and_then(|t| t.get("album"))
            .and_then(|a| a.get("title"))
            .and_then(|t| t.as_str())
            .map(|s| s.to_string());

        assert_eq!(album, None);
    }

    #[tokio::test]
    async fn test_love_track_not_configured() {
        let client = LastFmClient {
            config: ApiKeyConfig::load(), // No keys in test env
            rate_limiter: Arc::new(RateLimiter::new()),
            http_client: reqwest::Client::new(),
            base_url: "https://ws.audioscrobbler.com/2.0/".to_string(),
        };

        if !client.is_configured() {
            let result = client.love_track("fake_key", "Artist", "Track").await;
            assert!(matches!(result, Err(LastFmError::NotConfigured)));
        }
    }

    #[tokio::test]
    async fn test_unlove_track_not_configured() {
        let client = LastFmClient {
            config: ApiKeyConfig::load(),
            rate_limiter: Arc::new(RateLimiter::new()),
            http_client: reqwest::Client::new(),
            base_url: "https://ws.audioscrobbler.com/2.0/".to_string(),
        };

        if !client.is_configured() {
            let result = client.unlove_track("fake_key", "Artist", "Track").await;
            assert!(matches!(result, Err(LastFmError::NotConfigured)));
        }
    }

    #[cfg(feature = "agent")]
    #[test]
    fn test_parse_similar_tracks_response() {
        let json: serde_json::Value = serde_json::from_str(
            r#"{
                "similartracks": {
                    "track": [
                        {"name": "Track A", "artist": {"name": "Artist A"}, "match": "0.95"},
                        {"name": "Track B", "artist": {"name": "Artist B"}, "match": "0.80"}
                    ]
                }
            }"#,
        )
        .unwrap();

        let parsed: SimilarTracksResponse = serde_json::from_value(json).unwrap();
        assert_eq!(parsed.similartracks.track.len(), 2);
        assert_eq!(parsed.similartracks.track[0].name, "Track A");
        assert_eq!(parsed.similartracks.track[0].artist.name(), "Artist A");
        assert_eq!(
            parsed.similartracks.track[0].match_score.as_deref(),
            Some("0.95")
        );
    }

    #[cfg(feature = "agent")]
    #[test]
    fn test_parse_similar_artists_response() {
        let json: serde_json::Value = serde_json::from_str(
            r#"{
                "similarartists": {
                    "artist": [
                        {"name": "Artist X", "match": "0.90"},
                        {"name": "Artist Y", "match": "0.75"}
                    ]
                }
            }"#,
        )
        .unwrap();

        let parsed: SimilarArtistsResponse = serde_json::from_value(json).unwrap();
        assert_eq!(parsed.similarartists.artist.len(), 2);
        assert_eq!(parsed.similarartists.artist[0].name, "Artist X");
    }

    #[cfg(feature = "agent")]
    #[test]
    fn test_parse_top_tags_response() {
        let json: serde_json::Value = serde_json::from_str(
            r#"{
                "toptags": {
                    "tag": [
                        {"name": "rock", "count": 100},
                        {"name": "alternative", "count": 80}
                    ]
                }
            }"#,
        )
        .unwrap();

        let parsed: TopTagsResponse = serde_json::from_value(json).unwrap();
        assert_eq!(parsed.toptags.tag.len(), 2);
        assert_eq!(parsed.toptags.tag[0].name, "rock");
        assert_eq!(parsed.toptags.tag[0].count, Some(100));
    }

    #[cfg(feature = "agent")]
    #[test]
    fn test_parse_tag_top_artists_response() {
        let json: serde_json::Value = serde_json::from_str(
            r#"{
                "topartists": {
                    "artist": [
                        {"name": "Radiohead"},
                        {"name": "Muse"}
                    ]
                }
            }"#,
        )
        .unwrap();

        let parsed: TagTopArtistsResponse = serde_json::from_value(json).unwrap();
        assert_eq!(parsed.topartists.artist.len(), 2);
        assert_eq!(parsed.topartists.artist[0].name, "Radiohead");
    }

    #[cfg(feature = "agent")]
    #[test]
    fn test_parse_geo_top_tracks_response() {
        let json: serde_json::Value = serde_json::from_str(
            r#"{
                "tracks": {
                    "track": [
                        {"name": "Bohemian Rhapsody", "artist": {"name": "Queen"}},
                        {"name": "Imagine", "artist": {"name": "John Lennon"}}
                    ]
                }
            }"#,
        )
        .unwrap();

        let parsed: GeoTopTracksResponse = serde_json::from_value(json).unwrap();
        assert_eq!(parsed.tracks.track.len(), 2);
        assert_eq!(parsed.tracks.track[0].name, "Bohemian Rhapsody");
        assert_eq!(parsed.tracks.track[0].artist.name(), "Queen");
    }

    #[cfg(feature = "agent")]
    #[test]
    fn test_parse_similar_tracks_empty() {
        let json: serde_json::Value =
            serde_json::from_str(r#"{"similartracks": {"track": []}}"#).unwrap();

        let parsed: SimilarTracksResponse = serde_json::from_value(json).unwrap();
        assert!(parsed.similartracks.track.is_empty());
    }
}
