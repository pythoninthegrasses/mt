//! Rig `Tool` implementations for the conversational playlist agent.
//!
//! Each tool wraps a database or Last.fm query behind the Rig `Tool` trait,
//! giving the LLM structured access to the user's music library and
//! discovery APIs. Tools receive shared state via `Arc<AgentContext>`.
//!
//! Local-only tools (no network):
//! - `GetRecentlyPlayed` — recently played tracks
//! - `GetTopArtists` — most-played artists by date range
//! - `SearchLibrary` — search tracks by keyword, artist, or album
//!
//! Last.fm discovery tools (network + local cross-reference):
//! - `GetSimilarTracks` — find similar tracks, cross-referenced with library
//! - `GetSimilarArtists` — find similar artists, return library matches
//! - `GetTrackTags` — get mood/genre tags for a track
//! - `GetTopArtistsByTag` — top artists in a genre, cross-referenced
//! - `GetTopTracksByCountry` — trending tracks by country, cross-referenced

use std::sync::Arc;

use rig::completion::ToolDefinition;
use rig::tool::Tool;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use super::types::{AgentContext, AgentError, TrackSummary};
use crate::db::{favorites, library, library::LibraryQuery, models::StatsDateRange, stats};

// ---------------------------------------------------------------------------
// GetRecentlyPlayed
// ---------------------------------------------------------------------------

/// Args for `get_recently_played` tool.
#[derive(Debug, Deserialize, JsonSchema)]
pub struct GetRecentlyPlayedArgs {
    /// Number of days to look back (default: 7)
    pub days: Option<i64>,
    /// Maximum number of tracks to return (default: 20)
    pub limit: Option<i64>,
}

/// Returns tracks the user played within the last N days.
pub struct GetRecentlyPlayed {
    pub(crate) ctx: Arc<AgentContext>,
}

impl Tool for GetRecentlyPlayed {
    const NAME: &'static str = "get_recently_played";
    type Error = AgentError;
    type Args = GetRecentlyPlayedArgs;
    type Output = Vec<TrackSummary>;

    async fn definition(&self, _prompt: String) -> ToolDefinition {
        ToolDefinition {
            name: Self::NAME.into(),
            description:
                "Get tracks the user played recently. Use to understand current listening habits."
                    .into(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "days": { "type": "integer", "description": "Number of days to look back (default: 7)" },
                    "limit": { "type": "integer", "description": "Max tracks to return (default: 20)" }
                }
            }),
        }
    }

    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        let days = args.days.unwrap_or(7);
        let limit = args.limit.unwrap_or(20);
        let tracks = self
            .ctx
            .db
            .with_conn(|conn| favorites::get_recently_played(conn, days, limit))?;
        Ok(tracks.iter().map(TrackSummary::from_track).collect())
    }
}

// ---------------------------------------------------------------------------
// GetTopArtists
// ---------------------------------------------------------------------------

/// Args for `get_top_artists` tool.
#[derive(Debug, Deserialize, JsonSchema)]
pub struct GetTopArtistsArgs {
    /// Time range: "all_time", "7days", "30days", "90days", "180days", "365days" (default: "30days")
    pub range: Option<String>,
    /// Maximum number of artists to return (default: 10)
    pub limit: Option<i64>,
}

/// Lightweight artist summary returned to the LLM.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct ArtistSummary {
    pub artist: String,
    pub play_count: i64,
}

/// Returns the user's most-played artists within a date range.
pub struct GetTopArtists {
    pub(crate) ctx: Arc<AgentContext>,
}

fn parse_date_range(s: &str) -> StatsDateRange {
    match s {
        "all_time" => StatsDateRange::AllTime,
        "7days" => StatsDateRange::Last7Days,
        "90days" => StatsDateRange::Last90Days,
        "180days" => StatsDateRange::Last180Days,
        "365days" => StatsDateRange::Last365Days,
        _ => StatsDateRange::Last30Days,
    }
}

impl Tool for GetTopArtists {
    const NAME: &'static str = "get_top_artists";
    type Error = AgentError;
    type Args = GetTopArtistsArgs;
    type Output = Vec<ArtistSummary>;

