use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Last.fm settings response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LastfmSettings {
    pub enabled: bool,
    pub username: Option<String>,
    pub authenticated: bool,
    pub configured: bool,
    pub scrobble_threshold: u8,
}

/// Request to update Last.fm settings
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LastfmSettingsUpdate {
    pub enabled: Option<bool>,
    pub scrobble_threshold: Option<u8>,
}

/// Response from updating settings
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LastfmSettingsUpdateResponse {
    pub updated: Vec<String>,
}

/// Authentication URL response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthUrlResponse {
    pub auth_url: String,
    pub token: String,
}

/// Authentication callback response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthCallbackResponse {
    pub status: String,
    pub username: String,
    pub message: String,
}

/// Disconnect response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DisconnectResponse {
    pub status: String,
    pub message: String,
}

/// Now playing request
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NowPlayingRequest {
    pub artist: String,
    pub track: String,
    pub album: Option<String>,
    pub duration: u32,
}

/// Scrobble request
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScrobbleRequest {
    pub artist: String,
    pub track: String,
    pub album: Option<String>,
    pub timestamp: i64,
    pub duration: u32,
    pub played_time: u32,
}

/// Scrobble response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScrobbleResponse {
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

/// Queue status response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueueStatusResponse {
    pub queued_scrobbles: usize,
}

/// Queue retry response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueueRetryResponse {
    pub status: String,
    pub remaining_queued: usize,
}

/// Import loved tracks response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportLovedTracksResponse {
    pub status: String,
    pub total_loved_tracks: usize,
    pub imported_count: usize,
    pub message: String,
}

/// Last.fm API token response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenResponse {
    pub token: String,
}

/// Last.fm API session response (from auth.getSession)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionResponse {
    pub session: SessionInfo,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionInfo {
    pub name: String,
    pub key: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subscriber: Option<u8>,
}

/// Last.fm API error response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ErrorResponse {
    pub error: u32,
    pub message: String,
}

