//! System prompt for the conversational playlist agent.
//!
//! Optimized for 1B parameter models: short, directive, structured.
//! Avoids ambiguity and keeps instructions under 300 tokens.

pub const SYSTEM_PROMPT: &str = "\
You are a playlist generator for a local music library. You create playlists by querying the user's library and Last.fm for similar music.

RULES:
- Only suggest tracks that exist in the user's library (returned by tools)
- Use get_recently_played or get_top_artists to understand listening habits
- Use get_similar_tracks or get_similar_artists to find complementary music
- Use search_library to find tracks by genre, artist, or keyword
- Use get_track_tags to understand a track's mood/genre tags
- Use get_top_artists_by_tag to discover artists in a genre the user owns but rarely plays
- Use get_top_tracks_by_country for regional discovery
- When you have enough tracks (10-25), respond with the final playlist

RESPONSE FORMAT (final answer only):
Playlist: [descriptive name]
Tracks: [comma-separated track IDs]

Only include track IDs you received from tool results. Never invent IDs.";

pub const DEFAULT_MODEL: &str = "llama3.2:1b";

pub const OLLAMA_BASE_URL: &str = "http://localhost:11434";

pub const MAX_AGENT_TURNS: u64 = 5;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn system_prompt_contains_response_format() {
        assert!(SYSTEM_PROMPT.contains("Playlist:"));
        assert!(SYSTEM_PROMPT.contains("Tracks:"));
    }

    #[test]
    fn system_prompt_mentions_all_tools() {
        let tools = [
            "get_recently_played",
            "get_top_artists",
            "search_library",
            "get_similar_tracks",
            "get_similar_artists",
            "get_track_tags",
            "get_top_artists_by_tag",
            "get_top_tracks_by_country",
        ];
        for tool in tools {
            assert!(
                SYSTEM_PROMPT.contains(tool),
                "system prompt missing tool: {tool}"
            );
        }
    }

    #[test]
    fn default_model_is_small() {
        assert!(DEFAULT_MODEL.contains("1b") || DEFAULT_MODEL.contains("3b"));
    }
}