    async fn definition(&self, _prompt: String) -> ToolDefinition {
        ToolDefinition {
            name: Self::NAME.into(),
            description:
                "Get the user's most-played artists. Use to understand long-term preferences."
                    .into(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "range": {
                        "type": "string",
                        "description": "Time range: all_time, 7days, 30days, 90days, 180days, 365days (default: 30days)",
                        "enum": ["all_time", "7days", "30days", "90days", "180days", "365days"]
                    },
                    "limit": { "type": "integer", "description": "Max artists to return (default: 10)" }
                }
            }),
        }
    }

    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        let range = parse_date_range(args.range.as_deref().unwrap_or("30days"));
        let limit = args.limit.unwrap_or(10);
        let artists = self
            .ctx
            .db
            .with_conn(|conn| stats::get_top_artists(conn, &range, limit))?;
        Ok(artists
            .into_iter()
            .map(|a| ArtistSummary {
                artist: a.artist,
                play_count: a.play_count,
            })
            .collect())
    }
}

// ---------------------------------------------------------------------------
// SearchLibrary
// ---------------------------------------------------------------------------

/// Args for `search_library` tool.
#[derive(Debug, Deserialize, JsonSchema)]
pub struct SearchLibraryArgs {
    /// Free-text search across title, artist, and album
    pub query: Option<String>,
    /// Filter by exact artist name
    pub artist: Option<String>,
    /// Filter by exact album name
    pub album: Option<String>,
    /// Maximum number of tracks to return (default: 20)
    pub limit: Option<i64>,
}

/// Searches the user's local music library by keyword, artist, or album.
pub struct SearchLibrary {
    pub(crate) ctx: Arc<AgentContext>,
}

impl Tool for SearchLibrary {
    const NAME: &'static str = "search_library";
    type Error = AgentError;
    type Args = SearchLibraryArgs;
    type Output = Vec<TrackSummary>;

    async fn definition(&self, _prompt: String) -> ToolDefinition {
        ToolDefinition {
            name: Self::NAME.into(),
            description: "Search the user's music library by keyword, artist, or album. Returns matching tracks.".into(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "query": { "type": "string", "description": "Free-text search across title, artist, album" },
                    "artist": { "type": "string", "description": "Filter by exact artist name" },
                    "album": { "type": "string", "description": "Filter by exact album name" },
                    "limit": { "type": "integer", "description": "Max tracks to return (default: 20)" }
                }
            }),
        }
    }

    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        let limit = args.limit.unwrap_or(20);
        let query = LibraryQuery {
            search: args.query,
            artist: args.artist,
            album: args.album,
            limit,
            ..Default::default()
        };
        let result = self
            .ctx
            .db
            .with_conn(|conn| library::get_all_tracks(conn, &query))?;
        Ok(result.items.iter().map(TrackSummary::from_track).collect())
    }
}

// ---------------------------------------------------------------------------
// GetSimilarTracks
// ---------------------------------------------------------------------------

/// Args for `get_similar_tracks` tool.
#[derive(Debug, Deserialize, JsonSchema)]
pub struct GetSimilarTracksArgs {
    /// Artist name of the seed track
    pub artist: String,
    /// Title of the seed track
    pub track: String,
    /// Maximum number of similar tracks to fetch from Last.fm (default: 10)
    pub limit: Option<u32>,
}

/// Finds tracks similar to a seed track via Last.fm, then cross-references
/// with the user's local library — only returns tracks they actually own.
pub struct GetSimilarTracks {
    pub(crate) ctx: Arc<AgentContext>,
}

impl Tool for GetSimilarTracks {
    const NAME: &'static str = "get_similar_tracks";
    type Error = AgentError;
    type Args = GetSimilarTracksArgs;
    type Output = Vec<TrackSummary>;

    async fn definition(&self, _prompt: String) -> ToolDefinition {
        ToolDefinition {
            name: Self::NAME.into(),
            description:
                "Find tracks similar to a given track. Returns only tracks in the user's library."
                    .into(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "artist": { "type": "string", "description": "Artist of the seed track" },
                    "track": { "type": "string", "description": "Title of the seed track" },
                    "limit": { "type": "integer", "description": "Max similar tracks to fetch (default: 10)" }
                },
                "required": ["artist", "track"]
            }),
        }
    }

    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        let limit = args.limit.unwrap_or(10);
        let similar = self
            .ctx
            .lastfm
            .get_similar_tracks(&args.artist, &args.track, limit)
            .await?;

        let mut results = Vec::new();
        for st in &similar {
            let artist_name = st.artist.name();
            let matches = self.ctx.db.with_conn(|conn| {
                library::find_tracks_by_artist_title(conn, artist_name, &st.name)
            })?;
            for track in &matches {
                results.push(TrackSummary::from_track(track));
            }
        }
        Ok(results)
    }
}

