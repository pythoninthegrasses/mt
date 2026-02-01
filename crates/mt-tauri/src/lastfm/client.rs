use super::config::ApiKeyConfig;
use super::rate_limiter::RateLimiter;
use super::signature_ffi;
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
    pub fn new() -> Self {
        Self {
            config: ApiKeyConfig::load(),
            rate_limiter: Arc::new(RateLimiter::new()),
            http_client: reqwest::Client::new(),
            base_url: "https://ws.audioscrobbler.com/2.0/".to_string(),
        }
    }

    /// Check if API is properly configured
    pub fn is_configured(&self) -> bool {
        self.config.is_configured()
    }

    /// Make an authenticated Last.fm API call
    ///
    /// # Arguments
    /// * `method` - Last.fm API method name (e.g., "track.scrobble")
    /// * `params` - Parameters to send (excluding method, api_key, format, sk, api_sig)
    /// * `session_key` - Optional session key for authenticated calls
    /// * `use_post` - Whether to use POST instead of GET (required for write operations)
    pub async fn api_call(
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

        // Generate signature if session key is present (using Zig FFI)
        if session_key.is_some() {
            // Signature excludes 'format' parameter
            let params_for_signing: BTreeMap<String, String> = all_params
                .iter()
                .filter(|(k, _)| k.as_str() != "format")
                .map(|(k, v)| (k.clone(), v.clone()))
                .collect();

            let signature = signature_ffi::sign_params_ffi(&params_for_signing, self.config.api_secret())
                .ok_or_else(|| LastFmError::ParseError("Failed to generate signature".to_string()))?;
            all_params.insert("api_sig".to_string(), signature);
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
        let json: serde_json::Value = serde_json::from_str(&body)
            .map_err(|e| LastFmError::ParseError(e.to_string()))?;

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
    pub async fn get_auth_url(&self) -> Result<(String, String), LastFmError> {
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
    pub async fn get_session(&self, token: &str) -> Result<SessionInfo, LastFmError> {
        let mut params = BTreeMap::new();
        params.insert("token".to_string(), token.to_string());

        // Note: auth.getSession requires signature but no session key (using Zig FFI)
        let mut params_for_signing = params.clone();
        params_for_signing.insert("method".to_string(), "auth.getSession".to_string());
        params_for_signing.insert("api_key".to_string(), self.config.api_key().to_string());

        let signature = signature_ffi::sign_params_ffi(&params_for_signing, self.config.api_secret())
            .ok_or_else(|| LastFmError::ParseError("Failed to generate signature".to_string()))?;

        params.insert("api_sig".to_string(), signature);
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
    pub async fn get_loved_tracks(
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

        let loved_tracks: LovedTracksResponse = serde_json::from_value(response)
            .map_err(|e| LastFmError::ParseError(e.to_string()))?;

        Ok(loved_tracks.lovedtracks.track)
    }

    /// Update "Now Playing" status
    pub async fn update_now_playing(
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

    /// Scrobble a track
    pub async fn scrobble(
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

        let scrobble_response: ScrobbleApiResponse = serde_json::from_value(response)
            .map_err(|e| LastFmError::ParseError(e.to_string()))?;

        Ok(scrobble_response.scrobbles.attr.accepted)
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
}
