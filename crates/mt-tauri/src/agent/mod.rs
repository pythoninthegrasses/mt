//! Conversational playlist agent powered by a local LLM (Ollama).
//!
//! Orchestrates the agent loop: build Rig agent with tools,
//! run multi-turn conversation, parse the final response into
//! a playlist, and persist it to the database.

pub mod prompt;
pub mod setup;
pub mod tools;
pub mod types;

use std::collections::HashMap;
use std::sync::Arc;

use rig::client::CompletionClient;
use rig::completion::Prompt;
use rig::providers::ollama;
use tracing::{debug, info, warn};

use prompt::{DEFAULT_MODEL, MAX_AGENT_TURNS, MAX_PLAYLIST_TRACKS, OLLAMA_BASE_URL};
use tools::{
    GetRecentlyPlayed, GetSimilarArtists, GetSimilarTracks, GetTopArtists, GetTopArtistsByTag,
    GetTopTracksByCountry, GetTrackTags, SearchLibrary,
};
use types::{AgentContext, AgentError, AgentResponse, AgentStatusResponse, ParsedPlaylist};

use crate::db::{Database, playlists};
use crate::events::{EventEmitter, PlaylistsUpdatedEvent};
use crate::lastfm::LastFmClient;

/// Generate a unique playlist name by appending a number if needed.
///
/// If the base name exists, tries "Name (2)", "Name (3)", etc.
fn generate_unique_playlist_name(
    conn: &rusqlite::Connection,
    base_name: &str,
) -> crate::db::DbResult<String> {
    // Check if base name is available
    let exists: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM playlists WHERE name = ? LIMIT 1)",
        [base_name],
        |row| row.get(0),
    )?;

    if !exists {
        return Ok(base_name.to_string());
    }

    // Find an available suffix
    for i in 2..=100 {
        let candidate = format!("{} ({})", base_name, i);
        let exists: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM playlists WHERE name = ? LIMIT 1)",
            [&candidate],
            |row| row.get(0),
        )?;
        if !exists {
            return Ok(candidate);
        }
    }

    // Fallback: append timestamp if all numbers are taken
    use std::time::{SystemTime, UNIX_EPOCH};
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    Ok(format!("{} ({})", base_name, timestamp))
}

