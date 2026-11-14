//! Read paths: a paginated page, filtered counts, sort offsets, single
//! tracks, stats, and the missing list.
//!
//! These are the DB halves of the `library_get_*` / `library_find_*`
//! commands, moved without change — including the `map_err(|e| e.to_string())`
//! calls, which fix the exact error strings the frontend receives.

use crate::db::Database;
use crate::db::{LibraryCount, LibraryStats, SortOrder, Track, library};

/// Response for paginated library queries
#[derive(Clone, serde::Serialize)]
pub struct LibraryResponse {
    pub tracks: Vec<Track>,
    pub total: i64,
    pub limit: i64,
    pub offset: i64,
}

/// Response for missing tracks queries
#[derive(Clone, serde::Serialize)]
pub struct MissingTracksResponse {
    pub tracks: Vec<Track>,
    pub total: i64,
}

/// Build the paginated query a `library_get_all` request maps to.
///
/// Split out from [`get_all`] because the desktop shadow-diff adapter asks the
/// Zig sidecar the same question and has to compare like with like: both sides
/// get their query from this function, so a defaulted field cannot drift
/// between them.
#[allow(clippy::too_many_arguments)]
pub fn get_all_query(
    search: Option<String>,
    artist: Option<String>,
    album: Option<String>,
    sort_by: Option<String>,
    sort_order: Option<String>,
    limit: Option<i64>,
    offset: Option<i64>,
    ignore_words: Option<String>,
    source_filter: Option<String>,
) -> library::LibraryQuery {
    library::LibraryQuery {
        search,
        artist,
        album,
        genre: None,
        year_from: None,
        year_to: None,
        sort_by: sort_by
            .as_ref()
            .and_then(|s| s.parse().ok())
            .unwrap_or_default(),
        sort_order: sort_order
            .as_ref()
            .map(|s| {
                if s.to_lowercase() == "asc" {
                    SortOrder::Asc
                } else {
                    SortOrder::Desc
                }
            })
            .unwrap_or(SortOrder::Desc),
        limit: limit.unwrap_or(100),
        offset: offset.unwrap_or(0),
        ignore_words,
        source_filter,
    }
}

/// Get all tracks with filtering, sorting, and pagination.
///
/// The query is prepared by [`get_all_query`], not built here, so the caller
/// keeps the exact parameters it asked for (the shadow-diff comparison needs
/// them). Unlike the sibling functions this one also refreshes file sizes:
/// tracks imported before the scanner recorded them show as 0 until asked.
pub fn get_all(db: &Database, query: &library::LibraryQuery) -> Result<LibraryResponse, String> {
    let conn = db.conn().map_err(|e| e.to_string())?;

    // Update file sizes for tracks that have 0 (background operation)
    let _ = library::update_file_sizes(&conn);

    let result = library::get_all_tracks(&conn, query).map_err(|e| e.to_string())?;

    Ok(LibraryResponse {
        tracks: result.items,
        total: result.total,
        limit: query.limit,
        offset: query.offset,
    })
}

/// Get filtered count and total duration without loading track data
pub fn get_count(
    db: &Database,
    search: Option<String>,
    artist: Option<String>,
    album: Option<String>,
) -> Result<LibraryCount, String> {
    let conn = db.conn().map_err(|e| e.to_string())?;
    let query = library::LibraryQuery {
        search,
        artist,
        album,
        ..Default::default()
    };
    library::get_filtered_count(&conn, &query).map_err(|e| e.to_string())
}

/// Find the 0-based offset of the first row matching a prefix in the current sort order
#[allow(clippy::too_many_arguments)]
pub fn find_offset(
    db: &Database,
    search: Option<String>,
    artist: Option<String>,
    album: Option<String>,
    sort_by: Option<String>,
    sort_order: Option<String>,
    ignore_words: Option<String>,
    prefix: String,
) -> Result<Option<i64>, String> {
    let conn = db.conn().map_err(|e| e.to_string())?;
    let query = library::LibraryQuery {
        search,
        artist,
        album,
        sort_by: sort_by
            .as_ref()
            .and_then(|s| s.parse().ok())
            .unwrap_or_default(),
        sort_order: sort_order
            .as_ref()
            .map(|s| {
                if s.to_lowercase() == "asc" {
                    SortOrder::Asc
                } else {
                    SortOrder::Desc
                }
            })
            .unwrap_or(SortOrder::Desc),
        ignore_words,
        ..Default::default()
    };
    library::find_sort_offset(&conn, &query, &prefix).map_err(|e| e.to_string())
}

/// Find the 0-based offset of a specific track ID in the current sort/filter order.
///
/// Returns `None` if the track is filtered out (e.g. by search) or does not exist.
#[allow(clippy::too_many_arguments)]
pub fn find_track_offset(
    db: &Database,
    track_id: i64,
    search: Option<String>,
    artist: Option<String>,
    album: Option<String>,
    sort_by: Option<String>,
    sort_order: Option<String>,
    ignore_words: Option<String>,
) -> Result<Option<i64>, String> {
    let conn = db.conn().map_err(|e| e.to_string())?;
    let query = library::LibraryQuery {
        search,
        artist,
        album,
        sort_by: sort_by
            .as_ref()
            .and_then(|s| s.parse().ok())
            .unwrap_or_default(),
        sort_order: sort_order
            .as_ref()
            .map(|s| {
                if s.to_lowercase() == "asc" {
                    SortOrder::Asc
                } else {
                    SortOrder::Desc
                }
            })
            .unwrap_or(SortOrder::Desc),
        ignore_words,
        ..Default::default()
    };
    library::find_track_offset(&conn, &query, track_id).map_err(|e| e.to_string())
}

/// Get library statistics
pub fn get_stats(db: &Database) -> Result<LibraryStats, String> {
    let conn = db.conn().map_err(|e| e.to_string())?;
    library::get_library_stats(&conn).map_err(|e| e.to_string())
}

/// Get a single track by ID
pub fn get_track(db: &Database, track_id: i64) -> Result<Option<Track>, String> {
    let conn = db.conn().map_err(|e| e.to_string())?;
    library::get_track_by_id(&conn, track_id).map_err(|e| e.to_string())
}

/// Get all tracks marked as missing
pub fn get_missing(db: &Database) -> Result<MissingTracksResponse, String> {
    let conn = db.conn().map_err(|e| e.to_string())?;

    let tracks = library::get_missing_tracks(&conn).map_err(|e| e.to_string())?;
    let total = tracks.len() as i64;

    Ok(MissingTracksResponse { tracks, total })
}

#[cfg(test)]
#[path = "queries_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "queries_read_tests.rs"]
mod read_tests;
