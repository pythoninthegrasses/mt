use std::time::Duration;

use reqwest::Client;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri_plugin_store::StoreExt;
use uuid::Uuid;

use crate::plex::{DirectoryDto, IdentityRoot, SectionsRoot};

const STORE_NAME: &str = "settings.json";
const CONFIG_KEY: &str = "plex.config";

// ── Stored config shape ───────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PlexConfigStored {
    url: String,
    token: String,
    libraries: Option<Vec<String>>,
    client_identifier: String,
}

// ── Public response types ─────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum PlexConfigResponse {
    NotConfigured,
    Configured {
        url: String,
        token: String,
        libraries: Option<Vec<String>>,
        client_identifier: String,
    },
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PlexPingResponse {
    pub server_name: String,
    pub machine_id: String,
    pub version: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PlexLibrarySummary {
    pub key: String,
    pub title: String,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

pub(crate) fn mask_token(token: &str) -> String {
    if token.len() < 12 {
        return "\u{2026}".to_string();
    }
    let first4 = &token[..4];
    let last4 = &token[token.len() - 4..];
    format!("{}\u{2026}{}", first4, last4)
}

// ── Tauri commands ────────────────────────────────────────────────────────────

#[tauri::command]
pub(crate) fn plex_config_set(
    app: AppHandle,
    url: String,
    token: String,
    libraries: Option<Vec<String>>,
) -> Result<(), String> {
    let url = url.trim_end_matches('/').to_string();
    reqwest::Url::parse(&url).map_err(|e| format!("Invalid URL: {e}"))?;

    let store = app
        .store(STORE_NAME)
        .map_err(|e| format!("Failed to open settings store: {e}"))?;

    let client_identifier = store
        .get(CONFIG_KEY)
        .and_then(|v| serde_json::from_value::<PlexConfigStored>(v).ok())
        .map(|c| c.client_identifier)
        .unwrap_or_else(|| Uuid::new_v4().to_string());

    let config = PlexConfigStored {
        url,
        token,
        libraries,
        client_identifier,
    };

    let value = serde_json::to_value(&config).map_err(|e| e.to_string())?;
    store.set(CONFIG_KEY.to_string(), value);
    store
        .save()
        .map_err(|e| format!("Failed to save settings: {e}"))?;

    Ok(())
}

#[tauri::command]
pub(crate) fn plex_config_get(app: AppHandle) -> Result<PlexConfigResponse, String> {
    let store = app
        .store(STORE_NAME)
        .map_err(|e| format!("Failed to open settings store: {e}"))?;

    match store.get(CONFIG_KEY) {
        Some(val) => {
            let stored: PlexConfigStored = serde_json::from_value(val)
                .map_err(|e| format!("Failed to parse Plex config: {e}"))?;
            Ok(PlexConfigResponse::Configured {
                url: stored.url,
                token: mask_token(&stored.token),
                libraries: stored.libraries,
                client_identifier: stored.client_identifier,
            })
        }
        None => Ok(PlexConfigResponse::NotConfigured),
    }
}

#[tauri::command]
pub(crate) fn plex_config_clear(app: AppHandle) -> Result<(), String> {
    let store = app
        .store(STORE_NAME)
        .map_err(|e| format!("Failed to open settings store: {e}"))?;

    store.delete(CONFIG_KEY);
    store
        .save()
        .map_err(|e| format!("Failed to save settings: {e}"))?;

    Ok(())
}

#[tauri::command]
pub(crate) async fn plex_server_ping(
    url: String,
    token: String,
) -> Result<PlexPingResponse, String> {
    do_ping(&url, &token).await
}

#[tauri::command]
pub(crate) async fn plex_list_libraries(
    url: String,
    token: String,
) -> Result<Vec<PlexLibrarySummary>, String> {
    do_list_libraries(&url, &token).await
}

// ── Internal HTTP helpers (separated for testability) ─────────────────────────

async fn do_ping(url: &str, token: &str) -> Result<PlexPingResponse, String> {
    let base = url.trim_end_matches('/');
    let endpoint = format!("{base}/identity");

    let client = Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
        .map_err(|e| format!("Connection failed: {e}"))?;

    let response = client
        .get(&endpoint)
        .header("Accept", "application/json")
        .header("X-Plex-Product", "mt")
        .header("X-Plex-Client-Identifier", "mt-ping")
        .query(&[("X-Plex-Token", token)])
        .send()
        .await
        .map_err(|e| {
            if e.is_timeout() {
                "Server unreachable".to_string()
            } else {
                format!("Connection failed: {e}")
            }
        })?;

    let status = response.status().as_u16();
    if status == 401 {
        return Err("Invalid token".to_string());
    }
    if !(200..300).contains(&status) {
        return Err(format!("Connection failed: HTTP {status}"));
    }

    let root: IdentityRoot = response
        .json()
        .await
        .map_err(|e| format!("Connection failed: {e}"))?;

    Ok(PlexPingResponse {
        server_name: root.media_container.friendly_name,
        machine_id: root.media_container.machine_identifier,
        version: root.media_container.version,
    })
}

async fn do_list_libraries(url: &str, token: &str) -> Result<Vec<PlexLibrarySummary>, String> {
    let base = url.trim_end_matches('/');
    let endpoint = format!("{base}/library/sections");

    let client = Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| format!("Connection failed: {e}"))?;

    let response = client
        .get(&endpoint)
        .header("Accept", "application/json")
        .header("X-Plex-Product", "mt")
        .header("X-Plex-Client-Identifier", "mt-ping")
        .query(&[("X-Plex-Token", token)])
        .send()
        .await
        .map_err(|e| {
            if e.is_timeout() {
                "Server unreachable".to_string()
            } else {
                format!("Connection failed: {e}")
            }
        })?;

    let status = response.status().as_u16();
    if status == 401 {
        return Err("Invalid token".to_string());
    }
    if !(200..300).contains(&status) {
        return Err(format!("Connection failed: HTTP {status}"));
    }

    let root: SectionsRoot = response
        .json()
        .await
        .map_err(|e| format!("Connection failed: {e}"))?;

    let libs = root
        .media_container
        .directories
        .into_iter()
        .filter(|d: &DirectoryDto| d.dir_type == "artist")
        .map(|d| PlexLibrarySummary {
            key: d.key,
            title: d.title,
        })
        .collect();

    Ok(libs)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    use super::*;

    const IDENTITY: &str = include_str!("../../tests/fixtures/plex/identity.json");
    const SECTIONS: &str = include_str!("../../tests/fixtures/plex/sections.json");

    // ── mask_token ────────────────────────────────────────────────────────────

    #[test]
    fn mask_token_empty_returns_ellipsis() {
        assert_eq!(mask_token(""), "\u{2026}");
    }

    #[test]
    fn mask_token_short_returns_ellipsis() {
        assert_eq!(mask_token("short"), "\u{2026}");
        assert_eq!(mask_token("11chars_ok!"), "\u{2026}");
    }

    #[test]
    fn mask_token_twelve_chars_is_masked() {
        assert_eq!(mask_token("123456789012"), "1234\u{2026}9012");
    }

    #[test]
    fn mask_token_long() {
        assert_eq!(mask_token("abcdefghijklmnop"), "abcd\u{2026}mnop");
    }

    // ── PlexConfigStored roundtrip ────────────────────────────────────────────

    #[test]
    fn plex_config_stored_roundtrip() {
        let config = PlexConfigStored {
            url: "http://plex.example.com:32400".to_string(),
            token: "supersecrettoken".to_string(),
            libraries: Some(vec!["Music".to_string()]),
            client_identifier: "550e8400-e29b-41d4-a716-446655440000".to_string(),
        };

        let json = serde_json::to_string(&config).unwrap();
        let restored: PlexConfigStored = serde_json::from_str(&json).unwrap();

        assert_eq!(restored.url, config.url);
        assert_eq!(restored.token, config.token);
        assert_eq!(restored.libraries, config.libraries);
        assert_eq!(restored.client_identifier, config.client_identifier);
    }

    // ── PlexConfigResponse serialization ─────────────────────────────────────

    #[test]
    fn plex_config_response_not_configured_serializes() {
        let resp = PlexConfigResponse::NotConfigured;
        let json = serde_json::to_string(&resp).unwrap();
        assert!(json.contains("\"status\":\"not_configured\""));
    }

    #[test]
    fn plex_config_response_configured_serializes() {
        let resp = PlexConfigResponse::Configured {
            url: "http://plex.example.com:32400".to_string(),
            token: "abcd\u{2026}wxyz".to_string(),
            libraries: None,
            client_identifier: "test-uuid".to_string(),
        };
        let json = serde_json::to_string(&resp).unwrap();
        assert!(json.contains("\"status\":\"configured\""));
        assert!(json.contains("abcd"));
        assert!(json.contains("wxyz"));
    }

    // ── token masking preserves raw token internally ──────────────────────────

    #[test]
    fn mask_applied_on_get_not_on_stored() {
        let raw_token = "supersecrettoken";
        let stored = PlexConfigStored {
            url: "http://plex.example.com:32400".to_string(),
            token: raw_token.to_string(),
            libraries: None,
            client_identifier: "test-uuid".to_string(),
        };

        let json = serde_json::to_string(&stored).unwrap();
        let restored: PlexConfigStored = serde_json::from_str(&json).unwrap();

        assert_eq!(restored.token, raw_token);
        assert_eq!(mask_token(&restored.token), "supe\u{2026}oken");
    }

    // ── plex_server_ping wiremock tests ───────────────────────────────────────

    #[tokio::test]
    async fn ping_ok_returns_server_info() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/identity"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_string(IDENTITY)
                    .insert_header("Content-Type", "application/json"),
            )
            .mount(&server)
            .await;

        let result = do_ping(&server.uri(), "mytoken").await.unwrap();
        assert_eq!(result.machine_id, "abc123def456");
        assert_eq!(result.server_name, "My Plex Server");
        assert_eq!(result.version, "1.30.0.1234-abc456def");
    }

    #[tokio::test]
    async fn ping_401_returns_invalid_token() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/identity"))
            .respond_with(ResponseTemplate::new(401))
            .mount(&server)
            .await;

        let err = do_ping(&server.uri(), "badtoken").await.unwrap_err();
        assert_eq!(err, "Invalid token");
    }

    // ── plex_list_libraries wiremock tests ────────────────────────────────────

    #[tokio::test]
    async fn list_libraries_filters_music_sections() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/library/sections"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_string(SECTIONS)
                    .insert_header("Content-Type", "application/json"),
            )
            .mount(&server)
            .await;

        let libs = do_list_libraries(&server.uri(), "mytoken").await.unwrap();

        assert_eq!(libs.len(), 2);
        assert!(libs.iter().any(|l| l.title == "Music" && l.key == "1"));
        assert!(libs.iter().any(|l| l.title == "Classical" && l.key == "3"));
    }
}
