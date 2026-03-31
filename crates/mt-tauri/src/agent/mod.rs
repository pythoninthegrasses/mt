//! Conversational playlist agent powered by a local LLM (Ollama).
//!
//! Orchestrates the agent loop: build Rig agent with tools,
//! run multi-turn conversation, parse the final response into
//! a playlist, and persist it to the database.

pub mod prompt;
pub mod setup;
pub mod tools;
pub mod types;

use std::sync::Arc;

use rig::client::CompletionClient;
use rig::completion::Prompt;
use rig::providers::ollama;
use tracing::{debug, info, warn};

use prompt::{DEFAULT_MODEL, MAX_AGENT_TURNS, OLLAMA_BASE_URL, SYSTEM_PROMPT};
use tools::{
    GetRecentlyPlayed, GetSimilarArtists, GetSimilarTracks, GetTopArtists, GetTopArtistsByTag,
    GetTopTracksByCountry, GetTrackTags, SearchLibrary,
};
use types::{AgentContext, AgentError, AgentResponse, AgentStatusResponse, ParsedPlaylist};

use crate::db::{Database, playlists};
use crate::lastfm::LastFmClient;

/// Parse model names from Ollama's `/api/tags` JSON response.
///
/// Expected format: `{ "models": [{ "name": "llama3.2:1b", ... }, ...] }`
fn parse_model_names(tags_response: &serde_json::Value) -> Vec<String> {
    tags_response
        .get("models")
        .and_then(|m| m.as_array())
        .map(|models| {
            models
                .iter()
                .filter_map(|m| m.get("name").and_then(|n| n.as_str()).map(String::from))
                .collect()
        })
        .unwrap_or_default()
}

/// Check if Ollama is reachable and return available model names.
pub(crate) async fn check_ollama(base_url: &str) -> Result<Vec<String>, AgentError> {
    let url = format!("{base_url}/api/tags");
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(AgentError::Http)?;

    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| AgentError::OllamaUnavailable(e.to_string()))?;

    let body: serde_json::Value = response
        .json()
        .await
        .map_err(|e| AgentError::OllamaUnavailable(format!("invalid response: {e}")))?;

    Ok(parse_model_names(&body))
}

/// Build a Rig agent with all playlist tools and the system prompt.
pub(crate) fn build_agent(
    ctx: Arc<AgentContext>,
    base_url: &str,
) -> rig::agent::Agent<ollama::CompletionModel<reqwest::Client>> {
    let client = ollama::Client::builder()
        .api_key(rig::client::Nothing)
        .base_url(base_url)
        .build()
        .expect("build Ollama client");

    client
        .agent(DEFAULT_MODEL)
        .preamble(SYSTEM_PROMPT)
        .tool(GetRecentlyPlayed {
            ctx: Arc::clone(&ctx),
        })
        .tool(GetTopArtists {
            ctx: Arc::clone(&ctx),
        })
        .tool(SearchLibrary {
            ctx: Arc::clone(&ctx),
        })
        .tool(GetSimilarTracks {
            ctx: Arc::clone(&ctx),
        })
        .tool(GetSimilarArtists {
            ctx: Arc::clone(&ctx),
        })
        .tool(GetTrackTags {
            ctx: Arc::clone(&ctx),
        })
        .tool(GetTopArtistsByTag {
            ctx: Arc::clone(&ctx),
        })
        .tool(GetTopTracksByCountry { ctx })
        .build()
}

pub fn parse_agent_response(text: &str) -> Result<ParsedPlaylist, AgentError> {
    let name = text
        .lines()
        .find_map(|line| line.strip_prefix("Playlist:").map(|s| s.trim().to_string()))
        .ok_or_else(|| AgentError::ParseError("missing 'Playlist:' line".into()))?;

    if name.is_empty() {
        return Err(AgentError::ParseError("playlist name is empty".into()));
    }

    let track_ids = text
        .lines()
        .find_map(|line| {
            line.strip_prefix("Tracks:").map(|s| {
                s.split(',')
                    .map(str::trim)
                    .filter(|t| !t.is_empty())
                    .filter_map(|t| {
                        // Strip brackets: "[42" -> "42", "99]" -> "99"
                        let cleaned = t.trim_start_matches('[').trim_end_matches(']');
                        cleaned.parse::<i64>().ok()
                    })
                    .collect::<Vec<_>>()
            })
        })
        .ok_or_else(|| AgentError::ParseError("missing 'Tracks:' line".into()))?;

    if track_ids.is_empty() {
        return Err(AgentError::ParseError("no valid track IDs found".into()));
    }

    Ok(ParsedPlaylist { name, track_ids })
}

