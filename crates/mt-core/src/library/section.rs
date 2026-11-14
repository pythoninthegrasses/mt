//! Section view models: one call that returns the tracks, the authoritative
//! stats, and the revision for any library section.
//!
//! Moved verbatim from the desktop `library_get_section` command. The whole
//! dispatch runs inside one transaction so the counts cannot disagree with the
//! page that ships beside them.

use rusqlite::Connection;

use crate::db::{
    Database, DbError, DbResult, SortOrder, Track, favorites, library, playlists, revision,
};

/// Unified response for any library section view.
#[derive(Clone, Debug, serde::Serialize)]
pub struct LibrarySectionResponse {
    pub section: String,
    pub tracks: Vec<Track>,
    pub total_tracks: i64,
    pub total_duration: f64,
    pub total_size: i64,
    /// Count of local files only (excludes remote Plex tracks). For the "all"
    /// section this differs from total_tracks; other sections set it equal to
    /// total_tracks.
    pub local_file_count: i64,
    pub page: Option<i64>,
    pub page_size: Option<i64>,
    pub has_more: bool,
    pub revision: i64,
}

/// Get a complete view model for any library section in a single call.
///
/// Replaces the pattern of separate getCount + getTracks calls. Returns tracks,
/// authoritative stats, and a revision number for cache invalidation — all from
/// the same DB transaction so counts are consistent with the returned page.
#[allow(clippy::too_many_arguments)]
pub fn get_section(
    db: &Database,
    section: String,
    search: Option<String>,
    artist: Option<String>,
    album: Option<String>,
    sort_by: Option<String>,
    sort_order: Option<String>,
    limit: Option<i64>,
    offset: Option<i64>,
    ignore_words: Option<String>,
    days: Option<i64>,
) -> Result<LibrarySectionResponse, String> {
    db.transaction(|conn| {
        let rev = revision::get_revision(conn)?;

        match section.as_str() {
            "all" => get_section_all(
                conn,
                rev,
                search,
                artist,
                album,
                sort_by,
                sort_order,
                limit,
                offset,
                ignore_words,
            ),
            "liked" => get_section_liked(conn, rev, limit, offset),
            "top25" => get_section_top25(conn, rev),
            "recent" => get_section_recent(conn, rev, days, limit),
            "added" => get_section_added(conn, rev, days, limit),
            s if s.starts_with("playlist-") => {
                let id_str = &s["playlist-".len()..];
                let playlist_id: i64 = id_str
                    .parse()
                    .map_err(|_| DbError::NotFound(format!("Invalid playlist id: {}", id_str)))?;
                get_section_playlist(conn, rev, playlist_id)
            }
            _ => Err(DbError::NotFound(format!("Unknown section: {}", section))),
        }
    })
    .map_err(|e| e.to_string())
}

/// "all" section: paginated library with search/sort/filter.
#[allow(clippy::too_many_arguments)]
pub(crate) fn get_section_all(
    conn: &Connection,
    rev: i64,
    search: Option<String>,
    artist: Option<String>,
    album: Option<String>,
    sort_by: Option<String>,
    sort_order: Option<String>,
    limit: Option<i64>,
    offset: Option<i64>,
    ignore_words: Option<String>,
) -> DbResult<LibrarySectionResponse> {
    let page_size = limit.unwrap_or(500);
    let page_offset = offset.unwrap_or(0);

    let query = library::LibraryQuery {
        search: search.clone(),
        artist: artist.clone(),
        album: album.clone(),
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
        limit: page_size,
        offset: page_offset,
        ignore_words,
        source_filter: None,
    };

    let count_query = library::LibraryQuery {
        search,
        artist,
        album,
        ..Default::default()
    };

    let count = library::get_filtered_count(conn, &count_query)?;
    // When the caller asks for limit=0 we treat the request as a stats-only
    // query: return totals without fetching any rows. This is used by the
    // frontend page cache to confirm a cached page 0 is still valid while
    // avoiding the cost of re-fetching the full first page.
    let (tracks, page, page_size_out, has_more) = if page_size == 0 {
        let (local_file_count_tmp, local_duration_tmp, local_size_tmp) =
            library::get_local_file_stats(conn)?;
        return Ok(LibrarySectionResponse {
            section: "all".to_string(),
            tracks: Vec::new(),
            total_tracks: count.total,
            total_duration: local_duration_tmp as f64,
            total_size: local_size_tmp,
            local_file_count: local_file_count_tmp,
            page: None,
            page_size: Some(0),
            has_more: count.total > 0,
            revision: rev,
        });
    } else {
        let result = library::get_all_tracks(conn, &query)?;
        let has_more = (page_offset + page_size) < count.total;
        (
            result.items,
            Some(page_offset / page_size),
            Some(page_size),
            has_more,
        )
    };

    let (local_file_count, local_duration, local_size) = library::get_local_file_stats(conn)?;

    Ok(LibrarySectionResponse {
        section: "all".to_string(),
        tracks,
        total_tracks: count.total,
        total_duration: local_duration as f64,
        total_size: local_size,
        local_file_count,
        page,
        page_size: page_size_out,
        has_more,
        revision: rev,
    })
}

