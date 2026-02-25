//! Library database operations.
//!
//! CRUD operations for the music library (tracks table).

use rusqlite::{Connection, Row, params};
use std::collections::{HashMap, HashSet};
use std::path::Path;

use crate::db::{
    DbResult, FileFingerprint, LibrarySortColumn, LibraryStats, PaginatedResult, SortOrder, Track,
    TrackMetadata,
};

/// Map a database row to a Track struct
fn row_to_track(row: &Row) -> rusqlite::Result<Track> {
    Ok(Track {
        id: row.get("id")?,
        filepath: row.get("filepath")?,
        title: row.get("title")?,
        artist: row.get("artist")?,
        album: row.get("album")?,
        album_artist: row.get("album_artist")?,
        track_number: row.get("track_number")?,
        track_total: row.get("track_total")?,
        disc_number: row.get("disc_number")?,
        disc_total: row.get("disc_total")?,
        date: row.get("date")?,
        genre: row.get("genre")?,
        duration: row.get("duration")?,
        file_size: row.get::<_, Option<i64>>("file_size")?.unwrap_or(0),
        file_mtime_ns: row.get("file_mtime_ns")?,
        file_inode: row.get("file_inode")?,
        content_hash: row.get("content_hash")?,
        added_date: row.get("added_date")?,
        last_played: row.get("last_played")?,
        play_count: row.get::<_, Option<i64>>("play_count")?.unwrap_or(0),
        missing: row.get::<_, Option<i64>>("missing")?.unwrap_or(0) != 0,
        last_seen_at: row.get("last_seen_at")?,
    })
}

/// Library query parameters
#[derive(Debug, Clone, Default)]
pub struct LibraryQuery {
    pub search: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub sort_by: LibrarySortColumn,
    pub sort_order: SortOrder,
    pub limit: i64,
    pub offset: i64,
    /// CSV of prefix words to strip for text sort ordering (e.g. "the,a,an")
    pub ignore_words: Option<String>,
}

impl LibraryQuery {
    #[allow(dead_code)]
    pub fn new() -> Self {
        Self {
            limit: 100,
            ..Default::default()
        }
    }
}

/// Get tracks from the library with filtering and pagination
pub(crate) fn get_all_tracks(
    conn: &Connection,
    query: &LibraryQuery,
) -> DbResult<PaginatedResult<Track>> {
    let mut conditions = Vec::new();
    let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

    if let Some(search) = &query.search {
        conditions.push("(title LIKE ? OR artist LIKE ? OR album LIKE ?)");
        let search_term = format!("%{}%", search);
        params_vec.push(Box::new(search_term.clone()));
        params_vec.push(Box::new(search_term.clone()));
        params_vec.push(Box::new(search_term));
    }

    if let Some(artist) = &query.artist {
        conditions.push("artist = ?");
        params_vec.push(Box::new(artist.clone()));
    }

    if let Some(album) = &query.album {
        conditions.push("album = ?");
        params_vec.push(Box::new(album.clone()));
    }

    // Always filter out missing tracks from library view
    conditions.push("(missing = 0 OR missing IS NULL)");

    let where_clause = if conditions.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", conditions.join(" AND "))
    };

    // Get total count
    let count_sql = format!("SELECT COUNT(*) FROM library {}", where_clause);
    let params_refs: Vec<&dyn rusqlite::ToSql> = params_vec.iter().map(|p| p.as_ref()).collect();
    let total: i64 = conn.query_row(&count_sql, params_refs.as_slice(), |row| row.get(0))?;

    // Get tracks
    let sql = format!(
        "SELECT id, filepath, title, artist, album, album_artist,
                track_number, track_total, disc_number, disc_total, date, genre,
                duration, file_size, play_count, last_played, added_date,
                missing, last_seen_at, file_mtime_ns, file_inode, content_hash
         FROM library
         {}
         ORDER BY {} {}{}
         LIMIT ? OFFSET ?",
        where_clause,
        query.sort_by.as_order_by(query.ignore_words.as_deref()),
        query.sort_order.as_sql(),
        query
            .sort_by
            .secondary_order_by(query.ignore_words.as_deref())
    );

    let mut all_params: Vec<&dyn rusqlite::ToSql> = params_refs;
    all_params.push(&query.limit);
    all_params.push(&query.offset);

    let mut stmt = conn.prepare(&sql)?;
    let tracks: Vec<Track> = stmt
        .query_map(all_params.as_slice(), row_to_track)?
        .filter_map(|r| r.ok())
        .collect();

    Ok(PaginatedResult {
        items: tracks,
        total,
    })
}

/// Find all library tracks matching a given artist and title.
///
/// Uses exact case-insensitive matching on title AND (artist OR album_artist).
/// Returns all matches (e.g. same song on different albums) for disambiguation.
pub(crate) fn find_tracks_by_artist_title(
    conn: &Connection,
    artist: &str,
    title: &str,
) -> DbResult<Vec<Track>> {
    let sql = "SELECT id, filepath, title, artist, album, album_artist,
            track_number, track_total, disc_number, disc_total, date, genre,
            duration, file_size, play_count, last_played, added_date,
            missing, last_seen_at, file_mtime_ns, file_inode, content_hash
     FROM library
     WHERE (missing = 0 OR missing IS NULL)
       AND title = ? COLLATE NOCASE
       AND (artist = ? COLLATE NOCASE OR album_artist = ? COLLATE NOCASE)";

    let mut stmt = conn.prepare(sql)?;
    let tracks: Vec<Track> = stmt
        .query_map(params![title, artist, artist], row_to_track)?
        .filter_map(|r| r.ok())
        .collect();

    Ok(tracks)
}

/// Find a single library track matching a given artist and title.
///
/// Convenience wrapper around `find_tracks_by_artist_title` that returns the
/// first match. Use `find_tracks_by_artist_title` when disambiguation is needed.
#[allow(dead_code)]
pub(crate) fn find_track_by_artist_title(
    conn: &Connection,
    artist: &str,
    title: &str,
) -> DbResult<Option<Track>> {
    let tracks = find_tracks_by_artist_title(conn, artist, title)?;
    Ok(tracks.into_iter().next())
}

