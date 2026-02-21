use std::env;

/// Last.fm API configuration
///
/// Keys are embedded at compile time via `build.rs` and `option_env!()`.
/// Runtime environment variables override embedded values (useful for development).
pub struct ApiKeyConfig {
    pub api_key: Option<String>,
    pub api_secret: Option<String>,
}

impl ApiKeyConfig {
    /// Load API configuration
    ///
    /// Priority: runtime env var > compile-time embedded value > None
    pub fn load() -> Self {
        let api_key = env::var("LASTFM_API_KEY")
            .ok()
            .or_else(|| option_env!("LASTFM_API_KEY").map(String::from));
        let api_secret = env::var("LASTFM_API_SECRET")
            .ok()
            .or_else(|| option_env!("LASTFM_API_SECRET").map(String::from));

        Self {
            api_key,
            api_secret,
        }
    }

    /// Check if API is properly configured
    pub fn is_configured(&self) -> bool {
        self.api_key.is_some() && self.api_secret.is_some()
    }

    /// Get API key (panics if not configured)
    pub fn api_key(&self) -> &str {
        self.api_key
            .as_ref()
            .expect("LASTFM_API_KEY not configured")
    }

    /// Get API secret (panics if not configured)
    pub fn api_secret(&self) -> &str {
        self.api_secret
            .as_ref()
            .expect("LASTFM_API_SECRET not configured")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_config_load() {
        // Keys may come from compile-time embedding or runtime env vars.
        // Just verify the structure is created without panicking.
        let _config = ApiKeyConfig::load();
    }

    #[test]
    fn test_is_configured() {
        let config_none = ApiKeyConfig {
            api_key: None,
            api_secret: None,
        };
        assert!(!config_none.is_configured());

        let config_partial = ApiKeyConfig {
            api_key: Some("key".to_string()),
            api_secret: None,
        };
        assert!(!config_partial.is_configured());

        let config_full = ApiKeyConfig {
            api_key: Some("key".to_string()),
            api_secret: Some("secret".to_string()),
        };
        assert!(config_full.is_configured());
    }

    #[test]
    #[should_panic(expected = "LASTFM_API_KEY not configured")]
    fn test_api_key_panics_when_missing() {
        let config = ApiKeyConfig {
            api_key: None,
            api_secret: Some("secret".to_string()),
        };
        let _ = config.api_key();
    }

    #[test]
    #[should_panic(expected = "LASTFM_API_SECRET not configured")]
    fn test_api_secret_panics_when_missing() {
        let config = ApiKeyConfig {
            api_key: Some("key".to_string()),
            api_secret: None,
        };
        let _ = config.api_secret();
    }
}