// ---------------------------------------------------------------------------
// GetSimilarArtists
// ---------------------------------------------------------------------------

/// Args for `get_similar_artists` tool.
#[derive(Debug, Deserialize, JsonSchema)]
pub struct GetSimilarArtistsArgs {
    /// Artist name to find similar artists for
    pub artist: String,
    /// Maximum number of similar artists to fetch (default: 10)
    pub limit: Option<u32>,
}

/// Result item for similar artists that the user owns tracks by.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct SimilarArtistMatch {
    pub artist: String,
    pub sample_tracks: Vec<TrackSummary>,
}

/// Finds artists similar to a seed artist via Last.fm, then returns only
/// those that the user has tracks for, with sample tracks.
pub struct GetSimilarArtists {
    pub(crate) ctx: Arc<AgentContext>,
}

impl Tool for GetSimilarArtists {
    const NAME: &'static str = "get_similar_artists";
    type Error = AgentError;
    type Args = GetSimilarArtistsArgs;
    type Output = Vec<SimilarArtistMatch>;

    async fn definition(&self, _prompt: String) -> ToolDefinition {
        ToolDefinition {
            name: Self::NAME.into(),
            description: "Find artists similar to a given artist. Returns only artists in the user's library with sample tracks.".into(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "artist": { "type": "string", "description": "Artist to find similar artists for" },
                    "limit": { "type": "integer", "description": "Max similar artists to fetch (default: 10)" }
                },
                "required": ["artist"]
            }),
        }
    }

    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        let limit = args.limit.unwrap_or(10);
        let similar = self
            .ctx
            .lastfm
            .get_similar_artists(&args.artist, limit)
            .await?;

        let mut results = Vec::new();
        for sa in &similar {
            let query = LibraryQuery {
                artist: Some(sa.name.clone()),
                limit: 5,
                ..Default::default()
            };
            let library_tracks = self
                .ctx
                .db
                .with_conn(|conn| library::get_all_tracks(conn, &query))?;
            if !library_tracks.items.is_empty() {
                results.push(SimilarArtistMatch {
                    artist: sa.name.clone(),
                    sample_tracks: library_tracks
                        .items
                        .iter()
                        .map(TrackSummary::from_track)
                        .collect(),
                });
            }
        }
        Ok(results)
    }
}

// ---------------------------------------------------------------------------
// GetTrackTags
// ---------------------------------------------------------------------------

/// Args for `get_track_tags` tool.
#[derive(Debug, Deserialize, JsonSchema)]
pub struct GetTrackTagsArgs {
    /// Artist name of the track
    pub artist: String,
    /// Title of the track
    pub track: String,
}

/// A tag with its relevance count.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct TagSummary {
    pub name: String,
    pub count: u32,
}

/// Gets mood/genre tags for a track from Last.fm.
pub struct GetTrackTags {
    pub(crate) ctx: Arc<AgentContext>,
}

impl Tool for GetTrackTags {
    const NAME: &'static str = "get_track_tags";
    type Error = AgentError;
    type Args = GetTrackTagsArgs;
    type Output = Vec<TagSummary>;

    async fn definition(&self, _prompt: String) -> ToolDefinition {
        ToolDefinition {
            name: Self::NAME.into(),
            description: "Get mood and genre tags for a track. Use to understand a track's vibe."
                .into(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "artist": { "type": "string", "description": "Artist of the track" },
                    "track": { "type": "string", "description": "Title of the track" }
                },
                "required": ["artist", "track"]
            }),
        }
    }

    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        let tags = self
            .ctx
            .lastfm
            .get_track_top_tags(&args.artist, &args.track)
            .await?;
        Ok(tags
            .into_iter()
            .map(|t| TagSummary {
                name: t.name,
                count: t.count.unwrap_or(0),
            })
            .collect())
    }
}

// ---------------------------------------------------------------------------
// GetTopArtistsByTag
// ---------------------------------------------------------------------------

/// Args for `get_top_artists_by_tag` tool.
#[derive(Debug, Deserialize, JsonSchema)]
pub struct GetTopArtistsByTagArgs {
    /// Genre/tag to search for (e.g. "shoegaze", "jazz", "indie rock")
    pub tag: String,
    /// Maximum number of artists to fetch from Last.fm (default: 10)
    pub limit: Option<u32>,
}

