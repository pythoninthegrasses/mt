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
#[allow(dead_code)] // Fields populated via Deserialize
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

/// Cache loved tracks response (fetches from Last.fm and stores in cache)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CacheLovedTracksResponse {
    pub status: String,
    pub total_fetched: usize,
    pub newly_cached: usize,
    pub message: String,
}

/// Match loved tracks response (matches cached tracks against library)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MatchLovedTracksResponse {
    pub status: String,
    pub matched: usize,
    pub already_matched: usize,
    pub no_match: usize,
    pub new_favorites: usize,
    pub message: String,
}

/// Reset loved tracks cache response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResetLovedCacheResponse {
    pub status: String,
    pub cleared: i64,
    pub unfavorited: i64,
    pub message: String,
}

/// Loved tracks statistics response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LovedTracksStatsResponse {
    pub total_cached: i64,
    pub matched: i64,
    pub unmatched: i64,
    pub most_recent_loved: Option<i64>,
}

/// Last.fm API token response
#[derive(Debug, Clone, Serialize, Deserialize)]
#[allow(dead_code)] // Fields populated via Deserialize
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
#[allow(dead_code)] // Fields populated via Deserialize
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
    #[serde(default)]
    pub date: Option<LovedDate>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LovedDate {
    pub uts: String, // Unix timestamp as string
    #[serde(rename = "#text")]
    pub text: Option<String>, // Human-readable date
}

impl LovedDate {
    /// Get the Unix timestamp as i64
    pub fn timestamp(&self) -> Option<i64> {
        self.uts.parse().ok()
    }
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
#[allow(dead_code)] // Fields populated via Deserialize
pub struct NowPlayingApiResponse {
    pub nowplaying: HashMap<String, serde_json::Value>,
}

#[cfg(feature = "agent")]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SimilarTracksResponse {
    pub similartracks: SimilarTracksContainer,
}

#[cfg(feature = "agent")]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SimilarTracksContainer {
    pub track: Vec<SimilarTrack>,
}

#[cfg(feature = "agent")]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SimilarTrack {
    pub name: String,
    pub artist: ArtistInfo,
    #[serde(rename = "match")]
    pub match_score: Option<String>,
}

#[cfg(feature = "agent")]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SimilarArtistsResponse {
    pub similarartists: SimilarArtistsContainer,
}

#[cfg(feature = "agent")]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SimilarArtistsContainer {
    pub artist: Vec<SimilarArtist>,
}

#[cfg(feature = "agent")]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SimilarArtist {
    pub name: String,
    #[serde(rename = "match")]
    pub match_score: Option<String>,
}

#[cfg(feature = "agent")]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TopTagsResponse {
    pub toptags: TopTagsContainer,
}

#[cfg(feature = "agent")]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TopTagsContainer {
    pub tag: Vec<TagInfo>,
}

#[cfg(feature = "agent")]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TagInfo {
    pub name: String,
    pub count: Option<u32>,
}

#[cfg(feature = "agent")]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TagTopArtistsResponse {
    pub topartists: TagTopArtistsContainer,
}

#[cfg(feature = "agent")]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TagTopArtistsContainer {
    pub artist: Vec<TagArtist>,
}

#[cfg(feature = "agent")]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TagArtist {
    pub name: String,
}

#[cfg(feature = "agent")]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeoTopTracksResponse {
    pub tracks: GeoTopTracksContainer,
}

#[cfg(feature = "agent")]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeoTopTracksContainer {
    pub track: Vec<GeoTrack>,
}

#[cfg(feature = "agent")]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeoTrack {
    pub name: String,
    pub artist: ArtistInfo,
}

#[cfg(test)]
#[path = "types_tests.rs"]
mod tests;
