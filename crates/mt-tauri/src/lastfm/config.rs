use mt_core::lastfm::ApiKeyConfig;
use std::env;

/// Load credentials in the crate whose build script embeds them.
pub(super) fn load() -> ApiKeyConfig {
    resolve(
        |name| env::var(name).ok(),
        option_env!("LASTFM_API_KEY"),
        option_env!("LASTFM_API_SECRET"),
    )
}

/// Runtime values override embedded values independently for each credential.
fn resolve(
    runtime: impl Fn(&str) -> Option<String>,
    embedded_key: Option<&str>,
    embedded_secret: Option<&str>,
) -> ApiKeyConfig {
    ApiKeyConfig {
        api_key: runtime("LASTFM_API_KEY").or_else(|| embedded_key.map(String::from)),
        api_secret: runtime("LASTFM_API_SECRET").or_else(|| embedded_secret.map(String::from)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_config_load() {
        let _config = load();
    }

    #[test]
    fn runtime_credentials_override_embedded_values() {
        let config = resolve(
            |name| Some(format!("runtime-{name}")),
            Some("embedded-key"),
            Some("embedded-secret"),
        );
        assert_eq!(config.api_key.as_deref(), Some("runtime-LASTFM_API_KEY"));
        assert_eq!(
            config.api_secret.as_deref(),
            Some("runtime-LASTFM_API_SECRET")
        );
    }

    #[test]
    fn missing_runtime_credentials_fall_back_independently() {
        let config = resolve(
            |name| (name == "LASTFM_API_KEY").then(|| "runtime-key".to_string()),
            Some("embedded-key"),
            Some("embedded-secret"),
        );
        assert_eq!(config.api_key.as_deref(), Some("runtime-key"));
        assert_eq!(config.api_secret.as_deref(), Some("embedded-secret"));
    }

    #[test]
    fn embedded_credentials_are_used_without_runtime_values() {
        let config = resolve(|_| None, Some("embedded-key"), Some("embedded-secret"));
        assert_eq!(config.api_key.as_deref(), Some("embedded-key"));
        assert_eq!(config.api_secret.as_deref(), Some("embedded-secret"));
    }

    #[test]
    fn absent_credentials_stay_absent() {
        let config = resolve(|_| None, None, None);
        assert!(config.api_key.is_none());
        assert!(config.api_secret.is_none());
    }

    #[test]
    fn empty_runtime_values_still_override_embedded_values() {
        let config = resolve(|_| Some(String::new()), Some("key"), Some("secret"));
        assert_eq!(config.api_key.as_deref(), Some(""));
        assert_eq!(config.api_secret.as_deref(), Some(""));
    }
}