/// "liked" section: favorited tracks.
pub(crate) fn get_section_liked(
    conn: &Connection,
    rev: i64,
    limit: Option<i64>,
    offset: Option<i64>,
) -> DbResult<LibrarySectionResponse> {
    let lim = limit.unwrap_or(10000);
    let off = offset.unwrap_or(0);
    let result = favorites::get_favorites(conn, lim, off)?;
    let (total, duration, size) = favorites::get_favorites_stats(conn)?;
    let tracks: Vec<Track> = result.items.into_iter().map(|ft| ft.track).collect();

    Ok(LibrarySectionResponse {
        section: "liked".to_string(),
        tracks,
        total_tracks: total,
        total_duration: duration,
        total_size: size,
        local_file_count: total,
        page: None,
        page_size: None,
        has_more: false,
        revision: rev,
    })
}

/// "top25" section: most played tracks.
pub(crate) fn get_section_top25(conn: &Connection, rev: i64) -> DbResult<LibrarySectionResponse> {
    let tracks = favorites::get_top_25(conn)?;
    let (total, duration, size) = favorites::get_top_25_stats(conn)?;

    Ok(LibrarySectionResponse {
        section: "top25".to_string(),
        tracks,
        total_tracks: total,
        total_duration: duration,
        total_size: size,
        local_file_count: total,
        page: None,
        page_size: None,
        has_more: false,
        revision: rev,
    })
}

/// "recent" section: recently played tracks.
pub(crate) fn get_section_recent(
    conn: &Connection,
    rev: i64,
    days: Option<i64>,
    limit: Option<i64>,
) -> DbResult<LibrarySectionResponse> {
    let d = days.unwrap_or(14).clamp(1, 365);
    let lim = limit.unwrap_or(100).clamp(1, 1000);
    let tracks = favorites::get_recently_played(conn, d, lim)?;
    let (total, duration, size) = favorites::get_recently_played_stats(conn, d, lim)?;

    Ok(LibrarySectionResponse {
        section: "recent".to_string(),
        tracks,
        total_tracks: total,
        total_duration: duration,
        total_size: size,
        local_file_count: total,
        page: None,
        page_size: None,
        has_more: false,
        revision: rev,
    })
}

/// "added" section: recently added tracks.
pub(crate) fn get_section_added(
    conn: &Connection,
    rev: i64,
    days: Option<i64>,
    limit: Option<i64>,
) -> DbResult<LibrarySectionResponse> {
    let d = days.unwrap_or(14).clamp(1, 365);
    let lim = limit.unwrap_or(100).clamp(1, 1000);
    let tracks = favorites::get_recently_added(conn, d, lim)?;
    let (total, duration, size) = favorites::get_recently_added_stats(conn, d, lim)?;

    Ok(LibrarySectionResponse {
        section: "added".to_string(),
        tracks,
        total_tracks: total,
        total_duration: duration,
        total_size: size,
        local_file_count: total,
        page: None,
        page_size: None,
        has_more: false,
        revision: rev,
    })
}

/// "playlist-{id}" section: tracks in a specific playlist.
pub(crate) fn get_section_playlist(
    conn: &Connection,
    rev: i64,
    playlist_id: i64,
) -> DbResult<LibrarySectionResponse> {
    let playlist = playlists::get_playlist(conn, playlist_id)?
        .ok_or_else(|| DbError::NotFound(format!("Playlist {} not found", playlist_id)))?;
    let (total, duration, size) = playlists::get_playlist_stats(conn, playlist_id)?;
    let tracks: Vec<Track> = playlist.tracks.into_iter().map(|pt| pt.track).collect();

    Ok(LibrarySectionResponse {
        section: format!("playlist-{}", playlist_id),
        tracks,
        total_tracks: total,
        total_duration: duration,
        total_size: size,
        local_file_count: total,
        page: None,
        page_size: None,
        has_more: false,
        revision: rev,
    })
}

#[cfg(test)]
#[path = "section_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "section_dispatch_tests.rs"]
mod dispatch_tests;
