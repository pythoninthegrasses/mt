//! Types for the conversational playlist agent.
//!
//! Defines lightweight types optimized for LLM context windows
//! and the response/error types for Tauri command boundaries.

use crate::db::Database;
use crate::lastfm::client::LastFmClient;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// Lightweight track representation for LLM context (keeps tokens low).
///
/// Only includes fields the LLM needs to reason about tracks.
/// Full `Track` metadata stays in the database.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct TrackSummary {
    pub id: i64,
    pub title: String,
    pub artist: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub album: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub genre: Option<String>,
}

impl TrackSummary {
    pub fn from_track(track: &crate::db::Track) -> Self {
        Self {
            id: track.id,
            title: track.title.clone().unwrap_or_default(),
            artist: track.artist.clone().unwrap_or_default(),
            album: track.album.clone(),
            genre: track.genre.clone(),
        }
    }
}

/// Status of the agent response.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AgentStatus {
    /// Playlist created successfully
    Success,
    /// Ollama is not running or not reachable
    NoOllama,
    /// Required model is not downloaded
    NoModel,
    /// Agent encountered an error
    Error,
}

/// Response returned to the frontend from `agent_generate_playlist`.
#[derive(Debug, Clone, Serialize)]
pub struct AgentResponse {
    pub status: AgentStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub playlist_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub playlist_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub track_count: Option<usize>,
    pub message: String,
}

impl AgentResponse {
    pub fn success(playlist_id: i64, name: String, track_count: usize) -> Self {
        Self {
            status: AgentStatus::Success,
            playlist_id: Some(playlist_id),
            playlist_name: Some(name),
            track_count: Some(track_count),
            message: format!("Created playlist with {track_count} tracks"),
        }
    }

    pub fn no_ollama() -> Self {
        Self {
            status: AgentStatus::NoOllama,
            playlist_id: None,
            playlist_name: None,
            track_count: None,
            message: "Ollama is not running. Install it from https://ollama.com/download and start it, then try again.".into(),
        }
    }

    pub fn no_model(model: &str) -> Self {
        Self {
            status: AgentStatus::NoModel,
            playlist_id: None,
            playlist_name: None,
            track_count: None,
            message: format!("Model '{model}' is not available. Pull it with: ollama pull {model}"),
        }
    }

    pub fn error(message: impl Into<String>) -> Self {
        Self {
            status: AgentStatus::Error,
            playlist_id: None,
            playlist_name: None,
            track_count: None,
            message: message.into(),
        }
    }
}

/// Shared context injected into agent tools via `Arc<AgentContext>`.
///
/// Tools use the database pool for library queries and the Last.fm
/// client for similarity/discovery API calls.
pub struct AgentContext {
    pub db: Database,
    pub lastfm: LastFmClient,
}

#[derive(Debug, thiserror::Error)]
pub enum AgentError {
    #[error("database error: {0}")]
    Db(#[from] crate::db::DbError),

    #[error("last.fm error: {0}")]
    LastFm(#[from] crate::lastfm::client::LastFmError),

    #[error("ollama not reachable: {0}")]
    OllamaUnavailable(String),

    #[error("model not found: {0}")]
    ModelNotFound(String),

    #[error("agent error: {0}")]
    Agent(String),

    #[error("failed to parse agent response: {0}")]
    ParseError(String),

    #[error("http error: {0}")]
    Http(#[from] reqwest::Error),
}

/// Parsed playlist from the agent's final text response.
#[derive(Debug, Clone)]
pub struct ParsedPlaylist {
    pub name: String,
    pub track_ids: Vec<i64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AgentStatusResponse {
    pub available: bool,
    pub model: String,
    pub message: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn agent_response_success_serializes() {
        let resp = AgentResponse::success(1, "My Playlist".into(), 15);
        let json = serde_json::to_value(&resp).unwrap();
        assert_eq!(json["status"], "success");
        assert_eq!(json["playlist_id"], 1);
        assert_eq!(json["track_count"], 15);
    }

    #[test]
    fn agent_response_no_ollama_omits_none_fields() {
        let resp = AgentResponse::no_ollama();
        let json = serde_json::to_value(&resp).unwrap();
        assert_eq!(json["status"], "no_ollama");
        assert!(json.get("playlist_id").is_none());
    }

    #[test]
    fn track_summary_from_track() {
        let track = crate::db::Track {
            id: 42,
            title: Some("Everlong".into()),
            artist: Some("Foo Fighters".into()),
            album: Some("The Colour and the Shape".into()),
            genre: Some("Rock".into()),
            ..Default::default()
        };
        let summary = TrackSummary::from_track(&track);
        assert_eq!(summary.id, 42);
        assert_eq!(summary.title, "Everlong");
        assert_eq!(summary.artist, "Foo Fighters");
        assert_eq!(summary.album.as_deref(), Some("The Colour and the Shape"));
    }

    #[test]
    fn track_summary_handles_missing_fields() {
        let track = crate::db::Track::default();
        let summary = TrackSummary::from_track(&track);
        assert_eq!(summary.title, "");
        assert_eq!(summary.artist, "");
        assert!(summary.album.is_none());
    }

    #[test]
    fn agent_status_variants_serialize_snake_case() {
        let json = serde_json::to_string(&AgentStatus::NoOllama).unwrap();
        assert_eq!(json, r#""no_ollama""#);
        let json = serde_json::to_string(&AgentStatus::NoModel).unwrap();
        assert_eq!(json, r#""no_model""#);
    }
}
