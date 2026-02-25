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
    pub disc_number: Option<String>,
    pub disc_total: Option<String>,
    pub date: Option<String>,
    pub genre: Option<String>,
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
    pub disc_number: Option<String>,
    pub disc_total: Option<String>,
    pub date: Option<String>,
    pub genre: Option<String>,
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
#[allow(dead_code)]
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
#[allow(dead_code)]
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
#[allow(dead_code)]
pub struct LyricsCache {
    pub id: i64,
    pub artist: String,
    pub title: String,
    pub album: Option<String>,
    pub lyrics: Option<String>,
    pub source_url: Option<String>,
    pub fetched_at: Option<String>,
}

/// Last.fm loved track cache entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LastfmLovedTrack {
    pub id: i64,
    pub artist: String,
    pub track: String,
    pub loved_at: Option<i64>,
    pub matched_track_id: Option<i64>,
    pub last_checked_at: Option<i64>,
    pub created_at: Option<String>,
}

/// Statistics for Last.fm loved tracks cache
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct LastfmLovedStats {
    pub total_cached: i64,
    pub matched_count: i64,
    pub unmatched_count: i64,
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
#[allow(dead_code)]
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
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum SortOrder {
    Asc,
    #[default]
    Desc,
}

impl SortOrder {
    pub(crate) fn as_sql(&self) -> &'static str {
        match self {
            SortOrder::Asc => "ASC",
            SortOrder::Desc => "DESC",
        }
    }
}

/// Valid sort columns for library queries
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum LibrarySortColumn {
    Title,
    Artist,
    Album,
    #[default]
    AddedDate,
    PlayCount,
    Duration,
    LastPlayed,
    Year,
    Genre,
    DiscNumber,
    TrackTotal,
    TrackNumber,
}

/// Raw column expression for artist sort (no COLLATE).
const ARTIST_SORT_EXPR: &str = "COALESCE(NULLIF(album_artist, ''), artist)";

