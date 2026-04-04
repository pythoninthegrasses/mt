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
// ToolOutput — wrapper for tool results with actionable hints on empty results
// ---------------------------------------------------------------------------

/// Wrapper for tool results. Serializes to either a JSON array (Results) or
/// `{"matches": 0, "hint": "..."}` (Hint), matching the Python agent's behavior.
#[derive(Debug, Clone, Serialize)]
#[serde(untagged)]
pub enum ToolOutput<T: Serialize> {
    Results(Vec<T>),
    Hint { matches: usize, hint: String },
}

/// Parse a decade string into (year_from, year_to) range.
///
/// Handles both short ("90s", "20s") and long ("1990s", "2020s") forms.
/// Short forms < 100 are resolved relative to century: 20-99 → 1900s, 0-19 → 2000s.
fn parse_decade(s: &str) -> (i64, i64) {
    let trimmed = s.trim().to_lowercase();
    let digits: String = trimmed.chars().take_while(|c| c.is_ascii_digit()).collect();

    if let Ok(n) = digits.parse::<i64>() {
        let start = if n >= 100 {
            // Full century form: "1990s" → 1990, "1780s" → 1780
            (n / 10) * 10
        } else if n >= 20 {
            // Short 20th century: "90s" → 1990, "60s" → 1960
            1900 + n
        } else {
            // Short 21st century: "00s" → 2000, "10s" → 2010
            2000 + n
        };
        (start, start + 9)
    } else {
        (1900, 2099)
    }
}

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
    type Output = ToolOutput<TrackSummary>;

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
        if tracks.is_empty() {
            return Ok(ToolOutput::Hint {
                matches: 0,
                hint: format!(
                    "No tracks played in the last {days} days. \
                     Try a longer range (e.g. days=30), or use get_top_artists \
                     with range='all_time' to see long-term preferences."
                ),
            });
        }
        Ok(ToolOutput::Results(
            tracks.iter().map(TrackSummary::from_track).collect(),
        ))
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
    type Output = ToolOutput<ArtistSummary>;

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
        let range_str = args.range.as_deref().unwrap_or("30days");
        let range = parse_date_range(range_str);
        let limit = args.limit.unwrap_or(10);
        let artists = self
            .ctx
            .db
            .with_conn(|conn| stats::get_top_artists(conn, &range, limit))?;
        if artists.is_empty() {
            let broader = match range_str {
                "7days" => Some("30days"),
                "30days" => Some("90days"),
                "90days" => Some("all_time"),
                _ => None,
            };
            let hint = if let Some(suggestion) = broader {
                format!(
                    "No play history in range '{range_str}'. \
                     Try range='{suggestion}' for a broader window, or skip \
                     to get_top_artists_by_tag with genre tags."
                )
            } else {
                "No play history found. Use get_top_artists_by_tag with \
                 genre tags, or search_library to explore the collection directly."
                    .into()
            };
            return Ok(ToolOutput::Hint { matches: 0, hint });
        }
        Ok(ToolOutput::Results(
            artists
                .into_iter()
                .map(|a| ArtistSummary {
                    artist: a.artist,
                    play_count: a.play_count,
                })
                .collect(),
        ))
    }
}

// ---------------------------------------------------------------------------
// SearchLibrary
// ---------------------------------------------------------------------------

/// Args for `search_library` tool.
#[derive(Debug, Default, Deserialize, JsonSchema)]
pub struct SearchLibraryArgs {
    /// Free-text search across title, artist, and album
    pub query: Option<String>,
    /// Filter by exact artist name
    pub artist: Option<String>,
    /// Filter by exact album name
    pub album: Option<String>,
    /// Filter by genre (LIKE match, e.g. "rock", "jazz")
    pub genre: Option<String>,
    /// Filter by decade: "90s", "80s", "2000s", etc.
    pub decade: Option<String>,
    /// Filter tracks from this year onward (inclusive)
    pub year_from: Option<i64>,
    /// Filter tracks up to this year (inclusive)
    pub year_to: Option<i64>,
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
    type Output = ToolOutput<TrackSummary>;