/// Check whether `models` contains `DEFAULT_MODEL` (exact or base-name match).
///
/// Matches `"llama3.2:1b"` against `"llama3.2:1b"` (exact) or `"llama3.2:latest"`
/// (same base name before the colon).
fn has_default_model(models: &[String]) -> bool {
    let base = DEFAULT_MODEL.split(':').next().unwrap_or(DEFAULT_MODEL);
    models
        .iter()
        .any(|m| m == DEFAULT_MODEL || m.starts_with(&format!("{base}:")))
}

/// Generate a playlist from a natural language prompt using the local LLM.
///
/// Flow: health check → build agent → prompt (multi-turn) → parse → create playlist.
pub async fn agent_generate_playlist(
    prompt: String,
    db: tauri::State<'_, Database>,
) -> Result<AgentResponse, String> {
    let models = match check_ollama(OLLAMA_BASE_URL).await {
        Ok(m) => m,
        Err(_) => return Ok(AgentResponse::no_ollama()),
    };

    if !has_default_model(&models) {
        return Ok(AgentResponse::no_model(DEFAULT_MODEL));
    }

    info!(prompt = %prompt, "Starting agent playlist generation");

    // 3. Build agent with tools
    let lastfm = LastFmClient::new();
    let ctx = Arc::new(AgentContext {
        db: db.inner().clone(),
        lastfm,
    });
    let agent = build_agent(ctx, OLLAMA_BASE_URL);

    // 4. Run the agent: multi-turn tool-calling loop
    let response_text = agent
        .prompt(&prompt)
        .multi_turn(MAX_AGENT_TURNS as usize)
        .await
        .map_err(|e| {
            warn!(error = %e, "Agent execution failed");
            format!("Agent error: {e}")
        })?;

    debug!(response = %response_text, "Agent response received");

    // 5. Parse the agent's final response
    let parsed = match parse_agent_response(&response_text) {
        Ok(p) => p,
        Err(e) => {
            warn!(error = %e, response = %response_text, "Failed to parse agent response");
            return Ok(AgentResponse::error(format!(
                "Could not parse playlist from agent response: {e}\n\nRaw response:\n{response_text}"
            )));
        }
    };

    // 6. Create the playlist in the database
    let playlist = db
        .with_conn(|conn| playlists::create_playlist(conn, &parsed.name))
        .map_err(|e| format!("Failed to create playlist: {e}"))?;

    let playlist = match playlist {
        Some(p) => p,
        None => {
            return Ok(AgentResponse::error(format!(
                "Playlist name '{}' already exists",
                parsed.name
            )));
        }
    };

    let added = db
        .with_conn(|conn| {
            playlists::add_tracks_to_playlist(conn, playlist.id, &parsed.track_ids, None)
        })
        .map_err(|e| format!("Failed to add tracks to playlist: {e}"))?;

    info!(
        playlist_id = playlist.id,
        playlist_name = %parsed.name,
        track_count = added,
        "Agent playlist created"
    );

    Ok(AgentResponse::success(
        playlist.id,
        parsed.name,
        added as usize,
    ))
}

