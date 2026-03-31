//! Conversational playlist agent powered by a local LLM (Ollama).
//!
//! Orchestrates the agent loop: build Rig agent with tools,
//! run multi-turn conversation, parse the final response into
//! a playlist, and persist it to the database.

pub mod prompt;
pub mod types;

use types::{AgentError, AgentResponse, AgentStatusResponse, ParsedPlaylist};

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

pub async fn agent_generate_playlist(
    _prompt: String,
    _db: tauri::State<'_, crate::db::Database>,
) -> Result<AgentResponse, String> {
    Ok(AgentResponse::error("Agent not yet implemented"))
}

pub async fn agent_check_status() -> Result<AgentStatusResponse, String> {
    Ok(AgentStatusResponse {
        available: false,
        model: prompt::DEFAULT_MODEL.into(),
        message: "Agent not yet implemented".into(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