impl LibrarySortColumn {
    /// Raw column expression without COLLATE or wrapping
    fn column_expr(&self) -> &'static str {
        match self {
            LibrarySortColumn::Title => "title",
            LibrarySortColumn::Artist => ARTIST_SORT_EXPR,
            LibrarySortColumn::Album => "album",
            LibrarySortColumn::AddedDate => "added_date",
            LibrarySortColumn::PlayCount => "play_count",
            LibrarySortColumn::Duration => "duration",
            LibrarySortColumn::LastPlayed => "last_played",
            LibrarySortColumn::Year => "date",
            LibrarySortColumn::Genre => "genre",
            LibrarySortColumn::DiscNumber => "disc_number",
            LibrarySortColumn::TrackTotal => "track_total",
            LibrarySortColumn::TrackNumber => "track_number",
        }
    }

    /// Whether this column is a text field that benefits from COLLATE NOCASE
    /// and ignore-words prefix stripping
    fn is_text_column(&self) -> bool {
        matches!(
            self,
            LibrarySortColumn::Title
                | LibrarySortColumn::Artist
                | LibrarySortColumn::Album
                | LibrarySortColumn::Genre
        )
    }

    /// Static SQL expression for backward compatibility (no ignore-words)
    #[allow(dead_code)]
    pub(crate) fn as_sql(&self) -> &'static str {
        match self {
            LibrarySortColumn::Title => "title COLLATE NOCASE",
            LibrarySortColumn::Artist => {
                "COALESCE(NULLIF(album_artist, ''), artist) COLLATE NOCASE"
            }
            LibrarySortColumn::Album => "album COLLATE NOCASE",
            LibrarySortColumn::AddedDate => "added_date",
            LibrarySortColumn::PlayCount => "play_count",
            LibrarySortColumn::Duration => "duration",
            LibrarySortColumn::LastPlayed => "last_played",
            LibrarySortColumn::Year => "date",
            LibrarySortColumn::Genre => "genre",
            LibrarySortColumn::DiscNumber => "disc_number",
            LibrarySortColumn::TrackTotal => "track_total",
            LibrarySortColumn::TrackNumber => "track_number",
        }
    }

    /// Build a text sort expression, optionally wrapping with strip_sort_prefix.
    /// Escapes single quotes in the ignore_words CSV for safe SQL interpolation.
    fn text_sort_expr(col: &str, ignore_words: Option<&str>) -> String {
        match ignore_words {
            Some(words) => {
                let escaped = words.replace('\'', "''");
                format!("strip_sort_prefix({col}, '{escaped}') COLLATE NOCASE")
            }
            None => format!("{col} COLLATE NOCASE"),
        }
    }

    /// ORDER BY expression for the primary sort column.
    /// When `ignore_words` is provided, text columns are wrapped with
    /// `strip_sort_prefix()` to strip article prefixes before comparison.
    pub fn as_order_by(&self, ignore_words: Option<&str>) -> String {
        if self.is_text_column() {
            Self::text_sort_expr(self.column_expr(), ignore_words)
        } else {
            self.column_expr().to_string()
        }
    }

    /// Returns secondary ORDER BY columns for deterministic album track ordering.
    /// Ensures tracks within the same album are sorted by disc number then track number.
    /// Uses CAST(... AS INTEGER) because track_number and disc_number are TEXT columns.
    #[allow(dead_code)]
    pub(crate) fn secondary_sort_sql(&self) -> &'static str {
        match self {
            LibrarySortColumn::Artist => {
                ", album COLLATE NOCASE ASC, CAST(disc_number AS INTEGER) ASC, CAST(track_number AS INTEGER) ASC"
            }
            LibrarySortColumn::Album => {
                ", COALESCE(NULLIF(album_artist, ''), artist) COLLATE NOCASE ASC, CAST(disc_number AS INTEGER) ASC, CAST(track_number AS INTEGER) ASC"
            }
            LibrarySortColumn::DiscNumber => ", CAST(track_number AS INTEGER) ASC",
            LibrarySortColumn::TrackNumber => ", CAST(disc_number AS INTEGER) ASC",
            _ => {
                ", COALESCE(NULLIF(album_artist, ''), artist) COLLATE NOCASE ASC, album COLLATE NOCASE ASC, CAST(disc_number AS INTEGER) ASC, CAST(track_number AS INTEGER) ASC"
            }
        }
    }

    /// Secondary ORDER BY with optional ignore-words wrapping on text columns.
    pub(crate) fn secondary_order_by(&self, ignore_words: Option<&str>) -> String {
        let album_expr = Self::text_sort_expr("album", ignore_words);
        let artist_expr = Self::text_sort_expr(ARTIST_SORT_EXPR, ignore_words);
        let disc = "CAST(disc_number AS INTEGER) ASC";
        let track = "CAST(track_number AS INTEGER) ASC";

        match self {
            LibrarySortColumn::Artist => format!(", {album_expr} ASC, {disc}, {track}"),
            LibrarySortColumn::Album => format!(", {artist_expr} ASC, {disc}, {track}"),
            LibrarySortColumn::DiscNumber => format!(", {track}"),
            LibrarySortColumn::TrackNumber => format!(", {disc}"),
            _ => format!(", {artist_expr} ASC, {album_expr} ASC, {disc}, {track}"),
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
            "date" | "year" => LibrarySortColumn::Year,
            "genre" => LibrarySortColumn::Genre,
            "disc_number" => LibrarySortColumn::DiscNumber,
            "track_total" => LibrarySortColumn::TrackTotal,
            "track_number" => LibrarySortColumn::TrackNumber,
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
    fn test_artist_sort_expr_uses_nullif() {
        // Empty album_artist should fall through to artist, not sort as ""
        let expr = ARTIST_SORT_EXPR;
        assert!(
            expr.contains("NULLIF"),
            "ARTIST_SORT_EXPR must use NULLIF to handle empty album_artist: {expr}"
        );
        assert!(
            expr.contains("NULLIF(album_artist, '')"),
            "ARTIST_SORT_EXPR must convert empty album_artist to NULL: {expr}"
        );
    }

    #[test]
    fn test_artist_order_by_with_ignore_words() {
        let col = LibrarySortColumn::Artist;
        let order_by = col.as_order_by(Some("the, a, an"));
        assert!(
            order_by.contains("NULLIF(album_artist, '')"),
            "Artist ORDER BY must handle empty album_artist: {order_by}"
        );
        assert!(
            order_by.contains("strip_sort_prefix"),
            "Artist ORDER BY with ignore_words must use strip_sort_prefix: {order_by}"
        );
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
