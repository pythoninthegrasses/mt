/// Last.fm API credentials supplied by the application.
///
/// The core never reads credentials from the environment or embeds them at build time.
#[derive(Default)]
pub struct ApiKeyConfig {
    pub api_key: Option<String>,
    pub api_secret: Option<String>,
}

impl ApiKeyConfig {
    /// Check if API is properly configured
    pub(crate) fn is_configured(&self) -> bool {
        self.api_key.is_some() && self.api_secret.is_some()
    }

    /// Get API key (panics if not configured)
    pub(crate) fn api_key(&self) -> &str {
        self.api_key
            .as_ref()
            .expect("LASTFM_API_KEY not configured")
    }

    /// Get API secret (panics if not configured)
    pub(crate) fn api_secret(&self) -> &str {
        self.api_secret
            .as_ref()
            .expect("LASTFM_API_SECRET not configured")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