/// Loved tracks response from Last.fm API
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LovedTracksResponse {
    pub lovedtracks: LovedTracksContainer,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LovedTracksContainer {
    pub track: Vec<LovedTrack>,
    #[serde(rename = "@attr")]
    pub attr: Option<LovedTracksAttr>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LovedTracksAttr {
    pub user: String,
    #[serde(rename = "totalPages")]
    pub total_pages: String,
    pub page: String,
    #[serde(rename = "perPage")]
    pub per_page: String,
    pub total: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LovedTrack {
    pub name: String,
    pub artist: ArtistInfo,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ArtistInfo {
    Simple(String),
    Detailed { name: String },
}

impl ArtistInfo {
    pub fn name(&self) -> &str {
        match self {
            ArtistInfo::Simple(name) => name,
            ArtistInfo::Detailed { name } => name,
        }
    }
}

/// Scrobble response from Last.fm API
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScrobbleApiResponse {
    pub scrobbles: ScrobblesContainer,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScrobblesContainer {
    #[serde(rename = "@attr")]
    pub attr: ScrobblesAttr,
    pub scrobble: Option<HashMap<String, serde_json::Value>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScrobblesAttr {
    pub accepted: u32,
    pub ignored: u32,
}

/// Now playing response from Last.fm API
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NowPlayingApiResponse {
    pub nowplaying: HashMap<String, serde_json::Value>,
}

#[cfg(test)]
mod tests {
    use super::*;

    // ==================== LastfmSettings Tests ====================

    #[test]
    fn test_lastfm_settings_serialization() {
        let settings = LastfmSettings {
            enabled: true,
            username: Some("testuser".to_string()),
            authenticated: true,
            configured: true,
            scrobble_threshold: 50,
        };

        let json = serde_json::to_string(&settings).unwrap();
        assert!(json.contains("\"enabled\":true"));
        assert!(json.contains("\"username\":\"testuser\""));
        assert!(json.contains("\"scrobble_threshold\":50"));
    }

    #[test]
    fn test_lastfm_settings_deserialization() {
        let json = r#"{"enabled":true,"username":"testuser","authenticated":true,"configured":true,"scrobble_threshold":50}"#;
        let settings: LastfmSettings = serde_json::from_str(json).unwrap();

        assert!(settings.enabled);
        assert_eq!(settings.username, Some("testuser".to_string()));
        assert!(settings.authenticated);
        assert_eq!(settings.scrobble_threshold, 50);
    }

    #[test]
    fn test_lastfm_settings_without_username() {
        let settings = LastfmSettings {
            enabled: false,
            username: None,
            authenticated: false,
            configured: false,
            scrobble_threshold: 50,
        };

        let json = serde_json::to_string(&settings).unwrap();
        assert!(json.contains("\"username\":null"));
    }

    // ==================== LastfmSettingsUpdate Tests ====================

    #[test]
    fn test_settings_update_serialization() {
        let update = LastfmSettingsUpdate {
            enabled: Some(true),
            scrobble_threshold: Some(75),
        };

        let json = serde_json::to_string(&update).unwrap();
        assert!(json.contains("\"enabled\":true"));
        assert!(json.contains("\"scrobble_threshold\":75"));
    }

    #[test]
    fn test_settings_update_partial() {
        let update = LastfmSettingsUpdate {
            enabled: Some(false),
            scrobble_threshold: None,
        };

        let json = serde_json::to_string(&update).unwrap();
        assert!(json.contains("\"enabled\":false"));
    }

    // ==================== AuthUrlResponse Tests ====================

    #[test]
    fn test_auth_url_response() {
        let response = AuthUrlResponse {
            auth_url: "https://last.fm/api/auth".to_string(),
            token: "abc123".to_string(),
        };

        let json = serde_json::to_string(&response).unwrap();
        assert!(json.contains("\"auth_url\":\"https://last.fm/api/auth\""));
        assert!(json.contains("\"token\":\"abc123\""));
    }

    // ==================== AuthCallbackResponse Tests ====================

    #[test]
    fn test_auth_callback_response() {
        let response = AuthCallbackResponse {
            status: "success".to_string(),
            username: "testuser".to_string(),
            message: "Authenticated successfully".to_string(),
        };

        let json = serde_json::to_string(&response).unwrap();
        assert!(json.contains("\"status\":\"success\""));
        assert!(json.contains("\"username\":\"testuser\""));
    }

    // ==================== ScrobbleRequest Tests ====================

    #[test]
    fn test_scrobble_request_serialization() {
        let request = ScrobbleRequest {
            artist: "Test Artist".to_string(),
            track: "Test Track".to_string(),
            album: Some("Test Album".to_string()),
            timestamp: 1704067200,
            duration: 180,
            played_time: 90,
        };

        let json = serde_json::to_string(&request).unwrap();
        assert!(json.contains("\"artist\":\"Test Artist\""));
        assert!(json.contains("\"duration\":180"));
        assert!(json.contains("\"played_time\":90"));
    }

    #[test]
    fn test_scrobble_request_without_album() {
        let request = ScrobbleRequest {
            artist: "Artist".to_string(),
            track: "Track".to_string(),
            album: None,
            timestamp: 1704067200,
            duration: 120,
            played_time: 60,
        };

        let json = serde_json::to_string(&request).unwrap();
        assert!(json.contains("\"album\":null"));
    }

    // ==================== ScrobbleResponse Tests ====================

    #[test]
    fn test_scrobble_response_success() {
        let response = ScrobbleResponse {
            status: "success".to_string(),
            message: None,
        };

        let json = serde_json::to_string(&response).unwrap();
        assert!(json.contains("\"status\":\"success\""));
        assert!(!json.contains("message")); // Should skip null message
    }

    #[test]
    fn test_scrobble_response_with_message() {
        let response = ScrobbleResponse {
            status: "failed".to_string(),
            message: Some("Rate limited".to_string()),
        };

        let json = serde_json::to_string(&response).unwrap();
        assert!(json.contains("\"status\":\"failed\""));
        assert!(json.contains("\"message\":\"Rate limited\""));
    }

    // ==================== ArtistInfo Tests ====================

    #[test]
    fn test_artist_info_simple() {
        let artist = ArtistInfo::Simple("Simple Artist".to_string());
        assert_eq!(artist.name(), "Simple Artist");
    }

    #[test]
    fn test_artist_info_detailed() {
        let artist = ArtistInfo::Detailed {
            name: "Detailed Artist".to_string(),
        };
        assert_eq!(artist.name(), "Detailed Artist");
    }

    #[test]
    fn test_artist_info_deserialization_simple() {
        let json = r#""Simple Name""#;
        let artist: ArtistInfo = serde_json::from_str(json).unwrap();
        assert_eq!(artist.name(), "Simple Name");
    }

    #[test]
    fn test_artist_info_deserialization_detailed() {
        let json = r#"{"name":"Detailed Name"}"#;
        let artist: ArtistInfo = serde_json::from_str(json).unwrap();
        assert_eq!(artist.name(), "Detailed Name");
    }

    // ==================== SessionResponse Tests ====================

    #[test]
    fn test_session_response() {
        let response = SessionResponse {
            session: SessionInfo {
                name: "username".to_string(),
                key: "session_key_123".to_string(),
                subscriber: Some(1),
            },
        };

        let json = serde_json::to_string(&response).unwrap();
        assert!(json.contains("\"name\":\"username\""));
        assert!(json.contains("\"key\":\"session_key_123\""));
    }

    #[test]
    fn test_session_info_without_subscriber() {
        let info = SessionInfo {
            name: "user".to_string(),
            key: "key".to_string(),
            subscriber: None,
        };

        let json = serde_json::to_string(&info).unwrap();
        assert!(!json.contains("subscriber")); // Should skip null
    }

    // ==================== ErrorResponse Tests ====================

    #[test]
    fn test_error_response() {
        let error = ErrorResponse {
            error: 4,
            message: "Authentication failed".to_string(),
        };

        let json = serde_json::to_string(&error).unwrap();
        assert!(json.contains("\"error\":4"));
        assert!(json.contains("\"message\":\"Authentication failed\""));
    }

    // ==================== NowPlayingRequest Tests ====================

    #[test]
    fn test_now_playing_request() {
        let request = NowPlayingRequest {
            artist: "Artist".to_string(),
            track: "Track".to_string(),
            album: Some("Album".to_string()),
            duration: 240,
        };

        let json = serde_json::to_string(&request).unwrap();
        assert!(json.contains("\"artist\":\"Artist\""));
        assert!(json.contains("\"duration\":240"));
    }

    // ==================== LovedTracksResponse Tests ====================

    #[test]
    fn test_loved_tracks_response() {
        let track = LovedTrack {
            name: "Loved Song".to_string(),
            artist: ArtistInfo::Simple("Artist Name".to_string()),
        };

        let json = serde_json::to_string(&track).unwrap();
        assert!(json.contains("\"name\":\"Loved Song\""));
    }

    #[test]
    fn test_loved_tracks_attr() {
        let attr = LovedTracksAttr {
            user: "testuser".to_string(),
            total_pages: "10".to_string(),
            page: "1".to_string(),
            per_page: "50".to_string(),
            total: "500".to_string(),
        };

        let json = serde_json::to_string(&attr).unwrap();
        assert!(json.contains("\"user\":\"testuser\""));
        assert!(json.contains("\"totalPages\":\"10\""));
    }

    // ==================== QueueStatusResponse Tests ====================

    #[test]
    fn test_queue_status_response() {
        let response = QueueStatusResponse {
            queued_scrobbles: 5,
        };

        let json = serde_json::to_string(&response).unwrap();
        assert!(json.contains("\"queued_scrobbles\":5"));
    }

    // ==================== ImportLovedTracksResponse Tests ====================

    #[test]
    fn test_import_loved_tracks_response() {
        let response = ImportLovedTracksResponse {
            status: "success".to_string(),
            total_loved_tracks: 100,
            imported_count: 95,
            message: "Imported 95 tracks".to_string(),
        };

        let json = serde_json::to_string(&response).unwrap();
        assert!(json.contains("\"total_loved_tracks\":100"));
        assert!(json.contains("\"imported_count\":95"));
    }

    // ==================== Clone and Debug Tests ====================

    #[test]
    fn test_structs_are_clone_and_debug() {
        let settings = LastfmSettings {
            enabled: true,
            username: None,
            authenticated: false,
            configured: false,
            scrobble_threshold: 50,
        };
        let _ = settings.clone();
        let _ = format!("{:?}", settings);

        let error = ErrorResponse {
            error: 1,
            message: "test".to_string(),
        };
        let _ = error.clone();
        let _ = format!("{:?}", error);
    }
}