/// Finds top artists for a genre tag via Last.fm, then cross-references
/// with the user's library — only returns artists they own tracks by.
pub struct GetTopArtistsByTag {
    pub(crate) ctx: Arc<AgentContext>,
}

impl Tool for GetTopArtistsByTag {
    const NAME: &'static str = "get_top_artists_by_tag";
    type Error = AgentError;
    type Args = GetTopArtistsByTagArgs;
    type Output = Vec<SimilarArtistMatch>;

    async fn definition(&self, _prompt: String) -> ToolDefinition {
        ToolDefinition {
            name: Self::NAME.into(),
            description: "Find top artists in a genre/tag. Returns only artists in the user's library with sample tracks.".into(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "tag": { "type": "string", "description": "Genre or tag (e.g. shoegaze, jazz, indie rock)" },
                    "limit": { "type": "integer", "description": "Max artists to fetch (default: 10)" }
                },
                "required": ["tag"]
            }),
        }
    }

    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        let limit = args.limit.unwrap_or(10);
        let tag_artists = self
            .ctx
            .lastfm
            .get_top_artists_by_tag(&args.tag, limit)
            .await?;

        let mut results = Vec::new();
        for ta in &tag_artists {
            let query = LibraryQuery {
                artist: Some(ta.name.clone()),
                limit: 5,
                ..Default::default()
            };
            let library_tracks = self
                .ctx
                .db
                .with_conn(|conn| library::get_all_tracks(conn, &query))?;
            if !library_tracks.items.is_empty() {
                results.push(SimilarArtistMatch {
                    artist: ta.name.clone(),
                    sample_tracks: library_tracks
                        .items
                        .iter()
                        .map(TrackSummary::from_track)
                        .collect(),
                });
            }
        }
        Ok(results)
    }
}

// ---------------------------------------------------------------------------
// GetTopTracksByCountry
// ---------------------------------------------------------------------------

/// Args for `get_top_tracks_by_country` tool.
#[derive(Debug, Deserialize, JsonSchema)]
pub struct GetTopTracksByCountryArgs {
    /// Country name (e.g. "Japan", "Brazil", "Germany")
    pub country: String,
    /// Maximum number of tracks to fetch from Last.fm (default: 10)
    pub limit: Option<u32>,
}

/// Finds trending tracks by country via Last.fm, then cross-references
/// with the user's local library — only returns tracks they own.
pub struct GetTopTracksByCountry {
    pub(crate) ctx: Arc<AgentContext>,
}

impl Tool for GetTopTracksByCountry {
    const NAME: &'static str = "get_top_tracks_by_country";
    type Error = AgentError;
    type Args = GetTopTracksByCountryArgs;
    type Output = Vec<TrackSummary>;