/// Shuffle tracks to spread out same-artist tracks for a better mix.
///
/// Uses a greedy approach: repeatedly pick the track whose artist is least
/// recently used. This ensures no adjacent tracks from the same artist.
fn shuffle_spread_artists(tracks: &[(i64, String)]) -> Vec<i64> {
    if tracks.is_empty() {
        return Vec::new();
    }

    // Group track IDs by artist
    let mut by_artist: HashMap<&str, Vec<i64>> = HashMap::new();
    let mut artist_keys: HashMap<i64, &str> = HashMap::new();

    for (id, artist) in tracks {
        by_artist.entry(artist.as_str()).or_default().push(*id);
        artist_keys.insert(*id, artist.as_str());
    }

    // Shuffle each artist's tracks locally (for variety)
    for artist_tracks in by_artist.values_mut() {
        use rand::seq::SliceRandom;
        artist_tracks.shuffle(&mut rand::rng());
    }

    // Greedy selection: always pick from the artist with most remaining tracks
    // who wasn't just played
    let mut result: Vec<i64> = Vec::with_capacity(tracks.len());
    let mut last_artist: Option<&str> = None;

    while result.len() < tracks.len() {
        // Find artists with tracks remaining, excluding last_artist if possible
        let mut available: Vec<(&str, usize)> = by_artist
            .iter()
            .filter(|(_, ids)| !ids.is_empty())
            .filter(|(artist, _)| Some(**artist) != last_artist)
            .map(|(artist, ids)| (*artist, ids.len()))
            .collect();

        // If no one else available, we have to use last_artist
        if available.is_empty() {
            available = by_artist
                .iter()
                .filter(|(_, ids)| !ids.is_empty())
                .map(|(artist, ids)| (*artist, ids.len()))
                .collect();
        }

        if available.is_empty() {
            break;
        }

        // Pick artist with most remaining tracks (greedy)
        available.sort_by(|a, b| b.1.cmp(&a.1));
        let chosen_artist = available[0].0;

        // Take one track from that artist
        if let Some(ids) = by_artist.get_mut(chosen_artist) {
            if let Some(track_id) = ids.pop() {
                result.push(track_id);
                last_artist = Some(chosen_artist);
            }
        }
    }

    result
}

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

    let system_prompt = prompt::build_system_prompt(MAX_PLAYLIST_TRACKS);

    client
        .agent(DEFAULT_MODEL)
        .preamble(&system_prompt)
        .temperature(0.3)
        .max_tokens(2048)
        .additional_params(serde_json::json!({
            "top_p": 0.9,
            "repeat_penalty": 1.1,
        }))
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

    let mut seen = std::collections::HashSet::new();
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
                    .filter(|id| seen.insert(*id))
                    .take(MAX_PLAYLIST_TRACKS)
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
    app: tauri::AppHandle,
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
        .with_tool_concurrency(8)
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

    // 6. Fetch track details for the parsed IDs (to get artist names for shuffling)
    let track_details: Vec<(i64, String)> = db
        .with_conn(|conn| {
            let mut results = Vec::new();
            for id in &parsed.track_ids {
                let mut stmt = conn.prepare(
                    "SELECT id, artist FROM library WHERE id = ? AND missing = 0 LIMIT 1",
                )?;
                let mut rows = stmt.query([id])?;
                if let Some(row) = rows.next()? {
                    let track_id: i64 = row.get(0)?;
                    let artist: String = row.get(1)?;
                    results.push((track_id, artist));
                }
            }
            Ok(results)
        })
        .map_err(|e| format!("Failed to fetch track details: {e}"))?;

    if track_details.is_empty() {
        return Ok(AgentResponse::error(
            "None of the selected tracks exist in your library".to_string(),
        ));
    }

    // 7. Shuffle tracks to spread out same-artist tracks
    let shuffled_ids = shuffle_spread_artists(&track_details);
    let valid_count = shuffled_ids.len();

    info!(
        requested = parsed.track_ids.len(),
        valid = valid_count,
        "Validated and shuffled tracks"
    );

    // 8. Create the playlist in the database (with unique name handling)
    let playlist_name: String = db
        .with_conn(|conn| generate_unique_playlist_name(conn, &parsed.name))
        .map_err(|e: crate::db::DbError| format!("Failed to generate playlist name: {e}"))?;

    let playlist = db
        .with_conn(|conn| playlists::create_playlist(conn, &playlist_name))
        .map_err(|e| format!("Failed to create playlist: {e}"))?;

    let playlist = match playlist {
        Some(p) => p,
        None => {
            return Ok(AgentResponse::error(format!(
                "Playlist name '{}' already exists",
                playlist_name
            )));
        }
    };

    let added = db
        .with_conn(|conn| playlists::add_tracks_to_playlist(conn, playlist.id, &shuffled_ids, None))
        .map_err(|e| format!("Failed to add tracks to playlist: {e}"))?;

    info!(
        playlist_id = playlist.id,
        playlist_name = %playlist_name,
        track_count = added,
        "Agent playlist created"
    );

    let _ = app.emit_playlists_updated(PlaylistsUpdatedEvent::created(playlist.id));

    Ok(AgentResponse::success(
        playlist.id,
        playlist_name,
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
        let models = vec!["qwen3.5:9b".into(), "codellama:7b".into()];
        assert!(has_default_model(&models));
    }

    #[test]
    fn has_default_model_base_name_match() {
        let models = vec!["qwen3.5:latest".into(), "mistral:7b".into()];
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

    #[test]
    fn parse_dedup_removes_duplicates() {
        let text = "Playlist: Dedup Test\nTracks: 1, 2, 3, 2, 1, 4";
        let result = parse_agent_response(text).unwrap();
        assert_eq!(result.track_ids, vec![1, 2, 3, 4]);
    }

    #[test]
    fn parse_truncates_at_max() {
        let ids: Vec<String> = (1..=30).map(|i| i.to_string()).collect();
        let text = format!("Playlist: Too Many\nTracks: {}", ids.join(", "));
        let result = parse_agent_response(&text).unwrap();
        assert_eq!(result.track_ids.len(), MAX_PLAYLIST_TRACKS);
        assert_eq!(
            result.track_ids,
            (1..=25).map(|i| i as i64).collect::<Vec<_>>()
        );
    }

    // -----------------------------------------------------------------------
    // shuffle_spread_artists tests
    // -----------------------------------------------------------------------

    #[test]
    fn shuffle_spread_artists_empty_returns_empty() {
        let tracks: Vec<(i64, String)> = vec![];
        let result = shuffle_spread_artists(&tracks);
        assert!(result.is_empty());
    }

    #[test]
    fn shuffle_spread_artists_spreads_same_artist_apart() {
        // 6 tracks: 3 from Artist A, 3 from Artist B
        let tracks = vec![
            (1, "Artist A".into()),
            (2, "Artist A".into()),
            (3, "Artist A".into()),
            (4, "Artist B".into()),
            (5, "Artist B".into()),
            (6, "Artist B".into()),
        ];
        let result = shuffle_spread_artists(&tracks);
        assert_eq!(result.len(), 6);

        // Verify no two adjacent tracks have the same artist
        // First, build a map of id -> artist
        let artist_map: std::collections::HashMap<i64, &str> = tracks
            .iter()
            .map(|(id, artist)| (*id, artist.as_str()))
            .collect();

        for window in result.windows(2) {
            let artist1 = artist_map.get(&window[0]).unwrap();
            let artist2 = artist_map.get(&window[1]).unwrap();
            assert_ne!(
                artist1, artist2,
                "Adjacent tracks should not have the same artist"
            );
        }
    }

    #[test]
    fn shuffle_spread_artists_preserves_all_tracks() {
        let tracks = vec![
            (1, "Artist A".into()),
            (2, "Artist B".into()),
            (3, "Artist C".into()),
            (4, "Artist A".into()),
            (5, "Artist B".into()),
        ];
        let result = shuffle_spread_artists(&tracks);

        // All 5 track IDs should be in the result
        assert_eq!(result.len(), 5);
        let mut sorted = result.clone();
        sorted.sort();
        assert_eq!(sorted, vec![1, 2, 3, 4, 5]);
    }

    #[test]
    fn shuffle_spread_artists_single_track() {
        let tracks = vec![(42, "Solo Artist".into())];
        let result = shuffle_spread_artists(&tracks);
        assert_eq!(result, vec![42]);
    }

    #[test]
    fn shuffle_spread_artists_unique_artists_no_change_needed() {
        // All different artists - order can stay as-is (shuffled locally per artist)
        let tracks = vec![
            (1, "Artist A".into()),
            (2, "Artist B".into()),
            (3, "Artist C".into()),
            (4, "Artist D".into()),
        ];
        let result = shuffle_spread_artists(&tracks);
        assert_eq!(result.len(), 4);
        let mut sorted = result.clone();
        sorted.sort();
        assert_eq!(sorted, vec![1, 2, 3, 4]);
    }

    // -----------------------------------------------------------------------
    // generate_unique_playlist_name tests
    // -----------------------------------------------------------------------

    #[test]
    fn unique_name_returns_base_when_available() {
        let db = Database::new_in_memory().expect("in-memory db");
        let name = db
            .with_conn(|conn| generate_unique_playlist_name(conn, "My Playlist"))
            .expect("generate name");
        assert_eq!(name, "My Playlist");
    }

    #[test]
    fn unique_name_appends_number_when_exists() {
        let db = Database::new_in_memory().expect("in-memory db");

        // Create first playlist
        db.with_conn(|conn| playlists::create_playlist(conn, "Chill Vibes"))
            .expect("create first")
            .expect("first playlist created");

        // Second should get (2)
        let name2 = db
            .with_conn(|conn| generate_unique_playlist_name(conn, "Chill Vibes"))
            .expect("generate name2");
        assert_eq!(name2, "Chill Vibes (2)");

        // Create second playlist
        db.with_conn(|conn| playlists::create_playlist(conn, &name2))
            .expect("create second")
            .expect("second playlist created");

        // Third should get (3)
        let name3 = db
            .with_conn(|conn| generate_unique_playlist_name(conn, "Chill Vibes"))
            .expect("generate name3");
        assert_eq!(name3, "Chill Vibes (3)");
    }
}

#[cfg(test)]
mod evals;