    async fn definition(&self, _prompt: String) -> ToolDefinition {
        ToolDefinition {
            name: Self::NAME.into(),
            description: "Search the user's music library by keyword, artist, album, genre, or year range. Returns matching tracks with year metadata.".into(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "query": { "type": "string", "description": "Free-text search across title, artist, album" },
                    "artist": { "type": "string", "description": "Filter by exact artist name" },
                    "album": { "type": "string", "description": "Filter by exact album name" },
                    "genre": { "type": "string", "description": "Filter by genre (LIKE match, e.g. 'rock', 'jazz')" },
                    "decade": { "type": "string", "description": "Filter by decade: '90s', '80s', '2000s', etc." },
                    "year_from": { "type": "integer", "description": "Filter tracks from this year onward (inclusive)" },
                    "year_to": { "type": "integer", "description": "Filter tracks up to this year (inclusive)" },
                    "limit": { "type": "integer", "description": "Max tracks to return (default: 20)" }
                }
            }),
        }
    }

    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        let limit = args.limit.unwrap_or(20);

        // Resolve decade to year range
        let (year_from, year_to) = match args.decade.as_deref() {
            Some(d) => {
                let (from, to) = parse_decade(d);
                (Some(from), Some(to))
            }
            None => (args.year_from, args.year_to),
        };

        let query = LibraryQuery {
            search: args.query,
            artist: args.artist,
            album: args.album,
            genre: args.genre,
            year_from,
            year_to,
            limit,
            ..Default::default()
        };
        let result = self
            .ctx
            .db
            .with_conn(|conn| library::get_all_tracks(conn, &query))?;
        Ok(ToolOutput::Results(
            result.items.iter().map(TrackSummary::from_track).collect(),
        ))
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
    /// Maximum number of similar tracks to fetch from Last.fm (default: 30)
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
    type Output = ToolOutput<TrackSummary>;

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
                    "limit": { "type": "integer", "description": "Max similar tracks to check (default: 30)" }
                },
                "required": ["artist", "track"]
            }),
        }
    }

    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        let limit = args.limit.unwrap_or(30);
        let similar = match self
            .ctx
            .lastfm
            .get_similar_tracks(&args.artist, &args.track, limit)
            .await
        {
            Ok(s) => s,
            Err(_) => {
                return Ok(ToolOutput::Hint {
                    matches: 0,
                    hint: "Last.fm API unavailable. Try get_similar_artists or \
                           get_top_artists_by_tag instead."
                        .into(),
                });
            }
        };

        if similar.is_empty() {
            return Ok(ToolOutput::Hint {
                matches: 0,
                hint: format!(
                    "Last.fm has no similar tracks for '{} - {}'. \
                     Try get_similar_artists for broader matching, or search_library \
                     to find tracks by this artist.",
                    args.artist, args.track
                ),
            });
        }

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

        if results.is_empty() {
            let lastfm_artists: Vec<&str> =
                similar.iter().take(5).map(|st| st.artist.name()).collect();
            return Ok(ToolOutput::Hint {
                matches: 0,
                hint: format!(
                    "Last.fm returned {} similar tracks but none are in \
                     your library. Similar artists include: {}. \
                     Try get_similar_artists or get_top_artists_by_tag instead.",
                    similar.len(),
                    lastfm_artists.join(", ")
                ),
            });
        }
        Ok(ToolOutput::Results(results))
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
    /// Maximum number of similar artists to fetch (default: 30)
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
    type Output = ToolOutput<SimilarArtistMatch>;

    async fn definition(&self, _prompt: String) -> ToolDefinition {
        ToolDefinition {
            name: Self::NAME.into(),
            description: "Find artists similar to a given artist. Returns only artists in the user's library with sample tracks.".into(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "artist": { "type": "string", "description": "Artist to find similar artists for" },
                    "limit": { "type": "integer", "description": "Max similar artists to check (default: 30)" }
                },
                "required": ["artist"]
            }),
        }
    }

    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        let limit = args.limit.unwrap_or(30);
        let similar = match self
            .ctx
            .lastfm
            .get_similar_artists(&args.artist, limit)
            .await
        {
            Ok(s) => s,
            Err(_) => {
                return Ok(ToolOutput::Hint {
                    matches: 0,
                    hint: "Last.fm API unavailable. Try search_library with artist name, \
                           or get_top_artists_by_tag with a genre tag."
                        .into(),
                });
            }
        };

        if similar.is_empty() {
            return Ok(ToolOutput::Hint {
                matches: 0,
                hint: format!(
                    "Last.fm has no similar artists for '{}'. \
                     Try get_top_artists_by_tag with a genre tag, or search_library.",
                    args.artist
                ),
            });
        }

        let mut results = Vec::new();
        for sa in &similar {
            let query = LibraryQuery {
                artist: Some(sa.name.clone()),
                limit: 2,
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

        if results.is_empty() {
            let lastfm_names: Vec<&str> =
                similar.iter().take(5).map(|sa| sa.name.as_str()).collect();
            return Ok(ToolOutput::Hint {
                matches: 0,
                hint: format!(
                    "Last.fm returned {} similar artists but none are in \
                     your library. They include: {}. \
                     Try get_top_artists_by_tag with a genre tag for broader discovery.",
                    similar.len(),
                    lastfm_names.join(", ")
                ),
            });
        }
        Ok(ToolOutput::Results(results))
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
    type Output = ToolOutput<TagSummary>;

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
        let tags = match self
            .ctx
            .lastfm
            .get_track_top_tags(&args.artist, &args.track)
            .await
        {
            Ok(t) => t,
            Err(_) => {
                return Ok(ToolOutput::Hint {
                    matches: 0,
                    hint: "Last.fm API unavailable. Try get_top_artists_by_tag with \
                           a genre guess, or get_similar_tracks to find related music."
                        .into(),
                });
            }
        };

        if tags.is_empty() {
            return Ok(ToolOutput::Hint {
                matches: 0,
                hint: format!(
                    "No tags on Last.fm for '{} - {}'. This track may be \
                     too obscure. Try get_track_tags on a more popular track by this artist, \
                     or use get_similar_artists to explore related music.",
                    args.artist, args.track
                ),
            });
        }
        Ok(ToolOutput::Results(
            tags.into_iter()
                .take(10)
                .map(|t| TagSummary {
                    name: t.name,
                    count: t.count.unwrap_or(0),
                })
                .collect(),
        ))
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
    /// Maximum number of artists to fetch from Last.fm (default: 50)
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
    type Output = ToolOutput<SimilarArtistMatch>;

    async fn definition(&self, _prompt: String) -> ToolDefinition {
        ToolDefinition {
            name: Self::NAME.into(),
            description: "Find top artists in a genre/tag. Returns only artists in the user's library with sample tracks.".into(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "tag": { "type": "string", "description": "Genre or tag (e.g. shoegaze, jazz, indie rock)" },
                    "limit": { "type": "integer", "description": "Max artists to check (default: 50)" }
                },
                "required": ["tag"]
            }),
        }
    }

    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        let limit = args.limit.unwrap_or(50);
        let tag_artists = match self
            .ctx
            .lastfm
            .get_top_artists_by_tag(&args.tag, limit)
            .await
        {
            Ok(a) => a,
            Err(_) => {
                return Ok(ToolOutput::Hint {
                    matches: 0,
                    hint: "Last.fm API unavailable. Try search_library with artist or \
                           album keywords instead."
                        .into(),
                });
            }
        };

        if tag_artists.is_empty() {
            return Ok(ToolOutput::Hint {
                matches: 0,
                hint: format!(
                    "No artists on Last.fm for tag '{}'. Try a broader or \
                     alternative tag name (e.g. 'electronic' instead of 'electronica', \
                     'indie rock' instead of 'indie').",
                    args.tag
                ),
            });
        }

        let mut results = Vec::new();
        for ta in &tag_artists {
            let query = LibraryQuery {
                artist: Some(ta.name.clone()),
                limit: 2,
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

        if results.is_empty() {
            let lastfm_names: Vec<&str> = tag_artists
                .iter()
                .take(5)
                .map(|ta| ta.name.as_str())
                .collect();
            return Ok(ToolOutput::Hint {
                matches: 0,
                hint: format!(
                    "Last.fm returned {} artists for '{}' but none \
                     are in your library. They include: {}. \
                     Try a broader tag, or use get_similar_artists on an artist you've \
                     already found in the library.",
                    tag_artists.len(),
                    args.tag,
                    lastfm_names.join(", ")
                ),
            });
        }
        Ok(ToolOutput::Results(results))
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
    /// Maximum number of tracks to fetch from Last.fm (default: 50)
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
    type Output = ToolOutput<TrackSummary>;

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
                    "limit": { "type": "integer", "description": "Max tracks to check (default: 50)" }
                },
                "required": ["country"]
            }),
        }
    }

    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        let limit = args.limit.unwrap_or(50);
        let geo_tracks = match self
            .ctx
            .lastfm
            .get_top_tracks_by_country(&args.country, limit)
            .await
        {
            Ok(t) => t,
            Err(_) => {
                return Ok(ToolOutput::Hint {
                    matches: 0,
                    hint: "Last.fm API unavailable. Try search_library or \
                           get_top_artists_by_tag instead."
                        .into(),
                });
            }
        };

        if geo_tracks.is_empty() {
            return Ok(ToolOutput::Hint {
                matches: 0,
                hint: format!(
                    "No trending tracks on Last.fm for '{}'. Check the \
                     country name spelling (e.g. 'United States' not 'USA').",
                    args.country
                ),
            });
        }

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

        if results.is_empty() {
            return Ok(ToolOutput::Hint {
                matches: 0,
                hint: format!(
                    "Last.fm returned {} trending tracks for '{}' \
                     but none are in your library. Try increasing the limit, or use \
                     get_top_artists_by_tag with a regional genre tag.",
                    geo_tracks.len(),
                    args.country
                ),
            });
        }
        Ok(ToolOutput::Results(results))
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
    async fn get_recently_played_returns_hint_for_fresh_db() {
        let ctx = test_context();
        let tool = GetRecentlyPlayed { ctx };
        let result = tool
            .call(GetRecentlyPlayedArgs {
                days: None,
                limit: None,
            })
            .await
            .unwrap();
        match result {
            ToolOutput::Hint { matches, hint } => {
                assert_eq!(matches, 0);
                assert!(hint.contains("get_top_artists"));
            }
            ToolOutput::Results(_) => panic!("expected Hint, got Results"),
        }
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
        match result {
            ToolOutput::Results(tracks) => {
                assert_eq!(tracks.len(), 1);
                assert_eq!(tracks[0].title, "Everlong");
                assert_eq!(tracks[0].artist, "Foo Fighters");
            }
            ToolOutput::Hint { .. } => panic!("expected Results, got Hint"),
        }
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
        match result {
            ToolOutput::Results(tracks) => assert_eq!(tracks.len(), 3),
            ToolOutput::Hint { .. } => panic!("expected Results, got Hint"),
        }
    }

    // -----------------------------------------------------------------------
    // GetTopArtists tests
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn get_top_artists_returns_hint_for_fresh_db() {
        let ctx = test_context();
        let tool = GetTopArtists { ctx };
        let result = tool
            .call(GetTopArtistsArgs {
                range: None,
                limit: None,
            })
            .await
            .unwrap();
        match result {
            ToolOutput::Hint { matches, hint } => {
                assert_eq!(matches, 0);
                assert!(hint.contains("get_top_artists_by_tag"));
            }
            ToolOutput::Results(_) => panic!("expected Hint, got Results"),
        }
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
        match result {
            ToolOutput::Results(artists) => {
                assert!(!artists.is_empty());
                assert_eq!(artists[0].artist, "Radiohead");
                assert_eq!(artists[0].play_count, 3);
            }
            ToolOutput::Hint { .. } => panic!("expected Results, got Hint"),
        }
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
                ..Default::default()
            })
            .await
            .unwrap();
        match result {
            ToolOutput::Results(tracks) => assert!(tracks.is_empty()),
            ToolOutput::Hint { .. } => panic!("expected Results, got Hint"),
        }
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
                ..Default::default()
            })
            .await
            .unwrap();
        match result {
            ToolOutput::Results(tracks) => {
                assert_eq!(tracks.len(), 1);
                assert_eq!(tracks[0].title, "Everlong");
            }
            ToolOutput::Hint { .. } => panic!("expected Results, got Hint"),
        }
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
                artist: Some("Radiohead".into()),
                ..Default::default()
            })
            .await
            .unwrap();
        match result {
            ToolOutput::Results(tracks) => {
                assert_eq!(tracks.len(), 1);
                assert_eq!(tracks[0].title, "Creep");
            }
            ToolOutput::Hint { .. } => panic!("expected Results, got Hint"),
        }
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
                limit: Some(3),
                ..Default::default()
            })
            .await
            .unwrap();
        match result {
            ToolOutput::Results(tracks) => assert_eq!(tracks.len(), 3),
            ToolOutput::Hint { .. } => panic!("expected Results, got Hint"),
        }
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

    // -----------------------------------------------------------------------
    // parse_decade tests
    // -----------------------------------------------------------------------

    #[test]
    fn parse_decade_short_20th_century() {
        assert_eq!(parse_decade("90s"), (1990, 1999));
        assert_eq!(parse_decade("60s"), (1960, 1969));
        assert_eq!(parse_decade("20s"), (1920, 1929));
    }

    #[test]
    fn parse_decade_short_21st_century() {
        assert_eq!(parse_decade("00s"), (2000, 2009));
        assert_eq!(parse_decade("10s"), (2010, 2019));
    }

    #[test]
    fn parse_decade_full_form() {
        assert_eq!(parse_decade("1990s"), (1990, 1999));
        assert_eq!(parse_decade("2000s"), (2000, 2009));
        assert_eq!(parse_decade("2020s"), (2020, 2029));
        assert_eq!(parse_decade("1780s"), (1780, 1789));
        assert_eq!(parse_decade("1850s"), (1850, 1859));
    }

    #[test]
    fn parse_decade_invalid_fallback() {
        assert_eq!(parse_decade("xyz"), (1900, 2099));
        assert_eq!(parse_decade(""), (1900, 2099));
    }

    // -----------------------------------------------------------------------
    // SearchLibrary genre/decade filter tests
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn search_library_filters_by_genre() {
        let ctx = test_context();
        insert_track(&ctx, "Everlong", "Foo Fighters", "TCATS", "Rock");
        insert_track(&ctx, "Blue Train", "John Coltrane", "Blue Train", "Jazz");

        let tool = SearchLibrary {
            ctx: Arc::clone(&ctx),
        };
        let result = tool
            .call(SearchLibraryArgs {
                genre: Some("Jazz".into()),
                ..Default::default()
            })
            .await
            .unwrap();
        match result {
            ToolOutput::Results(tracks) => {
                assert_eq!(tracks.len(), 1);
                assert_eq!(tracks[0].title, "Blue Train");
            }
            ToolOutput::Hint { .. } => panic!("expected Results, got Hint"),
        }
    }

    #[tokio::test]
    async fn search_library_filters_by_decade() {
        let ctx = test_context();
        // Insert tracks with year metadata
        ctx.db
            .with_conn(|conn| {
                conn.execute(
                    "INSERT INTO library (filepath, title, artist, album, genre, date, missing)
                     VALUES ('/m/a.mp3', 'Smells Like Teen Spirit', 'Nirvana', 'Nevermind', 'Rock', '1991', 0)",
                    [],
                )?;
                conn.execute(
                    "INSERT INTO library (filepath, title, artist, album, genre, date, missing)
                     VALUES ('/m/b.mp3', 'Everything In Its Right Place', 'Radiohead', 'Kid A', 'Rock', '2000', 0)",
                    [],
                )?;
                Ok(())
            })
            .expect("insert tracks");

        let tool = SearchLibrary {
            ctx: Arc::clone(&ctx),
        };
        let result = tool
            .call(SearchLibraryArgs {
                decade: Some("90s".into()),
                limit: Some(50),
                ..Default::default()
            })
            .await
            .unwrap();
        match result {
            ToolOutput::Results(tracks) => {
                assert_eq!(tracks.len(), 1);
                assert_eq!(tracks[0].title, "Smells Like Teen Spirit");
            }
            ToolOutput::Hint { .. } => panic!("expected Results, got Hint"),
        }
    }
}