    async fn definition(&self, _prompt: String) -> ToolDefinition {
        ToolDefinition {
            name: Self::NAME.into(),
            description:
                "Find trending tracks in a country. Returns only tracks in the user's library."
                    .into(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "country": { "type": "string", "description": "Country name (e.g. Japan, Brazil, Germany)" },
                    "limit": { "type": "integer", "description": "Max tracks to fetch (default: 10)" }
                },
                "required": ["country"]
            }),
        }
    }

    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        let limit = args.limit.unwrap_or(10);
        let geo_tracks = self
            .ctx
            .lastfm
            .get_top_tracks_by_country(&args.country, limit)
            .await?;

        let mut results = Vec::new();
        for gt in &geo_tracks {
            let artist_name = gt.artist.name();
            let matches = self.ctx.db.with_conn(|conn| {
                library::find_tracks_by_artist_title(conn, artist_name, &gt.name)
            })?;
            for track in &matches {
                results.push(TrackSummary::from_track(track));
            }
        }
        Ok(results)
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Database;
    use crate::lastfm::client::LastFmClient;

    /// Create a test AgentContext with an in-memory DB (schema initialized)
    /// and an unconfigured Last.fm client.
    fn test_context() -> Arc<AgentContext> {
        let db = Database::new_in_memory().expect("in-memory db");
        let lastfm = LastFmClient::new_unconfigured();
        Arc::new(AgentContext { db, lastfm })
    }

    /// Insert a track into the test database and return its id.
    fn insert_track(
        ctx: &AgentContext,
        title: &str,
        artist: &str,
        album: &str,
        genre: &str,
    ) -> i64 {
        ctx.db
            .with_conn(|conn| {
                conn.execute(
                    "INSERT INTO library (filepath, title, artist, album, genre, missing)
                     VALUES (?, ?, ?, ?, ?, 0)",
                    rusqlite::params![
                        format!("/music/{artist}/{album}/{title}.flac"),
                        title,
                        artist,
                        album,
                        genre,
                    ],
                )?;
                Ok(conn.last_insert_rowid())
            })
            .expect("insert track")
    }

    /// Mark a track as recently played.
    fn mark_played(ctx: &AgentContext, track_id: i64) {
        ctx.db
            .with_conn(|conn| {
                conn.execute(
                    "UPDATE library SET last_played = datetime('now'), play_count = COALESCE(play_count, 0) + 1 WHERE id = ?",
                    rusqlite::params![track_id],
                )?;
                // Also insert into play_history for get_top_artists
                conn.execute(
                    "INSERT INTO play_history (track_id, played_at) VALUES (?, datetime('now'))",
                    rusqlite::params![track_id],
                )?;
                Ok(())
            })
            .expect("mark played");
    }

    // -----------------------------------------------------------------------
    // GetRecentlyPlayed tests
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn get_recently_played_returns_empty_for_fresh_db() {
        let ctx = test_context();
        let tool = GetRecentlyPlayed { ctx };
        let result = tool
            .call(GetRecentlyPlayedArgs {
                days: None,
                limit: None,
            })
            .await
            .unwrap();
        assert!(result.is_empty());
    }

    #[tokio::test]
    async fn get_recently_played_returns_played_tracks() {
        let ctx = test_context();
        let id = insert_track(&ctx, "Everlong", "Foo Fighters", "TCATS", "Rock");
        mark_played(&ctx, id);

        let tool = GetRecentlyPlayed { ctx };
        let result = tool
            .call(GetRecentlyPlayedArgs {
                days: Some(7),
                limit: Some(10),
            })
            .await
            .unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].title, "Everlong");
        assert_eq!(result[0].artist, "Foo Fighters");
    }

    #[tokio::test]
    async fn get_recently_played_respects_limit() {
        let ctx = test_context();
        for i in 0..5 {
            let id = insert_track(&ctx, &format!("Track {i}"), "Artist", "Album", "Genre");
            mark_played(&ctx, id);
        }

        let tool = GetRecentlyPlayed {
            ctx: Arc::clone(&ctx),
        };
        let result = tool
            .call(GetRecentlyPlayedArgs {
                days: Some(7),
                limit: Some(3),
            })
            .await
            .unwrap();
        assert_eq!(result.len(), 3);
    }

    // -----------------------------------------------------------------------
    // GetTopArtists tests
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn get_top_artists_returns_empty_for_fresh_db() {
        let ctx = test_context();
        let tool = GetTopArtists { ctx };
        let result = tool
            .call(GetTopArtistsArgs {
                range: None,
                limit: None,
            })
            .await
            .unwrap();
        assert!(result.is_empty());
    }

    #[tokio::test]
    async fn get_top_artists_ranks_by_play_count() {
        let ctx = test_context();

        // Play Radiohead 3 times
        for title in ["Creep", "Karma Police", "Paranoid Android"] {
            let id = insert_track(&ctx, title, "Radiohead", "OK Computer", "Rock");
            mark_played(&ctx, id);
        }

        // Play Bjork once
        let id = insert_track(&ctx, "Army of Me", "Bjork", "Post", "Electronic");
        mark_played(&ctx, id);

        let tool = GetTopArtists {
            ctx: Arc::clone(&ctx),
        };
        let result = tool
            .call(GetTopArtistsArgs {
                range: Some("all_time".into()),
                limit: Some(10),
            })
            .await
            .unwrap();
        assert!(!result.is_empty());
        assert_eq!(result[0].artist, "Radiohead");
        assert_eq!(result[0].play_count, 3);
    }

    #[tokio::test]
    async fn parse_date_range_defaults() {
        assert!(matches!(
            parse_date_range("all_time"),
            StatsDateRange::AllTime
        ));
        assert!(matches!(
            parse_date_range("7days"),
            StatsDateRange::Last7Days
        ));
        assert!(matches!(
            parse_date_range("30days"),
            StatsDateRange::Last30Days
        ));
        assert!(matches!(
            parse_date_range("unknown"),
            StatsDateRange::Last30Days
        ));
    }

    // -----------------------------------------------------------------------
    // SearchLibrary tests
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn search_library_returns_empty_for_fresh_db() {
        let ctx = test_context();
        let tool = SearchLibrary { ctx };
        let result = tool
            .call(SearchLibraryArgs {
                query: Some("anything".into()),
                artist: None,
                album: None,
                limit: None,
            })
            .await
            .unwrap();
        assert!(result.is_empty());
    }

    #[tokio::test]
    async fn search_library_finds_by_keyword() {
        let ctx = test_context();
        insert_track(&ctx, "Everlong", "Foo Fighters", "TCATS", "Rock");
        insert_track(&ctx, "Creep", "Radiohead", "Pablo Honey", "Rock");

        let tool = SearchLibrary {
            ctx: Arc::clone(&ctx),
        };
        let result = tool
            .call(SearchLibraryArgs {
                query: Some("Everlong".into()),
                artist: None,
                album: None,
                limit: None,
            })
            .await
            .unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].title, "Everlong");
    }

    #[tokio::test]
    async fn search_library_filters_by_artist() {
        let ctx = test_context();
        insert_track(&ctx, "Everlong", "Foo Fighters", "TCATS", "Rock");
        insert_track(&ctx, "Creep", "Radiohead", "Pablo Honey", "Rock");

        let tool = SearchLibrary {
            ctx: Arc::clone(&ctx),
        };
        let result = tool
            .call(SearchLibraryArgs {
                query: None,
                artist: Some("Radiohead".into()),
                album: None,
                limit: None,
            })
            .await
            .unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].title, "Creep");
    }

    #[tokio::test]
    async fn search_library_respects_limit() {
        let ctx = test_context();
        for i in 0..10 {
            insert_track(&ctx, &format!("Track {i}"), "Artist", "Album", "Rock");
        }

        let tool = SearchLibrary {
            ctx: Arc::clone(&ctx),
        };
        let result = tool
            .call(SearchLibraryArgs {
                query: None,
                artist: None,
                album: None,
                limit: Some(3),
            })
            .await
            .unwrap();
        assert_eq!(result.len(), 3);
    }

    // -----------------------------------------------------------------------
    // Tool definition tests
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn all_tool_definitions_have_name_and_description() {
        let ctx = test_context();

        let defs = vec![
            GetRecentlyPlayed {
                ctx: Arc::clone(&ctx),
            }
            .definition(String::new())
            .await,
            GetTopArtists {
                ctx: Arc::clone(&ctx),
            }
            .definition(String::new())
            .await,
            SearchLibrary {
                ctx: Arc::clone(&ctx),
            }
            .definition(String::new())
            .await,
            GetSimilarTracks {
                ctx: Arc::clone(&ctx),
            }
            .definition(String::new())
            .await,
            GetSimilarArtists {
                ctx: Arc::clone(&ctx),
            }
            .definition(String::new())
            .await,
            GetTrackTags {
                ctx: Arc::clone(&ctx),
            }
            .definition(String::new())
            .await,
            GetTopArtistsByTag {
                ctx: Arc::clone(&ctx),
            }
            .definition(String::new())
            .await,
            GetTopTracksByCountry {
                ctx: Arc::clone(&ctx),
            }
            .definition(String::new())
            .await,
        ];

        let expected_names = [
            "get_recently_played",
            "get_top_artists",
            "search_library",
            "get_similar_tracks",
            "get_similar_artists",
            "get_track_tags",
            "get_top_artists_by_tag",
            "get_top_tracks_by_country",
        ];

        for (def, name) in defs.iter().zip(expected_names.iter()) {
            assert_eq!(def.name, *name, "tool name mismatch");
            assert!(
                !def.description.is_empty(),
                "tool {name} has empty description"
            );
            assert!(
                def.parameters.is_object(),
                "tool {name} has non-object parameters"
            );
        }
    }

    #[test]
    fn tool_names_are_snake_case() {
        let names = [
            GetRecentlyPlayed::NAME,
            GetTopArtists::NAME,
            SearchLibrary::NAME,
            GetSimilarTracks::NAME,
            GetSimilarArtists::NAME,
            GetTrackTags::NAME,
            GetTopArtistsByTag::NAME,
            GetTopTracksByCountry::NAME,
        ];
        for name in names {
            assert!(
                name.chars().all(|c| c.is_lowercase() || c == '_'),
                "tool name {name} is not snake_case"
            );
        }
    }
}
