//! Database models matching the Python Pydantic models.
//!
//! These structs represent the data stored in the SQLite database
//! and are serializable for JSON API responses.

use serde::{Deserialize, Serialize};

/// Track metadata from the library table
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Track {
    pub id: i64,
    pub filepath: String,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub album_artist: Option<String>,
    pub track_number: Option<String>,
    pub track_total: Option<String>,
    pub date: Option<String>,
    pub duration: Option<f64>,
    pub file_size: i64,
    pub file_mtime_ns: Option<i64>,
    pub file_inode: Option<i64>,
    pub content_hash: Option<String>,
    pub added_date: Option<String>,
    pub last_played: Option<String>,
    pub play_count: i64,
    pub missing: bool,
    pub last_seen_at: Option<i64>,
}

/// Track metadata for insertion (without id and computed fields)
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TrackMetadata {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub album_artist: Option<String>,
    pub track_number: Option<String>,
    pub track_total: Option<String>,
    pub date: Option<String>,
    pub duration: Option<f64>,
    pub file_size: Option<i64>,
    pub file_mtime_ns: Option<i64>,
    pub file_inode: Option<u64>,
    pub content_hash: Option<String>,
}

/// Queue item with track metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueueItem {
    pub position: i64,
    pub track: Track,
}

/// Queue playback state
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueueState {
    pub current_index: i64,
    pub shuffle_enabled: bool,
    pub loop_mode: String,
    pub original_order_json: Option<String>,
}

/// Playlist metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Playlist {
    pub id: i64,
    pub name: String,
    pub position: i64,
    pub created_at: Option<String>,
    pub track_count: i64,
}

/// Playlist with tracks
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlaylistWithTracks {
    pub id: i64,
    pub name: String,
    pub position: i64,
    pub created_at: Option<String>,
    pub track_count: i64,
    pub tracks: Vec<PlaylistTrack>,
}

/// Track within a playlist
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlaylistTrack {
    pub position: i64,
    pub added_date: Option<String>,
    pub track: Track,
}

/// Favorite entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Favorite {
    pub id: i64,
    pub track_id: i64,
    pub timestamp: Option<String>,
}

/// Track with favorite date
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FavoriteTrack {
    #[serde(flatten)]
    pub track: Track,
    pub favorited_date: Option<String>,
}

/// Setting entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Setting {
    pub key: String,
    pub value: Option<String>,
}

/// Scrobble queue entry for offline Last.fm scrobbling
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScrobbleEntry {
    pub id: i64,
    pub artist: String,
    pub track: String,
    pub album: Option<String>,
    pub timestamp: i64,
    pub created_at: Option<String>,
    pub retry_count: i64,
}

/// Watched folder configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WatchedFolder {
    pub id: i64,
    pub path: String,
    pub mode: String,
    pub cadence_minutes: i64,
    pub enabled: bool,
    pub last_scanned_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
}

/// Lyrics cache entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LyricsCache {
    pub id: i64,
    pub artist: String,
    pub title: String,
    pub album: Option<String>,
    pub lyrics: Option<String>,
    pub source_url: Option<String>,
    pub fetched_at: Option<String>,
}

/// Library statistics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LibraryStats {
    pub total_tracks: i64,
    pub total_duration: i64,
    pub total_size: i64,
    pub total_artists: i64,
    pub total_albums: i64,
}

/// File fingerprint for change detection
#[derive(Debug, Clone)]
pub struct FileFingerprint {
    pub filepath: String,
    pub file_mtime_ns: Option<i64>,
    pub file_size: i64,
}

/// Paginated result wrapper
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaginatedResult<T> {
    pub items: Vec<T>,
    pub total: i64,
}

/// Sort order for queries
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[derive(Default)]
pub enum SortOrder {
    Asc,
    #[default]
    Desc,
}


impl SortOrder {
    pub fn as_sql(&self) -> &'static str {
        match self {
            SortOrder::Asc => "ASC",
            SortOrder::Desc => "DESC",
        }
    }
}

/// Valid sort columns for library queries
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[derive(Default)]
pub enum LibrarySortColumn {
    Title,
    Artist,
    Album,
    #[default]
    AddedDate,
    PlayCount,
    Duration,
    LastPlayed,
}


impl LibrarySortColumn {
    pub fn as_sql(&self) -> &'static str {
        match self {
            LibrarySortColumn::Title => "title",
            LibrarySortColumn::Artist => "artist",
            LibrarySortColumn::Album => "album",
            LibrarySortColumn::AddedDate => "added_date",
            LibrarySortColumn::PlayCount => "play_count",
            LibrarySortColumn::Duration => "duration",
            LibrarySortColumn::LastPlayed => "last_played",
        }
    }
}

impl std::str::FromStr for LibrarySortColumn {
    type Err = ();

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Ok(match s.to_lowercase().as_str() {
            "title" => LibrarySortColumn::Title,
            "artist" => LibrarySortColumn::Artist,
            "album" => LibrarySortColumn::Album,
            "added_date" => LibrarySortColumn::AddedDate,
            "play_count" => LibrarySortColumn::PlayCount,
            "duration" => LibrarySortColumn::Duration,
            "last_played" => LibrarySortColumn::LastPlayed,
            _ => LibrarySortColumn::AddedDate,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_track_serialization() {
        let track = Track {
            id: 1,
            filepath: "/music/test.mp3".to_string(),
            title: Some("Test Song".to_string()),
            artist: Some("Test Artist".to_string()),
            album: Some("Test Album".to_string()),
            ..Default::default()
        };

        let json = serde_json::to_string(&track).unwrap();
        assert!(json.contains("Test Song"));

        let deserialized: Track = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.id, 1);
        assert_eq!(deserialized.title, Some("Test Song".to_string()));
    }

    #[test]
    fn test_sort_column_from_str() {
        use std::str::FromStr;

        assert_eq!(
            LibrarySortColumn::from_str("title").unwrap(),
            LibrarySortColumn::Title
        );
        assert_eq!(
            LibrarySortColumn::from_str("ARTIST").unwrap(),
            LibrarySortColumn::Artist
        );
        assert_eq!(
            LibrarySortColumn::from_str("invalid").unwrap(),
            LibrarySortColumn::AddedDate
        );
    }
}