/// Get a single track by ID
pub(crate) fn get_track_by_id(conn: &Connection, track_id: i64) -> DbResult<Option<Track>> {
    let mut stmt = conn.prepare(
        "SELECT id, filepath, title, artist, album, album_artist,
                track_number, track_total, disc_number, disc_total, date, genre,
                duration, file_size, play_count, last_played, added_date,
                missing, last_seen_at, file_mtime_ns, file_inode, content_hash
         FROM library WHERE id = ?",
    )?;

    let result = stmt.query_row([track_id], row_to_track);
    match result {
        Ok(track) => Ok(Some(track)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

/// Get a track by filepath
pub(crate) fn get_track_by_filepath(conn: &Connection, filepath: &str) -> DbResult<Option<Track>> {
    let mut stmt = conn.prepare(
        "SELECT id, filepath, title, artist, album, album_artist,
                track_number, track_total, disc_number, disc_total, date, genre,
                duration, file_size, play_count, last_played, added_date,
                missing, last_seen_at, file_mtime_ns, file_inode, content_hash
         FROM library WHERE filepath = ?",
    )?;

    let result = stmt.query_row([filepath], row_to_track);
    match result {
        Ok(track) => Ok(Some(track)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

/// Check which filepaths already exist in the library
#[allow(dead_code)]
pub(crate) fn get_existing_filepaths(
    conn: &Connection,
    filepaths: &[String],
) -> DbResult<HashSet<String>> {
    if filepaths.is_empty() {
        return Ok(HashSet::new());
    }

    let placeholders = filepaths.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let sql = format!(
        "SELECT filepath FROM library WHERE filepath IN ({})",
        placeholders
    );

    let mut stmt = conn.prepare(&sql)?;
    let params: Vec<&dyn rusqlite::ToSql> = filepaths
        .iter()
        .map(|s| s as &dyn rusqlite::ToSql)
        .collect();

    let existing: HashSet<String> = stmt
        .query_map(params.as_slice(), |row| row.get::<_, String>(0))?
        .filter_map(|r| r.ok())
        .collect();

    Ok(existing)
}

/// Get fingerprints for all tracks (filepath, mtime, size)
#[allow(dead_code)]
pub(crate) fn get_all_fingerprints(
    conn: &Connection,
) -> DbResult<HashMap<String, FileFingerprint>> {
    let mut stmt = conn.prepare("SELECT filepath, file_mtime_ns, file_size FROM library")?;

    let fingerprints: HashMap<String, FileFingerprint> = stmt
        .query_map([], |row| {
            Ok(FileFingerprint {
                filepath: row.get(0)?,
                file_mtime_ns: row.get(1)?,
                file_size: row.get::<_, Option<i64>>(2)?.unwrap_or(0),
            })
        })?
        .filter_map(|r| r.ok())
        .map(|fp| (fp.filepath.clone(), fp))
        .collect();

    Ok(fingerprints)
}

/// Add a track to the library
#[allow(dead_code)]
pub(crate) fn add_track(
    conn: &Connection,
    filepath: &str,
    metadata: &TrackMetadata,
) -> DbResult<i64> {
    conn.execute(
        "INSERT INTO library
         (filepath, title, artist, album, album_artist,
          track_number, track_total, disc_number, disc_total, date, genre,
          duration, file_size, file_mtime_ns, file_inode, content_hash, missing)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)",
        params![
            filepath,
            metadata.title,
            metadata.artist,
            metadata.album,
            metadata.album_artist,
            metadata.track_number,
            metadata.track_total,
            metadata.disc_number,
            metadata.disc_total,
            metadata.date,
            metadata.genre,
            metadata.duration,
            metadata.file_size.unwrap_or(0),
            metadata.file_mtime_ns,
            metadata.file_inode.map(|v| v as i64),
            metadata.content_hash,
        ],
    )?;

    Ok(conn.last_insert_rowid())
}

/// Add multiple tracks in a single transaction
pub(crate) fn add_tracks_bulk(
    conn: &Connection,
    tracks: &[(String, TrackMetadata)],
) -> DbResult<i64> {
    if tracks.is_empty() {
        return Ok(0);
    }

    let mut stmt = conn.prepare(
        "INSERT INTO library
         (filepath, title, artist, album, album_artist,
          track_number, track_total, disc_number, disc_total, date, genre,
          duration, file_size, file_mtime_ns, file_inode, content_hash, missing)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)",
    )?;

    let mut count = 0;
    for (filepath, metadata) in tracks {
        stmt.execute(params![
            filepath,
            metadata.title,
            metadata.artist,
            metadata.album,
            metadata.album_artist,
            metadata.track_number,
            metadata.track_total,
            metadata.disc_number,
            metadata.disc_total,
            metadata.date,
            metadata.genre,
            metadata.duration,
            metadata.file_size.unwrap_or(0),
            metadata.file_mtime_ns,
            metadata.file_inode.map(|v| v as i64),
            metadata.content_hash,
        ])?;
        count += 1;
    }

    Ok(count)
}

/// Get track IDs by filepaths
///
/// Returns a Vec of track IDs for the given filepaths (in the same order).
/// Missing filepaths are skipped.
pub(crate) fn get_track_ids_by_filepaths(
    conn: &Connection,
    filepaths: &[String],
) -> DbResult<Vec<i64>> {
    if filepaths.is_empty() {
        return Ok(vec![]);
    }

    let placeholders = filepaths.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let sql = format!(
        "SELECT id FROM library WHERE filepath IN ({}) ORDER BY id ASC",
        placeholders
    );

    let mut stmt = conn.prepare(&sql)?;
    let ids: Vec<i64> = stmt
        .query_map(rusqlite::params_from_iter(filepaths.iter()), |row| {
            row.get(0)
        })?
        .filter_map(|r| r.ok())
        .collect();

    Ok(ids)
}

/// Update multiple tracks in a single transaction
pub(crate) fn update_tracks_bulk(
    conn: &Connection,
    tracks: &[(String, TrackMetadata)],
) -> DbResult<i64> {
    if tracks.is_empty() {
        return Ok(0);
    }

    let mut stmt = conn.prepare(
        "UPDATE library SET
            title = ?,
            artist = ?,
            album = ?,
            album_artist = ?,
            track_number = ?,
            track_total = ?,
            disc_number = ?,
            disc_total = ?,
            date = ?,
            genre = ?,
            duration = ?,
            file_size = ?,
            file_mtime_ns = ?
         WHERE filepath = ?",
    )?;

    let mut count = 0;
    for (filepath, metadata) in tracks {
        let rows = stmt.execute(params![
            metadata.title,
            metadata.artist,
            metadata.album,
            metadata.album_artist,
            metadata.track_number,
            metadata.track_total,
            metadata.disc_number,
            metadata.disc_total,
            metadata.date,
            metadata.genre,
            metadata.duration,
            metadata.file_size.unwrap_or(0),
            metadata.file_mtime_ns,
            filepath,
        ])?;
        count += rows as i64;
    }

    Ok(count)
}

/// Delete multiple tracks by filepath
#[allow(dead_code)]
pub(crate) fn delete_tracks_bulk(conn: &Connection, filepaths: &[String]) -> DbResult<i64> {
    if filepaths.is_empty() {
        return Ok(0);
    }

    let placeholders = filepaths.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let params: Vec<&dyn rusqlite::ToSql> = filepaths
        .iter()
        .map(|s| s as &dyn rusqlite::ToSql)
        .collect();

    // Delete from favorites first
    let sql = format!(
        "DELETE FROM favorites
         WHERE track_id IN (SELECT id FROM library WHERE filepath IN ({}))",
        placeholders
    );
    conn.execute(&sql, params.as_slice())?;

    // Delete from playlist_items
    let sql = format!(
        "DELETE FROM playlist_items
         WHERE track_id IN (SELECT id FROM library WHERE filepath IN ({}))",
        placeholders
    );
    conn.execute(&sql, params.as_slice())?;

    // Delete tracks
    let sql = format!("DELETE FROM library WHERE filepath IN ({})", placeholders);
    let deleted = conn.execute(&sql, params.as_slice())?;

    Ok(deleted as i64)
}

/// Delete a track by ID
pub(crate) fn delete_track(conn: &Connection, track_id: i64) -> DbResult<bool> {
    conn.execute("DELETE FROM favorites WHERE track_id = ?", [track_id])?;
    conn.execute("DELETE FROM playlist_items WHERE track_id = ?", [track_id])?;
    let deleted = conn.execute("DELETE FROM library WHERE id = ?", [track_id])?;
    Ok(deleted > 0)
}

/// Hard-delete all tracks marked as missing, including their favorites and playlist_items.
pub(crate) fn delete_missing_tracks(conn: &Connection) -> DbResult<usize> {
    conn.execute(
        "DELETE FROM favorites WHERE track_id IN (SELECT id FROM library WHERE missing = 1)",
        [],
    )?;
    conn.execute(
        "DELETE FROM playlist_items WHERE track_id IN (SELECT id FROM library WHERE missing = 1)",
        [],
    )?;
    let deleted = conn.execute("DELETE FROM library WHERE missing = 1", [])?;
    Ok(deleted)
}

/// Delete multiple tracks by ID, including their favorites and playlist_items.
/// Returns the number of library rows deleted.
pub(crate) fn delete_tracks_by_ids(conn: &Connection, track_ids: &[i64]) -> DbResult<usize> {
    if track_ids.is_empty() {
        return Ok(0);
    }

    let placeholders = track_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let params: Vec<&dyn rusqlite::ToSql> = track_ids
        .iter()
        .map(|id| id as &dyn rusqlite::ToSql)
        .collect();

    let sql = format!("DELETE FROM favorites WHERE track_id IN ({})", placeholders);
    conn.execute(&sql, params.as_slice())?;

    let sql = format!(
        "DELETE FROM playlist_items WHERE track_id IN ({})",
        placeholders
    );
    conn.execute(&sql, params.as_slice())?;

    let sql = format!("DELETE FROM library WHERE id IN ({})", placeholders);
    let deleted = conn.execute(&sql, params.as_slice())?;
    Ok(deleted)
}

/// Delete ALL tracks from the library, including their favorites and playlist_items.
/// Returns the number of library rows deleted.
pub(crate) fn delete_all_tracks(conn: &Connection) -> DbResult<usize> {
    conn.execute("DELETE FROM favorites", [])?;
    conn.execute("DELETE FROM playlist_items", [])?;
    let deleted = conn.execute("DELETE FROM library", [])?;
    Ok(deleted)
}

/// Update track metadata by ID
pub(crate) fn update_track_metadata(
    conn: &Connection,
    track_id: i64,
    metadata: &TrackMetadata,
) -> DbResult<bool> {
    let updated = conn.execute(
        "UPDATE library SET
            title = ?,
            artist = ?,
            album = ?,
            album_artist = ?,
            track_number = ?,
            track_total = ?,
            disc_number = ?,
            disc_total = ?,
            date = ?,
            genre = ?,
            duration = ?,
            file_size = ?,
            file_mtime_ns = ?
         WHERE id = ?",
        params![
            metadata.title,
            metadata.artist,
            metadata.album,
            metadata.album_artist,
            metadata.track_number,
            metadata.track_total,
            metadata.disc_number,
            metadata.disc_total,
            metadata.date,
            metadata.genre,
            metadata.duration,
            metadata.file_size.unwrap_or(0),
            metadata.file_mtime_ns,
            track_id,
        ],
    )?;

    Ok(updated > 0)
}

/// Increment play count for a track
pub(crate) fn update_play_count(conn: &Connection, track_id: i64) -> DbResult<Option<Track>> {
    conn.execute(
        "UPDATE library SET
            play_count = play_count + 1,
            last_played = CURRENT_TIMESTAMP
         WHERE id = ?",
        [track_id],
    )?;

    get_track_by_id(conn, track_id)
}

/// Get library statistics
pub(crate) fn get_library_stats(conn: &Connection) -> DbResult<LibraryStats> {
    // Only count non-missing tracks
    let total_tracks: i64 = conn.query_row(
        "SELECT COUNT(*) FROM library WHERE (missing = 0 OR missing IS NULL)",
        [],
        |row| row.get(0),
    )?;

    // Duration is stored as REAL, so read as f64 and convert
    let total_duration: i64 = conn.query_row(
        "SELECT COALESCE(SUM(duration), 0) FROM library WHERE (missing = 0 OR missing IS NULL)",
        [],
        |row| row.get::<_, f64>(0).map(|v| v as i64),
    )?;

    let total_size: i64 = conn.query_row(
        "SELECT COALESCE(SUM(file_size), 0) FROM library WHERE (missing = 0 OR missing IS NULL)",
        [],
        |row| row.get(0),
    )?;

    let total_artists: i64 = conn.query_row(
        "SELECT COUNT(DISTINCT artist) FROM library WHERE artist IS NOT NULL AND (missing = 0 OR missing IS NULL)",
        [],
        |row| row.get(0),
    )?;

    let total_albums: i64 = conn.query_row(
        "SELECT COUNT(DISTINCT album) FROM library WHERE album IS NOT NULL AND (missing = 0 OR missing IS NULL)",
        [],
        |row| row.get(0),
    )?;

    Ok(LibraryStats {
        total_tracks,
        total_duration,
        total_size,
        total_artists,
        total_albums,
    })
}

/// Update file sizes for tracks with file_size = 0
pub(crate) fn update_file_sizes(conn: &Connection) -> DbResult<i64> {
    let mut stmt =
        conn.prepare("SELECT id, filepath FROM library WHERE file_size = 0 OR file_size IS NULL")?;

    let tracks: Vec<(i64, String)> = stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
        .filter_map(|r| r.ok())
        .collect();

    let mut updated = 0;
    for (id, filepath) in tracks {
        if let Ok(metadata) = std::fs::metadata(&filepath) {
            let size = metadata.len() as i64;
            conn.execute("UPDATE library SET file_size = ? WHERE id = ?", [size, id])?;
            updated += 1;
        }
    }

    Ok(updated)
}

/// Mark a track as missing by ID
pub(crate) fn mark_track_missing(conn: &Connection, track_id: i64) -> DbResult<bool> {
    let updated = conn.execute("UPDATE library SET missing = 1 WHERE id = ?", [track_id])?;
    Ok(updated > 0)
}

/// Mark a track as missing by filepath
pub(crate) fn mark_track_missing_by_filepath(conn: &Connection, filepath: &str) -> DbResult<bool> {
    let updated = conn.execute(
        "UPDATE library SET missing = 1 WHERE filepath = ?",
        [filepath],
    )?;
    Ok(updated > 0)
}

/// Mark a track as present
pub(crate) fn mark_track_present(conn: &Connection, track_id: i64) -> DbResult<bool> {
    let updated = conn.execute(
        "UPDATE library SET missing = 0, last_seen_at = strftime('%s','now') WHERE id = ?",
        [track_id],
    )?;
    Ok(updated > 0)
}

/// Mark a track as present by filepath (clears missing flag if file reappears)
#[allow(dead_code)]
pub(crate) fn mark_track_present_by_filepath(conn: &Connection, filepath: &str) -> DbResult<bool> {
    let updated = conn.execute(
        "UPDATE library SET missing = 0, last_seen_at = strftime('%s','now') WHERE filepath = ? AND missing = 1",
        [filepath],
    )?;
    Ok(updated > 0)
}

/// Mark multiple tracks as present by their filepaths (batch operation)
/// Returns the number of tracks that were updated
pub(crate) fn mark_tracks_present_by_filepaths(
    conn: &Connection,
    filepaths: &[String],
) -> DbResult<usize> {
    if filepaths.is_empty() {
        return Ok(0);
    }

    // Batch update only tracks that are currently marked as missing
    let placeholders: String = filepaths.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let sql = format!(
        "UPDATE library SET missing = 0, last_seen_at = strftime('%s','now') WHERE filepath IN ({}) AND missing = 1",
        placeholders
    );

    let params: Vec<&dyn rusqlite::ToSql> = filepaths
        .iter()
        .map(|s| s as &dyn rusqlite::ToSql)
        .collect();

    let updated = conn.execute(&sql, params.as_slice())?;
    Ok(updated)
}

/// Update track filepath
pub(crate) fn update_track_filepath(
    conn: &Connection,
    track_id: i64,
    new_path: &str,
) -> DbResult<bool> {
    let updated = conn.execute(
        "UPDATE library SET filepath = ?, missing = 0, last_seen_at = strftime('%s','now') WHERE id = ?",
        params![new_path, track_id],
    )?;
    Ok(updated > 0)
}

/// Get fingerprints (filepath, mtime, size) for tracks under the given paths.
/// Scopes the query at SQL level instead of fetching all tracks and filtering in memory.
/// Each path matches either as an exact filepath or as a directory prefix (path/).
pub(crate) fn get_fingerprints_for_paths(
    conn: &Connection,
    scan_paths: &[String],
) -> DbResult<Vec<(String, Option<i64>, i64)>> {
    if scan_paths.is_empty() {
        return Ok(Vec::new());
    }

    // For each scan path, match both exact filepath and directory prefix.
    // This handles both file paths and directory paths without needing to check
    // the filesystem (which fails in tests with synthetic paths).
    let mut conditions: Vec<String> = Vec::new();
    for p in scan_paths {
        let escaped = p.replace('\'', "''");
        // Exact file match
        conditions.push(format!("filepath = '{}'", escaped));
        // Directory prefix match (path + '/')
        let prefix = if escaped.ends_with('/') {
            escaped
        } else {
            format!("{}/", escaped)
        };
        conditions.push(format!("filepath LIKE '{}%'", prefix));
    }

    let where_clause = conditions.join(" OR ");
    let sql = format!(
        "SELECT filepath, file_mtime_ns, file_size FROM library WHERE {}",
        where_clause
    );

    let mut stmt = conn.prepare(&sql)?;
    let rows: Vec<(String, Option<i64>, i64)> = stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?
        .filter_map(|r| r.ok())
        .collect();

    Ok(rows)
}

/// Get all missing tracks
pub(crate) fn get_missing_tracks(conn: &Connection) -> DbResult<Vec<Track>> {
    let mut stmt = conn.prepare(
        "SELECT id, filepath, title, artist, album, album_artist,
                track_number, track_total, disc_number, disc_total, date, genre,
                duration, file_size, play_count, last_played, added_date,
                missing, last_seen_at, file_mtime_ns, file_inode, content_hash
         FROM library WHERE missing = 1 ORDER BY title ASC",
    )?;

    let tracks: Vec<Track> = stmt
        .query_map([], row_to_track)?
        .filter_map(|r| r.ok())
        .collect();

    Ok(tracks)
}

/// Check and update track status based on file existence
pub(crate) fn check_and_update_track_status(
    conn: &Connection,
    track_id: i64,
) -> DbResult<Option<Track>> {
    let track = get_track_by_id(conn, track_id)?;

    if let Some(ref t) = track {
        let exists = Path::new(&t.filepath).exists();
        if exists && t.missing {
            mark_track_present(conn, track_id)?;
        } else if !exists && !t.missing {
            mark_track_missing(conn, track_id)?;
        }
    }

    get_track_by_id(conn, track_id)
}

#[allow(dead_code)]
pub(crate) fn find_missing_track_by_inode(
    conn: &Connection,
    inode: u64,
) -> DbResult<Option<Track>> {
    let mut stmt = conn.prepare(
        "SELECT id, filepath, title, artist, album, album_artist,
                track_number, track_total, disc_number, disc_total, date, genre,
                duration, file_size, play_count, last_played, added_date,
                missing, last_seen_at, file_mtime_ns, file_inode, content_hash
         FROM library WHERE file_inode = ? AND missing = 1 LIMIT 1",
    )?;

    let result = stmt.query_row([inode as i64], row_to_track);
    match result {
        Ok(track) => Ok(Some(track)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

#[allow(dead_code)]
pub(crate) fn find_missing_track_by_content_hash(
    conn: &Connection,
    content_hash: &str,
) -> DbResult<Option<Track>> {
    let mut stmt = conn.prepare(
        "SELECT id, filepath, title, artist, album, album_artist,
                track_number, track_total, disc_number, disc_total, date, genre,
                duration, file_size, play_count, last_played, added_date,
                missing, last_seen_at, file_mtime_ns, file_inode, content_hash
         FROM library WHERE content_hash = ? AND missing = 1 LIMIT 1",
    )?;

    let result = stmt.query_row([content_hash], row_to_track);
    match result {
        Ok(track) => Ok(Some(track)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

pub(crate) fn reconcile_moved_track(
    conn: &Connection,
    track_id: i64,
    new_filepath: &str,
    new_inode: Option<u64>,
) -> DbResult<Option<Track>> {
    conn.execute(
        "UPDATE library SET
            filepath = ?,
            file_inode = ?,
            missing = 0,
            last_seen_at = strftime('%s','now')
         WHERE id = ?",
        params![new_filepath, new_inode.map(|v| v as i64), track_id],
    )?;

    get_track_by_id(conn, track_id)
}

/// Track info for fingerprint backfill (minimal struct to reduce memory)
#[derive(Debug)]
pub struct TrackForBackfill {
    pub id: i64,
    pub filepath: String,
}

/// Get tracks that need fingerprint backfill (missing inode or content_hash)
pub(crate) fn get_tracks_needing_fingerprints(
    conn: &Connection,
) -> DbResult<Vec<TrackForBackfill>> {
    let mut stmt = conn.prepare(
        "SELECT id, filepath FROM library
         WHERE (file_inode IS NULL OR content_hash IS NULL) AND missing = 0",
    )?;

    let tracks: Vec<TrackForBackfill> = stmt
        .query_map([], |row| {
            Ok(TrackForBackfill {
                id: row.get(0)?,
                filepath: row.get(1)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();

    Ok(tracks)
}

/// Update a track's fingerprint (inode and content_hash)
pub(crate) fn update_track_fingerprints(
    conn: &Connection,
    track_id: i64,
    inode: Option<u64>,
    content_hash: Option<&str>,
) -> DbResult<bool> {
    let updated = conn.execute(
        "UPDATE library SET file_inode = ?, content_hash = ? WHERE id = ?",
        params![inode.map(|v| v as i64), content_hash, track_id],
    )?;
    Ok(updated > 0)
}

/// Duplicate track info for merge decisions
#[derive(Debug)]
#[allow(dead_code)] // Fields read in find_duplicates_by_inode callers
pub struct DuplicateCandidate {
    pub id: i64,
    pub filepath: String,
    pub missing: bool,
    pub play_count: i64,
    pub added_date: Option<String>,
}

/// Find duplicate tracks by inode (tracks with same inode)
pub(crate) fn find_duplicates_by_inode(
    conn: &Connection,
) -> DbResult<Vec<Vec<DuplicateCandidate>>> {
    // Find inodes that appear more than once
    let mut stmt = conn.prepare(
        "SELECT file_inode FROM library
         WHERE file_inode IS NOT NULL
         GROUP BY file_inode
         HAVING COUNT(*) > 1",
    )?;

    let duplicate_inodes: Vec<i64> = stmt
        .query_map([], |row| row.get(0))?
        .filter_map(|r| r.ok())
        .collect();

    let mut result = Vec::new();

    for inode in duplicate_inodes {
        let mut stmt = conn.prepare(
            "SELECT id, filepath, missing, play_count, added_date
             FROM library WHERE file_inode = ?
             ORDER BY missing ASC, added_date ASC",
        )?;

        let candidates: Vec<DuplicateCandidate> = stmt
            .query_map([inode], |row| {
                Ok(DuplicateCandidate {
                    id: row.get(0)?,
                    filepath: row.get(1)?,
                    missing: row.get::<_, Option<i64>>(2)?.unwrap_or(0) != 0,
                    play_count: row.get::<_, Option<i64>>(3)?.unwrap_or(0),
                    added_date: row.get(4)?,
                })
            })?
            .filter_map(|r| r.ok())
            .collect();

        if candidates.len() > 1 {
            result.push(candidates);
        }
    }

    Ok(result)
}

/// Find duplicate tracks by content_hash (tracks with same hash)
pub(crate) fn find_duplicates_by_content_hash(
    conn: &Connection,
) -> DbResult<Vec<Vec<DuplicateCandidate>>> {
    // Find content hashes that appear more than once
    let mut stmt = conn.prepare(
        "SELECT content_hash FROM library
         WHERE content_hash IS NOT NULL
         GROUP BY content_hash
         HAVING COUNT(*) > 1",
    )?;

    let duplicate_hashes: Vec<String> = stmt
        .query_map([], |row| row.get(0))?
        .filter_map(|r| r.ok())
        .collect();

    let mut result = Vec::new();

    for hash in duplicate_hashes {
        let mut stmt = conn.prepare(
            "SELECT id, filepath, missing, play_count, added_date
             FROM library WHERE content_hash = ?
             ORDER BY missing ASC, added_date ASC",
        )?;

        let candidates: Vec<DuplicateCandidate> = stmt
            .query_map([&hash], |row| {
                Ok(DuplicateCandidate {
                    id: row.get(0)?,
                    filepath: row.get(1)?,
                    missing: row.get::<_, Option<i64>>(2)?.unwrap_or(0) != 0,
                    play_count: row.get::<_, Option<i64>>(3)?.unwrap_or(0),
                    added_date: row.get(4)?,
                })
            })?
            .filter_map(|r| r.ok())
            .collect();

        if candidates.len() > 1 {
            result.push(candidates);
        }
    }

    Ok(result)
}

/// Merge duplicate tracks: transfer metadata from source to target, then delete source
/// Preserves: play_count (summed), favorites, playlist memberships
pub(crate) fn merge_duplicate_tracks(
    conn: &Connection,
    keep_id: i64,
    delete_id: i64,
) -> DbResult<bool> {
    // Sum play counts
    conn.execute(
        "UPDATE library SET play_count = play_count + (
            SELECT COALESCE(play_count, 0) FROM library WHERE id = ?
        ) WHERE id = ?",
        params![delete_id, keep_id],
    )?;

    // Transfer favorites (ignore if already exists)
    conn.execute(
        "INSERT OR IGNORE INTO favorites (track_id, timestamp)
         SELECT ?, timestamp FROM favorites WHERE track_id = ?",
        params![keep_id, delete_id],
    )?;

    // Transfer playlist items (update track_id, ignore if duplicate position)
    conn.execute(
        "UPDATE OR IGNORE playlist_items SET track_id = ? WHERE track_id = ?",
        params![keep_id, delete_id],
    )?;

    // Delete remaining playlist items for the duplicate
    conn.execute("DELETE FROM playlist_items WHERE track_id = ?", [delete_id])?;

    // Delete favorites for the duplicate
    conn.execute("DELETE FROM favorites WHERE track_id = ?", [delete_id])?;

    // Delete the duplicate track
    let deleted = conn.execute("DELETE FROM library WHERE id = ?", [delete_id])?;

    Ok(deleted > 0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::register_custom_functions;
    use crate::db::schema::{create_tables, run_migrations};

    fn setup_test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        register_custom_functions(&conn).unwrap();
        create_tables(&conn).unwrap();
        run_migrations(&conn).unwrap();
        conn
    }

    #[test]
    fn test_add_and_get_track() {
        let conn = setup_test_db();

        let metadata = TrackMetadata {
            title: Some("Test Song".to_string()),
            artist: Some("Test Artist".to_string()),
            album: Some("Test Album".to_string()),
            duration: Some(180.5),
            ..Default::default()
        };

        let id = add_track(&conn, "/music/test.mp3", &metadata).unwrap();
        assert!(id > 0);

        let track = get_track_by_id(&conn, id).unwrap().unwrap();
        assert_eq!(track.title, Some("Test Song".to_string()));
        assert_eq!(track.artist, Some("Test Artist".to_string()));
    }

    #[test]
    fn test_get_track_by_filepath() {
        let conn = setup_test_db();

        let metadata = TrackMetadata {
            title: Some("Test Song".to_string()),
            ..Default::default()
        };

        add_track(&conn, "/music/test.mp3", &metadata).unwrap();

        let track = get_track_by_filepath(&conn, "/music/test.mp3")
            .unwrap()
            .unwrap();
        assert_eq!(track.title, Some("Test Song".to_string()));

        let not_found = get_track_by_filepath(&conn, "/music/nonexistent.mp3").unwrap();
        assert!(not_found.is_none());
    }

    #[test]
    fn test_bulk_operations() {
        let conn = setup_test_db();

        let tracks: Vec<(String, TrackMetadata)> = (1..=5)
            .map(|i| {
                (
                    format!("/music/track{}.mp3", i),
                    TrackMetadata {
                        title: Some(format!("Track {}", i)),
                        artist: Some("Test Artist".to_string()),
                        ..Default::default()
                    },
                )
            })
            .collect();

        let added = add_tracks_bulk(&conn, &tracks).unwrap();
        assert_eq!(added, 5);

        let stats = get_library_stats(&conn).unwrap();
        assert_eq!(stats.total_tracks, 5);
    }

    #[test]
    fn test_update_play_count() {
        let conn = setup_test_db();

        let metadata = TrackMetadata {
            title: Some("Test".to_string()),
            ..Default::default()
        };
        let id = add_track(&conn, "/music/test.mp3", &metadata).unwrap();

        let track = update_play_count(&conn, id).unwrap().unwrap();
        assert_eq!(track.play_count, 1);
        assert!(track.last_played.is_some());

        let track = update_play_count(&conn, id).unwrap().unwrap();
        assert_eq!(track.play_count, 2);
    }

    #[test]
    fn test_library_query() {
        let conn = setup_test_db();

        for i in 1..=20 {
            let metadata = TrackMetadata {
                title: Some(format!("Track {}", i)),
                artist: Some(if i <= 10 {
                    "Artist A".to_string()
                } else {
                    "Artist B".to_string()
                }),
                ..Default::default()
            };
            add_track(&conn, &format!("/music/track{}.mp3", i), &metadata).unwrap();
        }

        // Test pagination
        let query = LibraryQuery {
            limit: 5,
            offset: 0,
            ..Default::default()
        };
        let result = get_all_tracks(&conn, &query).unwrap();
        assert_eq!(result.items.len(), 5);
        assert_eq!(result.total, 20);

        // Test artist filter
        let query = LibraryQuery {
            artist: Some("Artist A".to_string()),
            limit: 100,
            ..Default::default()
        };
        let result = get_all_tracks(&conn, &query).unwrap();
        assert_eq!(result.total, 10);
    }

    #[test]
    fn test_find_track_by_artist_title_exact_case_insensitive() {
        let conn = setup_test_db();

        let metadata = TrackMetadata {
            title: Some("Yesterday".to_string()),
            artist: Some("The Beatles".to_string()),
            ..Default::default()
        };
        add_track(&conn, "/music/yesterday.mp3", &metadata).unwrap();

        // Tier 1: case-insensitive exact match
        let result = find_track_by_artist_title(&conn, "the beatles", "yesterday").unwrap();
        assert!(result.is_some());
        assert_eq!(result.unwrap().title, Some("Yesterday".to_string()));

        // Non-match: wrong artist
        let result = find_track_by_artist_title(&conn, "Rolling Stones", "Yesterday").unwrap();
        assert!(result.is_none());

        // Non-match: wrong title
        let result = find_track_by_artist_title(&conn, "The Beatles", "Let It Be").unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn test_find_tracks_no_substring_fallback() {
        let conn = setup_test_db();

        let metadata = TrackMetadata {
            title: Some("Bastards Of Young".to_string()),
            artist: Some("The Replacements".to_string()),
            ..Default::default()
        };
        add_track(&conn, "/music/bastards.mp3", &metadata).unwrap();

        // Substring "Replacements" does NOT match "The Replacements" (exact only)
        let result =
            find_track_by_artist_title(&conn, "Replacements", "Bastards Of Young").unwrap();
        assert!(result.is_none());

        // Exact match works
        let result =
            find_track_by_artist_title(&conn, "The Replacements", "Bastards Of Young").unwrap();
        assert!(result.is_some());

        // Short/common title with wrong artist must NOT match
        let metadata2 = TrackMetadata {
            title: Some("Plans".to_string()),
            artist: Some("Death Cab for Cutie".to_string()),
            ..Default::default()
        };
        add_track(&conn, "/music/plans.mp3", &metadata2).unwrap();

        let result = find_track_by_artist_title(&conn, "The Submarines", "Plans").unwrap();
        assert!(result.is_none());

        // Substring "Death Cab" does NOT match "Death Cab for Cutie" (exact only)
        let result = find_track_by_artist_title(&conn, "Death Cab", "Plans").unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn test_find_tracks_returns_all_album_variants() {
        let conn = setup_test_db();

        // Same artist+title on two different albums
        let metadata1 = TrackMetadata {
            title: Some("Everlong".to_string()),
            artist: Some("Foo Fighters".to_string()),
            album: Some("The Colour and the Shape".to_string()),
            ..Default::default()
        };
        add_track(&conn, "/music/everlong_studio.mp3", &metadata1).unwrap();

        let metadata2 = TrackMetadata {
            title: Some("Everlong".to_string()),
            artist: Some("Foo Fighters".to_string()),
            album: Some("Greatest Hits".to_string()),
            ..Default::default()
        };
        add_track(&conn, "/music/everlong_hits.mp3", &metadata2).unwrap();

        let results = find_tracks_by_artist_title(&conn, "Foo Fighters", "Everlong").unwrap();
        assert_eq!(results.len(), 2);

        let albums: Vec<_> = results
            .iter()
            .map(|t| t.album.as_deref().unwrap())
            .collect();
        assert!(albums.contains(&"The Colour and the Shape"));
        assert!(albums.contains(&"Greatest Hits"));
    }

    #[test]
    fn test_find_track_by_artist_title_checks_album_artist() {
        let conn = setup_test_db();

        // Track has album_artist but different artist (e.g. compilation)
        let metadata = TrackMetadata {
            title: Some("Black Dog".to_string()),
            artist: Some("Led Zeppelin".to_string()),
            album_artist: Some("Led Zeppelin".to_string()),
            ..Default::default()
        };
        add_track(&conn, "/music/black_dog.mp3", &metadata).unwrap();

        // Match via album_artist when artist field differs
        let result = find_track_by_artist_title(&conn, "Led Zeppelin", "Black Dog").unwrap();
        assert!(result.is_some());
    }

    // ===== Move Detection Tests (TDD) =====

    #[test]
    fn test_find_missing_track_by_inode() {
        let conn = setup_test_db();

        // Add a track with an inode
        let metadata = TrackMetadata {
            title: Some("Moved Song".to_string()),
            artist: Some("Test Artist".to_string()),
            file_inode: Some(12345),
            ..Default::default()
        };
        let original_id = add_track(&conn, "/music/old/song.mp3", &metadata).unwrap();

        // Mark track as missing (simulating file disappearance)
        mark_track_missing_by_filepath(&conn, "/music/old/song.mp3").unwrap();

        // Should find the missing track by inode
        let found = find_missing_track_by_inode(&conn, 12345).unwrap();
        assert!(found.is_some(), "Should find missing track by inode");
        let found_track = found.unwrap();
        assert_eq!(found_track.id, original_id);
        assert_eq!(found_track.title, Some("Moved Song".to_string()));
        assert!(found_track.missing, "Track should be marked as missing");
    }

    #[test]
    fn test_find_missing_track_by_inode_not_missing() {
        let conn = setup_test_db();

        // Add a track with an inode (NOT missing)
        let metadata = TrackMetadata {
            title: Some("Present Song".to_string()),
            file_inode: Some(99999),
            ..Default::default()
        };
        add_track(&conn, "/music/present.mp3", &metadata).unwrap();

        // Should NOT find the track because it's not missing
        let found = find_missing_track_by_inode(&conn, 99999).unwrap();
        assert!(found.is_none(), "Should not find non-missing track");
    }

    #[test]
    fn test_find_missing_track_by_content_hash() {
        let conn = setup_test_db();

        // Add a track with a content hash
        let metadata = TrackMetadata {
            title: Some("Cross-Volume Song".to_string()),
            artist: Some("Hash Artist".to_string()),
            content_hash: Some("sha256:abc123def456".to_string()),
            file_inode: Some(11111), // Different inode won't match after cross-volume move
            ..Default::default()
        };
        let original_id = add_track(&conn, "/volume1/music/song.mp3", &metadata).unwrap();

        // Mark as missing
        mark_track_missing_by_filepath(&conn, "/volume1/music/song.mp3").unwrap();

        // Should find by content hash (fallback when inode doesn't match)
        let found = find_missing_track_by_content_hash(&conn, "sha256:abc123def456").unwrap();
        assert!(found.is_some(), "Should find missing track by content hash");
        let found_track = found.unwrap();
        assert_eq!(found_track.id, original_id);
        assert_eq!(found_track.title, Some("Cross-Volume Song".to_string()));
    }

    #[test]
    fn test_reconcile_moved_track_updates_filepath_preserves_metadata() {
        let conn = setup_test_db();

        // Add a track with play count and other metadata
        let metadata = TrackMetadata {
            title: Some("Favorite Song".to_string()),
            artist: Some("Beloved Artist".to_string()),
            file_inode: Some(77777),
            ..Default::default()
        };
        let original_id = add_track(&conn, "/music/old/favorite.mp3", &metadata).unwrap();

        // Simulate user played the track multiple times
        update_play_count(&conn, original_id).unwrap();
        update_play_count(&conn, original_id).unwrap();
        update_play_count(&conn, original_id).unwrap();

        // Mark as missing (file moved)
        mark_track_missing_by_filepath(&conn, "/music/old/favorite.mp3").unwrap();

        // Reconcile: update filepath to new location, clear missing flag, update inode
        let new_inode = 88888u64;
        let reconciled = reconcile_moved_track(
            &conn,
            original_id,
            "/music/new/favorite.mp3",
            Some(new_inode),
        )
        .unwrap();

        assert!(reconciled.is_some(), "Should return reconciled track");
        let track = reconciled.unwrap();

        // Verify filepath updated
        assert_eq!(track.filepath, "/music/new/favorite.mp3");

        // Verify metadata preserved
        assert_eq!(track.id, original_id, "ID should be preserved");
        assert_eq!(track.title, Some("Favorite Song".to_string()));
        assert_eq!(track.artist, Some("Beloved Artist".to_string()));
        assert_eq!(track.play_count, 3, "Play count should be preserved");

        // Verify no longer missing
        assert!(!track.missing, "Track should no longer be missing");

        // Verify inode updated
        assert_eq!(track.file_inode, Some(new_inode as i64));

        // Verify old path no longer exists
        let old_path = get_track_by_filepath(&conn, "/music/old/favorite.mp3").unwrap();
        assert!(old_path.is_none(), "Old path should not exist");

        // Verify new path works
        let new_path = get_track_by_filepath(&conn, "/music/new/favorite.mp3").unwrap();
        assert!(new_path.is_some(), "New path should exist");
    }

    #[test]
    fn test_move_detection_prioritizes_inode_over_hash() {
        let conn = setup_test_db();

        // Two tracks with same content hash but different inodes
        let metadata1 = TrackMetadata {
            title: Some("Original".to_string()),
            file_inode: Some(11111),
            content_hash: Some("sha256:samehash".to_string()),
            ..Default::default()
        };
        let metadata2 = TrackMetadata {
            title: Some("Duplicate".to_string()),
            file_inode: Some(22222),
            content_hash: Some("sha256:samehash".to_string()),
            ..Default::default()
        };

        let id1 = add_track(&conn, "/music/original.mp3", &metadata1).unwrap();
        let _id2 = add_track(&conn, "/music/duplicate.mp3", &metadata2).unwrap();

        // Mark first as missing
        mark_track_missing_by_filepath(&conn, "/music/original.mp3").unwrap();

        // Inode match should return the correct track
        let found_by_inode = find_missing_track_by_inode(&conn, 11111).unwrap();
        assert!(found_by_inode.is_some());
        assert_eq!(found_by_inode.unwrap().id, id1);
    }

    #[test]
    fn test_full_move_detection_cycle_no_duplicates() {
        let conn = setup_test_db();

        let original_metadata = TrackMetadata {
            title: Some("My Favorite Song".to_string()),
            artist: Some("Artist Name".to_string()),
            album: Some("Album Name".to_string()),
            file_inode: Some(12345),
            content_hash: Some("sha256:abc123def456".to_string()),
            ..Default::default()
        };
        let original_id = add_track(&conn, "/music/old/song.mp3", &original_metadata).unwrap();

        let original_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM library", [], |row| row.get(0))
            .unwrap();
        assert_eq!(original_count, 1);

        mark_track_missing_by_filepath(&conn, "/music/old/song.mp3").unwrap();

        let missing_track = get_track_by_id(&conn, original_id).unwrap().unwrap();
        assert!(missing_track.missing);

        let reconciled =
            reconcile_moved_track(&conn, original_id, "/music/new/song.mp3", Some(12345)).unwrap();
        assert!(reconciled.is_some());

        let final_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM library", [], |row| row.get(0))
            .unwrap();
        assert_eq!(final_count, 1);

        let updated_track = get_track_by_id(&conn, original_id).unwrap().unwrap();
        assert_eq!(updated_track.filepath, "/music/new/song.mp3");
        assert!(!updated_track.missing);
        assert_eq!(updated_track.title, Some("My Favorite Song".to_string()));
        assert_eq!(updated_track.artist, Some("Artist Name".to_string()));
    }

    #[test]
    fn test_content_hash_fallback_when_inode_differs() {
        let conn = setup_test_db();

        let original_metadata = TrackMetadata {
            title: Some("Cross Volume Song".to_string()),
            file_inode: Some(11111),
            content_hash: Some("sha256:uniquehash123".to_string()),
            ..Default::default()
        };
        let original_id = add_track(&conn, "/volume1/song.mp3", &original_metadata).unwrap();

        mark_track_missing_by_filepath(&conn, "/volume1/song.mp3").unwrap();

        let by_inode = find_missing_track_by_inode(&conn, 99999).unwrap();
        assert!(by_inode.is_none());

        let by_hash = find_missing_track_by_content_hash(&conn, "sha256:uniquehash123").unwrap();
        assert!(by_hash.is_some());
        assert_eq!(by_hash.as_ref().unwrap().id, original_id);

        let reconciled =
            reconcile_moved_track(&conn, original_id, "/volume2/song.mp3", Some(99999)).unwrap();
        assert!(reconciled.is_some());

        let final_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM library", [], |row| row.get(0))
            .unwrap();
        assert_eq!(final_count, 1);

        let updated = get_track_by_id(&conn, original_id).unwrap().unwrap();
        assert_eq!(updated.filepath, "/volume2/song.mp3");
        assert_eq!(updated.file_inode, Some(99999));
        assert!(!updated.missing);
    }

    #[test]
    fn test_mark_track_present_by_filepath() {
        let conn = setup_test_db();

        // Add a track
        let metadata = TrackMetadata {
            title: Some("Test Song".to_string()),
            ..Default::default()
        };
        let track_id = add_track(&conn, "/music/test.mp3", &metadata).unwrap();

        // Mark it as missing
        mark_track_missing_by_filepath(&conn, "/music/test.mp3").unwrap();

        let track = get_track_by_id(&conn, track_id).unwrap().unwrap();
        assert!(track.missing, "Track should be marked as missing");

        // Now mark it as present by filepath
        let result = mark_track_present_by_filepath(&conn, "/music/test.mp3").unwrap();
        assert!(result, "Should return true when track was updated");

        let track = get_track_by_id(&conn, track_id).unwrap().unwrap();
        assert!(!track.missing, "Track should no longer be missing");

        // Calling again should return false (no rows updated since already present)
        let result = mark_track_present_by_filepath(&conn, "/music/test.mp3").unwrap();
        assert!(
            !result,
            "Should return false when track was already present"
        );
    }

    #[test]
    fn test_mark_tracks_present_by_filepaths_batch() {
        let conn = setup_test_db();

        // Add multiple tracks
        let paths = vec!["/music/song1.mp3", "/music/song2.mp3", "/music/song3.mp3"];

        for path in &paths {
            let metadata = TrackMetadata {
                title: Some(format!("Song {}", path)),
                ..Default::default()
            };
            add_track(&conn, path, &metadata).unwrap();
        }

        // Mark first two as missing
        mark_track_missing_by_filepath(&conn, "/music/song1.mp3").unwrap();
        mark_track_missing_by_filepath(&conn, "/music/song2.mp3").unwrap();

        // Batch mark all three as present (only 2 should be updated)
        let filepaths: Vec<String> = paths.iter().map(|s| s.to_string()).collect();
        let count = mark_tracks_present_by_filepaths(&conn, &filepaths).unwrap();
        assert_eq!(count, 2, "Should have updated 2 missing tracks");

        // Verify all tracks are now present
        for path in &paths {
            let track = get_track_by_filepath(&conn, path).unwrap().unwrap();
            assert!(!track.missing, "Track {} should not be missing", path);
        }

        // Calling again should return 0 (no missing tracks to update)
        let count = mark_tracks_present_by_filepaths(&conn, &filepaths).unwrap();
        assert_eq!(count, 0, "Should return 0 when no tracks need updating");
    }

    #[test]
    fn test_mark_tracks_present_empty_list() {
        let conn = setup_test_db();

        // Should handle empty list gracefully
        let count = mark_tracks_present_by_filepaths(&conn, &[]).unwrap();
        assert_eq!(count, 0, "Should return 0 for empty filepath list");
    }

    #[test]
    fn test_file_move_out_and_back_scenario() {
        // This test simulates the exact bug scenario:
        // 1. File exists at /music/song.mp3
        // 2. File is moved OUT (watcher marks it missing)
        // 3. File is moved BACK to same location
        // 4. Scanner sees file as "unchanged" (same path, same fingerprint)
        // 5. The missing flag should be cleared

        let conn = setup_test_db();

        // Initial state: track exists and is present
        let metadata = TrackMetadata {
            title: Some("Beginbot Takes 10 Years".to_string()),
            artist: Some("Beginbot".to_string()),
            file_inode: Some(12345),
            content_hash: Some("sha256:abc123".to_string()),
            ..Default::default()
        };
        let track_id = add_track(&conn, "/music/Beginbot/song.m4a", &metadata).unwrap();

        let track = get_track_by_id(&conn, track_id).unwrap().unwrap();
        assert!(!track.missing, "Initial state: track should not be missing");

        // Step 2: File moved out - watcher marks it missing
        mark_track_missing_by_filepath(&conn, "/music/Beginbot/song.m4a").unwrap();

        let track = get_track_by_id(&conn, track_id).unwrap().unwrap();
        assert!(track.missing, "After move out: track should be missing");

        // Step 3 & 4: File moved back to same location
        // Scanner sees it as "unchanged" and calls mark_tracks_present_by_filepaths
        let unchanged_files = vec!["/music/Beginbot/song.m4a".to_string()];
        let recovered = mark_tracks_present_by_filepaths(&conn, &unchanged_files).unwrap();

        assert_eq!(recovered, 1, "Should recover 1 track");

        // Step 5: Verify missing flag is cleared
        let track = get_track_by_id(&conn, track_id).unwrap().unwrap();
        assert!(
            !track.missing,
            "After move back: track should NOT be missing"
        );
        assert_eq!(track.filepath, "/music/Beginbot/song.m4a");
        assert_eq!(track.title, Some("Beginbot Takes 10 Years".to_string()));
    }

    #[test]
    fn test_locate_to_existing_path_removes_duplicate() {
        // This test simulates the scenario where:
        // 1. Track A exists at /music/song.mp3 with play history
        // 2. File is moved, Track A becomes missing
        // 3. Watcher detects the file at new location, adds Track B (duplicate)
        // 4. User uses "Locate" to point Track A to the new path
        // 5. Track B (duplicate) should be removed, Track A should be updated
        //
        // The library_locate_track command handles this, but we test the
        // underlying operations here.

        let conn = setup_test_db();

        // Track A: Original with play history (10 plays)
        let metadata_a = TrackMetadata {
            title: Some("My Song".to_string()),
            artist: Some("Artist".to_string()),
            file_inode: Some(11111),
            content_hash: Some("sha256:original".to_string()),
            ..Default::default()
        };
        let track_a_id = add_track(&conn, "/music/old/song.mp3", &metadata_a).unwrap();

        // Simulate play history
        for _ in 0..10 {
            update_play_count(&conn, track_a_id).unwrap();
        }

        let track_a = get_track_by_id(&conn, track_a_id).unwrap().unwrap();
        assert_eq!(track_a.play_count, 10);

        // File moved - Track A becomes missing
        mark_track_missing_by_filepath(&conn, "/music/old/song.mp3").unwrap();

        // Track B: Duplicate added by watcher at new location (0 plays)
        let metadata_b = TrackMetadata {
            title: Some("My Song".to_string()),
            artist: Some("Artist".to_string()),
            file_inode: Some(22222), // Different inode (moved to new volume)
            content_hash: Some("sha256:original".to_string()),
            ..Default::default()
        };
        let track_b_id = add_track(&conn, "/music/new/song.mp3", &metadata_b).unwrap();

        // Now we have 2 tracks
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM library", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 2);

        // User uses "Locate" to point Track A to the new path
        // First, check if there's already a track at the new path
        let existing = get_track_by_filepath(&conn, "/music/new/song.mp3").unwrap();
        assert!(existing.is_some());
        assert_eq!(existing.as_ref().unwrap().id, track_b_id);

        // Delete the duplicate (Track B)
        let deleted = delete_track(&conn, track_b_id).unwrap();
        assert!(deleted);

        // Update Track A's filepath
        update_track_filepath(&conn, track_a_id, "/music/new/song.mp3").unwrap();

        // Verify: Only 1 track remains
        let final_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM library", [], |row| row.get(0))
            .unwrap();
        assert_eq!(final_count, 1);

        // Verify: Track A has the new path and preserved play count
        let track_a_updated = get_track_by_id(&conn, track_a_id).unwrap().unwrap();
        assert_eq!(track_a_updated.filepath, "/music/new/song.mp3");
        assert!(!track_a_updated.missing);
        assert_eq!(
            track_a_updated.play_count, 10,
            "Play history should be preserved"
        );
        assert_eq!(track_a_updated.title, Some("My Song".to_string()));
    }

    // ===== get_existing_filepaths Tests =====

    #[test]
    fn test_get_existing_filepaths_empty_input() {
        let conn = setup_test_db();

        // Empty input should return empty set
        let result = get_existing_filepaths(&conn, &[]).unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn test_get_existing_filepaths_no_matches() {
        let conn = setup_test_db();

        // Add a track
        let metadata = TrackMetadata {
            title: Some("Test".to_string()),
            ..Default::default()
        };
        add_track(&conn, "/music/existing.mp3", &metadata).unwrap();

        // Query for non-existing paths
        let paths = vec![
            "/music/nonexistent1.mp3".to_string(),
            "/music/nonexistent2.mp3".to_string(),
        ];
        let result = get_existing_filepaths(&conn, &paths).unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn test_get_existing_filepaths_some_matches() {
        let conn = setup_test_db();

        // Add tracks
        for i in 1..=3 {
            let metadata = TrackMetadata {
                title: Some(format!("Track {}", i)),
                ..Default::default()
            };
            add_track(&conn, &format!("/music/track{}.mp3", i), &metadata).unwrap();
        }

        // Query for mix of existing and non-existing
        let paths = vec![
            "/music/track1.mp3".to_string(),
            "/music/nonexistent.mp3".to_string(),
            "/music/track3.mp3".to_string(),
        ];
        let result = get_existing_filepaths(&conn, &paths).unwrap();
        assert_eq!(result.len(), 2);
        assert!(result.contains("/music/track1.mp3"));
        assert!(result.contains("/music/track3.mp3"));
    }

    #[test]
    fn test_get_existing_filepaths_all_matches() {
        let conn = setup_test_db();

        // Add tracks
        let paths: Vec<String> = (1..=5).map(|i| format!("/music/track{}.mp3", i)).collect();
        for path in &paths {
            let metadata = TrackMetadata {
                title: Some("Test".to_string()),
                ..Default::default()
            };
            add_track(&conn, path, &metadata).unwrap();
        }

        // Query for all existing paths
        let result = get_existing_filepaths(&conn, &paths).unwrap();
        assert_eq!(result.len(), 5);
    }

    // ===== get_all_fingerprints Tests =====

    #[test]
    fn test_get_all_fingerprints_empty() {
        let conn = setup_test_db();

        let result = get_all_fingerprints(&conn).unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn test_get_all_fingerprints_with_data() {
        let conn = setup_test_db();

        // Add tracks with fingerprint data
        let metadata1 = TrackMetadata {
            title: Some("Track 1".to_string()),
            file_mtime_ns: Some(1234567890),
            file_size: Some(1000),
            ..Default::default()
        };
        let metadata2 = TrackMetadata {
            title: Some("Track 2".to_string()),
            file_mtime_ns: Some(9876543210),
            file_size: Some(2000),
            ..Default::default()
        };

        add_track(&conn, "/music/track1.mp3", &metadata1).unwrap();
        add_track(&conn, "/music/track2.mp3", &metadata2).unwrap();

        let result = get_all_fingerprints(&conn).unwrap();
        assert_eq!(result.len(), 2);

        let fp1 = &result["/music/track1.mp3"];
        assert_eq!(fp1.filepath, "/music/track1.mp3");
        assert_eq!(fp1.file_mtime_ns, Some(1234567890));
        assert_eq!(fp1.file_size, 1000);

        let fp2 = &result["/music/track2.mp3"];
        assert_eq!(fp2.filepath, "/music/track2.mp3");
        assert_eq!(fp2.file_mtime_ns, Some(9876543210));
        assert_eq!(fp2.file_size, 2000);
    }

    #[test]
    fn test_get_all_fingerprints_null_values() {
        let conn = setup_test_db();

        // Add track with null fingerprint values
        let metadata = TrackMetadata {
            title: Some("No Fingerprint".to_string()),
            file_mtime_ns: None,
            file_size: None,
            ..Default::default()
        };
        add_track(&conn, "/music/nofingerprint.mp3", &metadata).unwrap();

        let result = get_all_fingerprints(&conn).unwrap();
        assert_eq!(result.len(), 1);

        let fp = &result["/music/nofingerprint.mp3"];
        assert_eq!(fp.file_mtime_ns, None);
        assert_eq!(fp.file_size, 0); // Default when NULL
    }

    // ===== update_tracks_bulk Tests =====

    #[test]
    fn test_update_tracks_bulk_empty() {
        let conn = setup_test_db();

        let result = update_tracks_bulk(&conn, &[]).unwrap();
        assert_eq!(result, 0);
    }

    #[test]
    fn test_update_tracks_bulk_updates_metadata() {
        let conn = setup_test_db();

        // Add initial tracks
        let tracks: Vec<(String, TrackMetadata)> = (1..=3)
            .map(|i| {
                (
                    format!("/music/track{}.mp3", i),
                    TrackMetadata {
                        title: Some(format!("Original {}", i)),
                        artist: Some("Original Artist".to_string()),
                        duration: Some(100.0),
                        ..Default::default()
                    },
                )
            })
            .collect();
        add_tracks_bulk(&conn, &tracks).unwrap();

        // Update tracks
        let updates: Vec<(String, TrackMetadata)> = (1..=3)
            .map(|i| {
                (
                    format!("/music/track{}.mp3", i),
                    TrackMetadata {
                        title: Some(format!("Updated {}", i)),
                        artist: Some("Updated Artist".to_string()),
                        duration: Some(200.0),
                        ..Default::default()
                    },
                )
            })
            .collect();

        let result = update_tracks_bulk(&conn, &updates).unwrap();
        assert_eq!(result, 3);

        // Verify updates
        let track = get_track_by_filepath(&conn, "/music/track1.mp3")
            .unwrap()
            .unwrap();
        assert_eq!(track.title, Some("Updated 1".to_string()));
        assert_eq!(track.artist, Some("Updated Artist".to_string()));
    }

    #[test]
    fn test_update_tracks_bulk_nonexistent_path() {
        let conn = setup_test_db();

        // Try to update non-existent paths
        let updates = vec![(
            "/music/nonexistent.mp3".to_string(),
            TrackMetadata {
                title: Some("Updated".to_string()),
                ..Default::default()
            },
        )];

        let result = update_tracks_bulk(&conn, &updates).unwrap();
        assert_eq!(result, 0); // No rows updated
    }

    // ===== delete_tracks_bulk Tests =====

    #[test]
    fn test_delete_tracks_bulk_empty() {
        let conn = setup_test_db();

        let result = delete_tracks_bulk(&conn, &[]).unwrap();
        assert_eq!(result, 0);
    }

    #[test]
    fn test_delete_tracks_bulk_deletes_tracks() {
        let conn = setup_test_db();

        // Add tracks
        for i in 1..=5 {
            let metadata = TrackMetadata {
                title: Some(format!("Track {}", i)),
                ..Default::default()
            };
            add_track(&conn, &format!("/music/track{}.mp3", i), &metadata).unwrap();
        }

        // Delete some tracks
        let to_delete = vec![
            "/music/track1.mp3".to_string(),
            "/music/track3.mp3".to_string(),
            "/music/track5.mp3".to_string(),
        ];

        let result = delete_tracks_bulk(&conn, &to_delete).unwrap();
        assert_eq!(result, 3);

        // Verify remaining tracks
        let stats = get_library_stats(&conn).unwrap();
        assert_eq!(stats.total_tracks, 2);

        assert!(
            get_track_by_filepath(&conn, "/music/track1.mp3")
                .unwrap()
                .is_none()
        );
        assert!(
            get_track_by_filepath(&conn, "/music/track2.mp3")
                .unwrap()
                .is_some()
        );
        assert!(
            get_track_by_filepath(&conn, "/music/track3.mp3")
                .unwrap()
                .is_none()
        );
    }

    #[test]
    fn test_delete_tracks_bulk_nonexistent() {
        let conn = setup_test_db();

        // Add one track
        let metadata = TrackMetadata {
            title: Some("Track".to_string()),
            ..Default::default()
        };
        add_track(&conn, "/music/track.mp3", &metadata).unwrap();

        // Try to delete non-existent paths
        let to_delete = vec!["/music/nonexistent.mp3".to_string()];

        let result = delete_tracks_bulk(&conn, &to_delete).unwrap();
        assert_eq!(result, 0);

        // Original track should still exist
        let stats = get_library_stats(&conn).unwrap();
        assert_eq!(stats.total_tracks, 1);
    }

    // ===== update_track_metadata Tests =====

    #[test]
    fn test_update_track_metadata_success() {
        let conn = setup_test_db();

        let original = TrackMetadata {
            title: Some("Original Title".to_string()),
            artist: Some("Original Artist".to_string()),
            album: Some("Original Album".to_string()),
            duration: Some(180.0),
            ..Default::default()
        };
        let id = add_track(&conn, "/music/test.mp3", &original).unwrap();

        let updated = TrackMetadata {
            title: Some("New Title".to_string()),
            artist: Some("New Artist".to_string()),
            album: Some("New Album".to_string()),
            duration: Some(240.0),
            ..Default::default()
        };

        let result = update_track_metadata(&conn, id, &updated).unwrap();
        assert!(result);

        let track = get_track_by_id(&conn, id).unwrap().unwrap();
        assert_eq!(track.title, Some("New Title".to_string()));
        assert_eq!(track.artist, Some("New Artist".to_string()));
        assert_eq!(track.album, Some("New Album".to_string()));
    }

    #[test]
    fn test_update_track_metadata_nonexistent() {
        let conn = setup_test_db();

        let metadata = TrackMetadata {
            title: Some("Title".to_string()),
            ..Default::default()
        };

        let result = update_track_metadata(&conn, 99999, &metadata).unwrap();
        assert!(!result);
    }

    // ===== get_missing_tracks Tests =====

    #[test]
    fn test_get_missing_tracks_empty() {
        let conn = setup_test_db();

        let result = get_missing_tracks(&conn).unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn test_get_missing_tracks_returns_missing_only() {
        let conn = setup_test_db();

        // Add tracks - some missing, some not
        for i in 1..=4 {
            let metadata = TrackMetadata {
                title: Some(format!("Track {}", i)),
                ..Default::default()
            };
            add_track(&conn, &format!("/music/track{}.mp3", i), &metadata).unwrap();
        }

        // Mark some as missing
        mark_track_missing_by_filepath(&conn, "/music/track1.mp3").unwrap();
        mark_track_missing_by_filepath(&conn, "/music/track3.mp3").unwrap();

        let result = get_missing_tracks(&conn).unwrap();
        assert_eq!(result.len(), 2);

        // Should be sorted by title
        assert_eq!(result[0].title, Some("Track 1".to_string()));
        assert_eq!(result[1].title, Some("Track 3".to_string()));

        // All should have missing=true
        for track in &result {
            assert!(track.missing);
        }
    }

    // ===== Fingerprint Backfill Tests =====

    #[test]
    fn test_get_tracks_needing_fingerprints_empty() {
        let conn = setup_test_db();

        let result = get_tracks_needing_fingerprints(&conn).unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn test_get_tracks_needing_fingerprints_returns_incomplete() {
        let conn = setup_test_db();

        // Track with complete fingerprints (shouldn't be returned)
        let complete = TrackMetadata {
            title: Some("Complete".to_string()),
            file_inode: Some(12345),
            content_hash: Some("sha256:abc".to_string()),
            ..Default::default()
        };
        add_track(&conn, "/music/complete.mp3", &complete).unwrap();

        // Track with no inode
        let no_inode = TrackMetadata {
            title: Some("No Inode".to_string()),
            file_inode: None,
            content_hash: Some("sha256:def".to_string()),
            ..Default::default()
        };
        add_track(&conn, "/music/no_inode.mp3", &no_inode).unwrap();

        // Track with no hash
        let no_hash = TrackMetadata {
            title: Some("No Hash".to_string()),
            file_inode: Some(67890),
            content_hash: None,
            ..Default::default()
        };
        add_track(&conn, "/music/no_hash.mp3", &no_hash).unwrap();

        // Missing track (shouldn't be returned)
        let missing = TrackMetadata {
            title: Some("Missing".to_string()),
            file_inode: None,
            content_hash: None,
            ..Default::default()
        };
        let missing_id = add_track(&conn, "/music/missing.mp3", &missing).unwrap();
        mark_track_missing(&conn, missing_id).unwrap();

        let result = get_tracks_needing_fingerprints(&conn).unwrap();
        assert_eq!(result.len(), 2);

        let paths: Vec<&str> = result.iter().map(|t| t.filepath.as_str()).collect();
        assert!(paths.contains(&"/music/no_inode.mp3"));
        assert!(paths.contains(&"/music/no_hash.mp3"));
    }

    #[test]
    fn test_update_track_fingerprints() {
        let conn = setup_test_db();

        let metadata = TrackMetadata {
            title: Some("Test".to_string()),
            file_inode: None,
            content_hash: None,
            ..Default::default()
        };
        let id = add_track(&conn, "/music/test.mp3", &metadata).unwrap();

        // Update fingerprints
        let result =
            update_track_fingerprints(&conn, id, Some(12345), Some("sha256:abc123")).unwrap();
        assert!(result);

        // Verify update
        let track = get_track_by_id(&conn, id).unwrap().unwrap();
        assert_eq!(track.file_inode, Some(12345));
        assert_eq!(track.content_hash, Some("sha256:abc123".to_string()));
    }

    #[test]
    fn test_update_track_fingerprints_nonexistent() {
        let conn = setup_test_db();

        let result = update_track_fingerprints(&conn, 99999, Some(12345), Some("hash")).unwrap();
        assert!(!result);
    }

    // ===== Duplicate Detection Tests =====

    #[test]
    fn test_find_duplicates_by_inode_empty() {
        let conn = setup_test_db();

        let result = find_duplicates_by_inode(&conn).unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn test_find_duplicates_by_inode_no_duplicates() {
        let conn = setup_test_db();

        // Add tracks with unique inodes
        for i in 1..=3 {
            let metadata = TrackMetadata {
                title: Some(format!("Track {}", i)),
                file_inode: Some(i as u64 * 1000),
                ..Default::default()
            };
            add_track(&conn, &format!("/music/track{}.mp3", i), &metadata).unwrap();
        }

        let result = find_duplicates_by_inode(&conn).unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn test_find_duplicates_by_inode_finds_duplicates() {
        let conn = setup_test_db();

        // Add tracks with duplicate inode
        let metadata1 = TrackMetadata {
            title: Some("Original".to_string()),
            file_inode: Some(12345),
            ..Default::default()
        };
        let metadata2 = TrackMetadata {
            title: Some("Duplicate".to_string()),
            file_inode: Some(12345), // Same inode
            ..Default::default()
        };
        let metadata3 = TrackMetadata {
            title: Some("Unique".to_string()),
            file_inode: Some(99999), // Different inode
            ..Default::default()
        };

        add_track(&conn, "/music/original.mp3", &metadata1).unwrap();
        add_track(&conn, "/music/duplicate.mp3", &metadata2).unwrap();
        add_track(&conn, "/music/unique.mp3", &metadata3).unwrap();

        let result = find_duplicates_by_inode(&conn).unwrap();
        assert_eq!(result.len(), 1); // One group of duplicates
        assert_eq!(result[0].len(), 2); // Two tracks in the group
    }

    #[test]
    fn test_find_duplicates_by_content_hash_empty() {
        let conn = setup_test_db();

        let result = find_duplicates_by_content_hash(&conn).unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn test_find_duplicates_by_content_hash_finds_duplicates() {
        let conn = setup_test_db();

        // Add tracks with duplicate content hash
        let metadata1 = TrackMetadata {
            title: Some("File 1".to_string()),
            content_hash: Some("sha256:samehash".to_string()),
            file_inode: Some(11111),
            ..Default::default()
        };
        let metadata2 = TrackMetadata {
            title: Some("File 2".to_string()),
            content_hash: Some("sha256:samehash".to_string()),
            file_inode: Some(22222),
            ..Default::default()
        };
        let metadata3 = TrackMetadata {
            title: Some("Different".to_string()),
            content_hash: Some("sha256:differenthash".to_string()),
            file_inode: Some(33333),
            ..Default::default()
        };

        add_track(&conn, "/music/file1.mp3", &metadata1).unwrap();
        add_track(&conn, "/music/file2.mp3", &metadata2).unwrap();
        add_track(&conn, "/music/different.mp3", &metadata3).unwrap();

        let result = find_duplicates_by_content_hash(&conn).unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].len(), 2);
    }

    // ===== Merge Duplicate Tracks Tests =====

    #[test]
    fn test_merge_duplicate_tracks_sums_play_count() {
        let conn = setup_test_db();

        // Add two tracks
        let metadata1 = TrackMetadata {
            title: Some("Keep".to_string()),
            ..Default::default()
        };
        let metadata2 = TrackMetadata {
            title: Some("Delete".to_string()),
            ..Default::default()
        };

        let keep_id = add_track(&conn, "/music/keep.mp3", &metadata1).unwrap();
        let delete_id = add_track(&conn, "/music/delete.mp3", &metadata2).unwrap();

        // Add play counts
        for _ in 0..5 {
            update_play_count(&conn, keep_id).unwrap();
        }
        for _ in 0..3 {
            update_play_count(&conn, delete_id).unwrap();
        }

        // Merge
        let result = merge_duplicate_tracks(&conn, keep_id, delete_id).unwrap();
        assert!(result);

        // Verify: keep_id should have combined play count
        let track = get_track_by_id(&conn, keep_id).unwrap().unwrap();
        assert_eq!(track.play_count, 8); // 5 + 3

        // Verify: delete_id should be gone
        let deleted = get_track_by_id(&conn, delete_id).unwrap();
        assert!(deleted.is_none());
    }

    #[test]
    fn test_merge_duplicate_tracks_nonexistent() {
        let conn = setup_test_db();

        let metadata = TrackMetadata {
            title: Some("Test".to_string()),
            ..Default::default()
        };
        let keep_id = add_track(&conn, "/music/test.mp3", &metadata).unwrap();

        // Try to merge with non-existent track
        let result = merge_duplicate_tracks(&conn, keep_id, 99999).unwrap();
        assert!(!result); // No rows deleted
    }

    // ===== LibraryQuery Tests =====

    #[test]
    fn test_library_query_new_defaults() {
        let query = LibraryQuery::new();
        assert_eq!(query.limit, 100);
        assert!(query.search.is_none());
        assert!(query.artist.is_none());
        assert!(query.album.is_none());
    }

    #[test]
    fn test_library_query_search_filter() {
        let conn = setup_test_db();

        // Add tracks with different titles
        let tracks = vec![
            ("Rock Song", "Rock Artist", "Rock Album"),
            ("Pop Song", "Pop Artist", "Pop Album"),
            ("Jazz Song", "Jazz Artist", "Jazz Album"),
        ];

        for (title, artist, album) in tracks {
            let metadata = TrackMetadata {
                title: Some(title.to_string()),
                artist: Some(artist.to_string()),
                album: Some(album.to_string()),
                ..Default::default()
            };
            add_track(&conn, &format!("/music/{}.mp3", title), &metadata).unwrap();
        }

        // Search for "Rock"
        let query = LibraryQuery {
            search: Some("Rock".to_string()),
            limit: 100,
            ..Default::default()
        };
        let result = get_all_tracks(&conn, &query).unwrap();
        assert_eq!(result.total, 1);
        assert_eq!(result.items[0].title, Some("Rock Song".to_string()));
    }

    #[test]
    fn test_library_query_album_filter() {
        let conn = setup_test_db();

        // Add tracks in different albums
        for i in 1..=4 {
            let metadata = TrackMetadata {
                title: Some(format!("Track {}", i)),
                album: Some(if i <= 2 {
                    "Album A".to_string()
                } else {
                    "Album B".to_string()
                }),
                ..Default::default()
            };
            add_track(&conn, &format!("/music/track{}.mp3", i), &metadata).unwrap();
        }

        let query = LibraryQuery {
            album: Some("Album A".to_string()),
            limit: 100,
            ..Default::default()
        };
        let result = get_all_tracks(&conn, &query).unwrap();
        assert_eq!(result.total, 2);
    }

    // ===== DuplicateCandidate and TrackForBackfill Struct Tests =====

    #[test]
    fn test_duplicate_candidate_debug() {
        let candidate = DuplicateCandidate {
            id: 1,
            filepath: "/music/test.mp3".to_string(),
            missing: false,
            play_count: 10,
            added_date: Some("2024-01-01".to_string()),
        };

        let debug_str = format!("{:?}", candidate);
        assert!(debug_str.contains("DuplicateCandidate"));
        assert!(debug_str.contains("test.mp3"));
    }

    #[test]
    fn test_track_for_backfill_debug() {
        let track = TrackForBackfill {
            id: 42,
            filepath: "/music/backfill.mp3".to_string(),
        };

        let debug_str = format!("{:?}", track);
        assert!(debug_str.contains("TrackForBackfill"));
        assert!(debug_str.contains("42"));
        assert!(debug_str.contains("backfill.mp3"));
    }

    #[test]
    fn test_bulk_delete_cleans_all_tables() {
        let conn = setup_test_db();

        // Insert tracks
        let metadata = TrackMetadata {
            title: Some("Song".to_string()),
            ..Default::default()
        };
        let id1 = add_track(&conn, "/music/a.mp3", &metadata).unwrap();
        let id2 = add_track(&conn, "/music/b.mp3", &metadata).unwrap();
        let id3 = add_track(&conn, "/music/c.mp3", &metadata).unwrap();

        // Add favorites for id1 and id2
        use crate::db::favorites;
        favorites::add_favorite(&conn, id1).unwrap();
        favorites::add_favorite(&conn, id2).unwrap();

        // Create playlist and add id1 and id3
        use crate::db::playlists;
        let playlist = playlists::create_playlist(&conn, "Test Playlist")
            .unwrap()
            .unwrap();
        playlists::add_tracks_to_playlist(&conn, playlist.id, &[id1, id3], None).unwrap();

        // Delete id1 and id2
        let deleted = delete_tracks_by_ids(&conn, &[id1, id2]).unwrap();
        assert_eq!(deleted, 2);

        // Verify library rows removed
        assert!(get_track_by_id(&conn, id1).unwrap().is_none());
        assert!(get_track_by_id(&conn, id2).unwrap().is_none());
        assert!(get_track_by_id(&conn, id3).unwrap().is_some());

        // Verify favorites cleaned up
        let fav_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM favorites", [], |r| r.get(0))
            .unwrap();
        assert_eq!(fav_count, 0, "favorites should be cleaned up");

        // Verify playlist_items cleaned up for deleted tracks
        let pi_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM playlist_items WHERE track_id IN (?1, ?2)",
                [id1, id2],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            pi_count, 0,
            "playlist_items for deleted tracks should be removed"
        );

        // id3's playlist entry should still exist
        let id3_pi: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM playlist_items WHERE track_id = ?1",
                [id3],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(id3_pi, 1, "id3 playlist item should still exist");
    }

    #[test]
    fn test_get_fingerprints_for_paths() {
        let conn = setup_test_db();

        let metadata = TrackMetadata {
            file_mtime_ns: Some(1000),
            file_size: Some(5000),
            ..Default::default()
        };

        // Tracks under different directories
        add_track(&conn, "/music/rock/a.mp3", &metadata).unwrap();
        add_track(&conn, "/music/rock/b.mp3", &metadata).unwrap();
        add_track(&conn, "/music/jazz/c.mp3", &metadata).unwrap();
        add_track(&conn, "/other/d.mp3", &metadata).unwrap();

        // Scope to /music/rock/
        let results = get_fingerprints_for_paths(&conn, &["/music/rock".to_string()]).unwrap();
        assert_eq!(results.len(), 2);

        // Scope to both directories
        let results = get_fingerprints_for_paths(
            &conn,
            &["/music/rock".to_string(), "/music/jazz".to_string()],
        )
        .unwrap();
        assert_eq!(results.len(), 3);

        // Scope to a specific file
        let results = get_fingerprints_for_paths(&conn, &["/other/d.mp3".to_string()]).unwrap();
        assert_eq!(results.len(), 1);

        // Empty paths returns empty
        let results = get_fingerprints_for_paths(&conn, &[]).unwrap();
        assert_eq!(results.len(), 0);
    }

    /// Helper to insert a track with specific fields for sort tests
    fn insert_sort_track(
        conn: &Connection,
        artist: &str,
        album_artist: Option<&str>,
        album: &str,
        disc: Option<&str>,
        track_num: Option<&str>,
        title: &str,
    ) {
        let metadata = TrackMetadata {
            title: Some(title.to_string()),
            artist: Some(artist.to_string()),
            album_artist: album_artist.map(|s| s.to_string()),
            album: Some(album.to_string()),
            disc_number: disc.map(|s| s.to_string()),
            track_number: track_num.map(|s| s.to_string()),
            ..Default::default()
        };
        let path = format!("/music/{}/{}/{}.mp3", artist, album, title);
        add_track(conn, &path, &metadata).unwrap();
    }

    #[test]
    fn test_sort_compilation_by_individual_artist() {
        let conn = setup_test_db();

        // Compilation: album_artist is null, different artists per track
        insert_sort_track(
            &conn,
            "The Decemberists",
            None,
            "Dark Was the Night",
            Some("1"),
            Some("12"),
            "Sleepless",
        );
        insert_sort_track(
            &conn,
            "Arcade Fire",
            None,
            "Dark Was the Night",
            Some("2"),
            Some("2"),
            "Lenin",
        );
        insert_sort_track(
            &conn,
            "Spoon",
            None,
            "Dark Was the Night",
            Some("2"),
            Some("1"),
            "Well-Alright",
        );

        // The Decemberists' own album
        insert_sort_track(
            &conn,
            "The Decemberists",
            None,
            "Her Majesty",
            None,
            Some("1"),
            "Shanty",
        );

        let query = LibraryQuery {
            sort_by: LibrarySortColumn::Artist,
            sort_order: SortOrder::Asc,
            limit: 100,
            ..Default::default()
        };

        let result = get_all_tracks(&conn, &query).unwrap();
        let artists: Vec<_> = result
            .items
            .iter()
            .map(|t| t.artist.as_deref().unwrap())
            .collect();

        // Arcade Fire < Spoon < The Decemberists (all Decemberists tracks adjacent)
        assert_eq!(artists[0], "Arcade Fire");
        assert_eq!(artists[1], "Spoon");
        // The Decemberists tracks should be grouped: compilation + own album
        assert_eq!(artists[2], "The Decemberists");
        assert_eq!(artists[3], "The Decemberists");
    }

    #[test]
    fn test_sort_same_name_albums_separately() {
        let conn = setup_test_db();

        // "Ceremony" by Anna Von Hausswolff
        insert_sort_track(
            &conn,
            "Anna Von Hausswolff",
            Some("Anna Von Hausswolff"),
            "Ceremony",
            Some("1"),
            Some("1"),
            "Epitaph",
        );
        insert_sort_track(
            &conn,
            "Anna Von Hausswolff",
            Some("Anna Von Hausswolff"),
            "Ceremony",
            Some("1"),
            Some("2"),
            "Deathbed",
        );

        // "Ceremony" by Phantogram
        insert_sort_track(
            &conn,
            "Phantogram",
            Some("Phantogram"),
            "Ceremony",
            Some("1"),
            Some("1"),
            "Dear God",
        );
        insert_sort_track(
            &conn,
            "Phantogram",
            Some("Phantogram"),
            "Ceremony",
            Some("1"),
            Some("2"),
            "In A Spiral",
        );

        let query = LibraryQuery {
            sort_by: LibrarySortColumn::Artist,
            sort_order: SortOrder::Asc,
            limit: 100,
            ..Default::default()
        };

        let result = get_all_tracks(&conn, &query).unwrap();
        let pairs: Vec<_> = result
            .items
            .iter()
            .map(|t| {
                (
                    t.album_artist.as_deref().unwrap(),
                    t.title.as_deref().unwrap(),
                )
            })
            .collect();

        // Anna Von Hausswolff tracks first, then Phantogram
        assert_eq!(pairs[0].0, "Anna Von Hausswolff");
        assert_eq!(pairs[1].0, "Anna Von Hausswolff");
        assert_eq!(pairs[2].0, "Phantogram");
        assert_eq!(pairs[3].0, "Phantogram");
    }

    #[test]
    fn test_sort_soundtrack_grouped() {
        let conn = setup_test_db();

        // Soundtrack: same album_artist for all tracks
        insert_sort_track(
            &conn,
            "Lorien Testard",
            Some("Lorien Testard"),
            "Clair Obscur OST",
            None,
            Some("1"),
            "Track 1",
        );
        insert_sort_track(
            &conn,
            "Lorien Testard",
            Some("Lorien Testard"),
            "Clair Obscur OST",
            None,
            Some("2"),
            "Track 2",
        );
        insert_sort_track(
            &conn,
            "Lorien Testard",
            Some("Lorien Testard"),
            "Clair Obscur OST",
            None,
            Some("3"),
            "Track 3",
        );

        let query = LibraryQuery {
            sort_by: LibrarySortColumn::Artist,
            sort_order: SortOrder::Asc,
            limit: 100,
            ..Default::default()
        };

        let result = get_all_tracks(&conn, &query).unwrap();
        let titles: Vec<_> = result
            .items
            .iter()
            .map(|t| t.title.as_deref().unwrap())
            .collect();

        // All grouped together by track number order
        assert_eq!(titles, vec!["Track 1", "Track 2", "Track 3"]);
    }

    #[test]
    fn test_sort_with_ignore_words() {
        let conn = setup_test_db();

        // "The Decemberists" should sort as "Decemberists" with ignore words
        insert_sort_track(
            &conn,
            "The Decemberists",
            None,
            "Her Majesty",
            None,
            Some("1"),
            "Shanty",
        );
        // "Arcade Fire" sorts as "Arcade Fire"
        insert_sort_track(
            &conn,
            "Arcade Fire",
            None,
            "Funeral",
            None,
            Some("1"),
            "Neighborhood",
        );
        // "Belle and Sebastian" sorts as "Belle..."
        insert_sort_track(
            &conn,
            "Belle and Sebastian",
            None,
            "Tigermilk",
            None,
            Some("1"),
            "The State",
        );

        let query = LibraryQuery {
            sort_by: LibrarySortColumn::Artist,
            sort_order: SortOrder::Asc,
            ignore_words: Some("the,a,an".to_string()),
            limit: 100,
            ..Default::default()
        };

        let result = get_all_tracks(&conn, &query).unwrap();
        let artists: Vec<_> = result
            .items
            .iter()
            .map(|t| t.artist.as_deref().unwrap())
            .collect();

        // With "The" stripped: Arcade Fire < Belle and Sebastian < (The) Decemberists
        assert_eq!(artists[0], "Arcade Fire");
        assert_eq!(artists[1], "Belle and Sebastian");
        assert_eq!(artists[2], "The Decemberists");
    }
}