/// Check if the agent is available (Ollama running + model downloaded).
pub async fn agent_check_status() -> Result<AgentStatusResponse, String> {
    match check_ollama(OLLAMA_BASE_URL).await {
        Ok(models) => {
            if has_default_model(&models) {
                Ok(AgentStatusResponse {
                    available: true,
                    model: DEFAULT_MODEL.into(),
                    message: "Agent is ready".into(),
                })
            } else {
                Ok(AgentStatusResponse {
                    available: false,
                    model: DEFAULT_MODEL.into(),
                    message: format!(
                        "Model '{}' is not installed. Run: ollama pull {}",
                        DEFAULT_MODEL, DEFAULT_MODEL
                    ),
                })
            }
        }
        Err(_) => Ok(AgentStatusResponse {
            available: false,
            model: DEFAULT_MODEL.into(),
            message:
                "Ollama is not running. Install from https://ollama.com/download and start it."
                    .into(),
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // -----------------------------------------------------------------------
    // parse_agent_response tests (existing)
    // -----------------------------------------------------------------------

    #[test]
    fn parse_valid_response() {
        let text = "Playlist: Chill Vibes\nTracks: 1, 2, 3, 42";
        let result = parse_agent_response(text).unwrap();
        assert_eq!(result.name, "Chill Vibes");
        assert_eq!(result.track_ids, vec![1, 2, 3, 42]);
    }

    #[test]
    fn parse_response_with_brackets() {
        let text = "Playlist: Rock Mix\nTracks: [10, 20, 30]";
        let result = parse_agent_response(text).unwrap();
        assert_eq!(result.name, "Rock Mix");
        assert_eq!(result.track_ids, vec![10, 20, 30]);
    }

    #[test]
    fn parse_response_with_preamble() {
        let text =
            "Here is your playlist!\n\nPlaylist: Late Night Jazz\nTracks: 5, 8, 13\n\nEnjoy!";
        let result = parse_agent_response(text).unwrap();
        assert_eq!(result.name, "Late Night Jazz");
        assert_eq!(result.track_ids, vec![5, 8, 13]);
    }

    #[test]
    fn parse_missing_playlist_line() {
        let text = "Tracks: 1, 2, 3";
        let err = parse_agent_response(text).unwrap_err();
        assert!(err.to_string().contains("missing 'Playlist:'"));
    }

    #[test]
    fn parse_missing_tracks_line() {
        let text = "Playlist: Test";
        let err = parse_agent_response(text).unwrap_err();
        assert!(err.to_string().contains("missing 'Tracks:'"));
    }

    #[test]
    fn parse_empty_playlist_name() {
        let text = "Playlist:   \nTracks: 1, 2";
        let err = parse_agent_response(text).unwrap_err();
        assert!(err.to_string().contains("empty"));
    }

    #[test]
    fn parse_no_valid_ids() {
        let text = "Playlist: Bad IDs\nTracks: abc, def";
        let err = parse_agent_response(text).unwrap_err();
        assert!(err.to_string().contains("no valid track IDs"));
    }

    #[test]
    fn parse_mixed_valid_and_invalid_ids() {
        let text = "Playlist: Partial\nTracks: 1, bad, 3, nope, 5";
        let result = parse_agent_response(text).unwrap();
        assert_eq!(result.track_ids, vec![1, 3, 5]);
    }

    // -----------------------------------------------------------------------
    // parse_model_names tests (Phase 4)
    // -----------------------------------------------------------------------

    #[test]
    fn parse_model_names_with_models() {
        let json = serde_json::json!({
            "models": [
                { "name": "llama3.2:1b", "size": 1234 },
                { "name": "codellama:7b", "size": 5678 },
                { "name": "mistral:latest", "size": 9999 }
            ]
        });
        let names = parse_model_names(&json);
        assert_eq!(names, vec!["llama3.2:1b", "codellama:7b", "mistral:latest"]);
    }

    #[test]
    fn parse_model_names_empty_list() {
        let json = serde_json::json!({ "models": [] });
        let names = parse_model_names(&json);
        assert!(names.is_empty());
    }

    #[test]
    fn parse_model_names_missing_field() {
        let json = serde_json::json!({});
        let names = parse_model_names(&json);
        assert!(names.is_empty());
    }

    #[test]
    fn parse_model_names_malformed_entries() {
        let json = serde_json::json!({
            "models": [
                { "name": "valid:model" },
                { "no_name": true },
                { "name": 42 }
            ]
        });
        let names = parse_model_names(&json);
        // Only the entry with a string "name" field is extracted
        assert_eq!(names, vec!["valid:model"]);
    }

    // -----------------------------------------------------------------------
    // build_agent smoke test (Phase 4)
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn build_agent_constructs_successfully() {
        let db = Database::new_in_memory().expect("in-memory db");
        let lastfm = LastFmClient::new_unconfigured();
        let ctx = Arc::new(AgentContext { db, lastfm });
        let _agent = build_agent(ctx, OLLAMA_BASE_URL);
    }

    // -----------------------------------------------------------------------
    // has_default_model tests (Phase 4)
    // -----------------------------------------------------------------------

    #[test]
    fn has_default_model_exact_match() {
        let models = vec!["llama3.2:1b".into(), "codellama:7b".into()];
        assert!(has_default_model(&models));
    }

    #[test]
    fn has_default_model_base_name_match() {
        let models = vec!["llama3.2:latest".into(), "mistral:7b".into()];
        assert!(has_default_model(&models));
    }

    #[test]
    fn has_default_model_no_match() {
        let models = vec!["codellama:7b".into(), "mistral:latest".into()];
        assert!(!has_default_model(&models));
    }

    #[test]
    fn has_default_model_empty() {
        let models: Vec<String> = vec![];
        assert!(!has_default_model(&models));
    }
}

#[cfg(test)]
mod evals;
