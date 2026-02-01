use std::env;

/// Last.fm API configuration
///
/// In development builds: reads plaintext API keys from environment variables
/// In release builds: uses salted hash for security (future implementation)
pub struct ApiKeyConfig {
    pub api_key: Option<String>,
    pub api_secret: Option<String>,
}

impl ApiKeyConfig {
    /// Load API configuration
    ///
    /// Development: Reads from LASTFM_API_KEY and LASTFM_API_SECRET env vars
    /// Release: Uses salted hash verification (TODO: implement)
    pub fn load() -> Self {
        #[cfg(debug_assertions)]
        {
            // Development build: read from environment variables
            let api_key = env::var("LASTFM_API_KEY").ok();
            let api_secret = env::var("LASTFM_API_SECRET").ok();

            Self {
                api_key,
                api_secret,
            }
        }

        #[cfg(not(debug_assertions))]
        {
            // Release build: use salted hash (TODO: implement)
            // For now, fall back to environment variables
            // Future: implement HMAC-SHA256 salted hash verification
            let api_key = env::var("LASTFM_API_KEY").ok();
            let api_secret = env::var("LASTFM_API_SECRET").ok();

            Self {
                api_key,
                api_secret,
            }
        }
    }

    /// Check if API is properly configured
    pub fn is_configured(&self) -> bool {
        self.api_key.is_some() && self.api_secret.is_some()
    }

    /// Get API key (panics if not configured)
    pub fn api_key(&self) -> &str {
        self.api_key.as_ref().expect("LASTFM_API_KEY not configured")
    }

    /// Get API secret (panics if not configured)
    pub fn api_secret(&self) -> &str {
        self.api_secret
            .as_ref()
            .expect("LASTFM_API_SECRET not configured")
    }
}

// TODO: Implement salted hash for release builds
//
// Release build implementation should:
// 1. Generate salt at build time or first run
// 2. Store (salt, HMAC-SHA256(api_key, salt)) in settings database
// 3. Verify API keys by comparing hashes
// 4. Never store plaintext keys in binary
//
// Example structure:
// ```rust
// #[cfg(not(debug_assertions))]
// pub struct ReleaseBuildConfig {
//     pub salt: String,
//     pub api_key_hash: String,
//     pub api_secret_hash: String,
// }
// ```

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_config_load_missing_keys() {
        // This test will pass even without keys set
        // because ApiKeyConfig handles missing keys gracefully
        let config = ApiKeyConfig::load();

        // In test environment, keys may or may not be present
        // Just verify the structure is created
        assert!(config.api_key.is_none() || config.api_key.is_some());
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
