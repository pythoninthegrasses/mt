//! Last.fm loved tracks cache database operations.
//!
//! Operations for caching Last.fm loved tracks and matching them
//! against the local library for automatic favoriting.

use rusqlite::{params, Connection};

use crate::db::{DbResult, LastfmLovedStats, LastfmLovedTrack};

/// Insert or update a loved track in the cache
///
/// Uses INSERT OR REPLACE to handle duplicates via the UNIQUE(artist, track) constraint.
/// Returns the row id.
pub fn upsert_loved_track(
    conn: &Connection,
    artist: &str,
    track: &str,
    loved_at: Option<i64>,
) -> DbResult<i64> {
    conn.execute(
        "INSERT INTO lastfm_loved_tracks (artist, track, loved_at)
         VALUES (?, ?, ?)
         ON CONFLICT(artist, track) DO UPDATE SET
             loved_at = COALESCE(excluded.loved_at, loved_at)",
        params![artist, track, loved_at],
    )?;

    Ok(conn.last_insert_rowid())
}

/// Bulk insert loved tracks (more efficient than individual inserts)
///
/// Returns the number of tracks inserted/updated.
pub fn bulk_insert_loved_tracks(
    conn: &Connection,
    tracks: &[(String, String, Option<i64>)], // (artist, track, loved_at)
) -> DbResult<usize> {
    let mut count = 0;
    for (artist, track, loved_at) in tracks {
        conn.execute(
            "INSERT INTO lastfm_loved_tracks (artist, track, loved_at)
             VALUES (?, ?, ?)
             ON CONFLICT(artist, track) DO UPDATE SET
                 loved_at = COALESCE(excluded.loved_at, loved_at)",
            params![artist, track, loved_at],
        )?;
        count += 1;
    }
    Ok(count)
}

/// Get all unmatched loved tracks (tracks not yet in the library)
pub fn get_unmatched_loved_tracks(
    conn: &Connection,
    limit: Option<i64>,
) -> DbResult<Vec<LastfmLovedTrack>> {
    let sql = match limit {
        Some(_) => {
            "SELECT id, artist, track, loved_at, matched_track_id, last_checked_at, created_at
             FROM lastfm_loved_tracks
             WHERE matched_track_id IS NULL
             ORDER BY created_at ASC
             LIMIT ?"
        }
        None => {
            "SELECT id, artist, track, loved_at, matched_track_id, last_checked_at, created_at
             FROM lastfm_loved_tracks
             WHERE matched_track_id IS NULL
             ORDER BY created_at ASC"
        }
    };

    let mut stmt = conn.prepare(sql)?;

    let entries = if let Some(lim) = limit {
        stmt.query_map([lim], map_loved_track)?
    } else {
        stmt.query_map([], map_loved_track)?
    };

    Ok(entries.filter_map(|r| r.ok()).collect())
}

/// Get all cached loved tracks (both matched and unmatched)
pub fn get_all_loved_tracks(
    conn: &Connection,
    limit: Option<i64>,
    offset: Option<i64>,
) -> DbResult<Vec<LastfmLovedTrack>> {
    let limit_val = limit.unwrap_or(1000);
    let offset_val = offset.unwrap_or(0);

    let mut stmt = conn.prepare(
        "SELECT id, artist, track, loved_at, matched_track_id, last_checked_at, created_at
         FROM lastfm_loved_tracks
         ORDER BY loved_at DESC NULLS LAST, created_at DESC
         LIMIT ? OFFSET ?",
    )?;

    let entries: Vec<LastfmLovedTrack> = stmt
        .query_map([limit_val, offset_val], map_loved_track)?
        .filter_map(|r| r.ok())
        .collect();

    Ok(entries)
}

/// Update a loved track's matched_track_id when found in the library
pub fn set_matched_track(
    conn: &Connection,
    loved_track_id: i64,
    library_track_id: i64,
) -> DbResult<bool> {
    let now = chrono::Utc::now().timestamp();
    let updated = conn.execute(
        "UPDATE lastfm_loved_tracks
         SET matched_track_id = ?, last_checked_at = ?
         WHERE id = ?",
        params![library_track_id, now, loved_track_id],
    )?;
    Ok(updated > 0)
}

/// Update last_checked_at timestamp without setting a match
pub fn mark_checked(conn: &Connection, loved_track_id: i64) -> DbResult<bool> {
    let now = chrono::Utc::now().timestamp();
    let updated = conn.execute(
        "UPDATE lastfm_loved_tracks SET last_checked_at = ? WHERE id = ?",
        params![now, loved_track_id],
    )?;
    Ok(updated > 0)
}

/// Clear a match (useful when a library track is removed)
pub fn clear_match(conn: &Connection, library_track_id: i64) -> DbResult<i64> {
    let updated = conn.execute(
        "UPDATE lastfm_loved_tracks SET matched_track_id = NULL WHERE matched_track_id = ?",
        [library_track_id],
    )?;
    Ok(updated as i64)
}

/// Get loved track cache statistics
pub fn get_loved_stats(conn: &Connection) -> DbResult<LastfmLovedStats> {
    let total_cached: i64 =
        conn.query_row("SELECT COUNT(*) FROM lastfm_loved_tracks", [], |row| {
            row.get(0)
        })?;

    let matched_count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM lastfm_loved_tracks WHERE matched_track_id IS NOT NULL",
        [],
        |row| row.get(0),
    )?;

    Ok(LastfmLovedStats {
        total_cached,
        matched_count,
        unmatched_count: total_cached - matched_count,
    })
}

/// Check if a specific artist/track is in the loved cache
pub fn is_loved_cached(conn: &Connection, artist: &str, track: &str) -> DbResult<bool> {
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM lastfm_loved_tracks WHERE artist = ? AND track = ?",
        params![artist, track],
        |row| row.get(0),
    )?;
    Ok(count > 0)
}

/// Get a loved track by artist and track name
pub fn get_loved_by_name(
    conn: &Connection,
    artist: &str,
    track: &str,
) -> DbResult<Option<LastfmLovedTrack>> {
    let result = conn.query_row(
        "SELECT id, artist, track, loved_at, matched_track_id, last_checked_at, created_at
         FROM lastfm_loved_tracks
         WHERE artist = ? AND track = ?",
        params![artist, track],
        map_loved_track,
    );

    match result {
        Ok(entry) => Ok(Some(entry)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

/// Remove a loved track from the cache
pub fn remove_loved_track(conn: &Connection, loved_track_id: i64) -> DbResult<bool> {
    let deleted = conn.execute(
        "DELETE FROM lastfm_loved_tracks WHERE id = ?",
        [loved_track_id],
    )?;
    Ok(deleted > 0)
}

/// Clear all cached loved tracks
pub fn clear_loved_cache(conn: &Connection) -> DbResult<i64> {
    let deleted = conn.execute("DELETE FROM lastfm_loved_tracks", [])?;
    Ok(deleted as i64)
}

/// Get the most recent loved_at timestamp in the cache
///
/// Useful for incremental imports (fetch only tracks loved after this timestamp)
pub fn get_most_recent_loved_at(conn: &Connection) -> DbResult<Option<i64>> {
    let result: Result<i64, _> = conn.query_row(
        "SELECT MAX(loved_at) FROM lastfm_loved_tracks WHERE loved_at IS NOT NULL",
        [],
        |row| row.get(0),
    );

    match result {
        Ok(ts) => Ok(Some(ts)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(rusqlite::Error::InvalidColumnType(_, _, rusqlite::types::Type::Null)) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

/// Count of cached loved tracks
pub fn get_loved_count(conn: &Connection) -> DbResult<i64> {
    let count: i64 = conn.query_row("SELECT COUNT(*) FROM lastfm_loved_tracks", [], |row| {
        row.get(0)
    })?;
    Ok(count)
}

/// Helper function to map a row to LastfmLovedTrack
fn map_loved_track(row: &rusqlite::Row) -> rusqlite::Result<LastfmLovedTrack> {
    Ok(LastfmLovedTrack {
        id: row.get("id")?,
        artist: row.get("artist")?,
        track: row.get("track")?,
        loved_at: row.get("loved_at")?,
        matched_track_id: row.get("matched_track_id")?,
        last_checked_at: row.get("last_checked_at")?,
        created_at: row.get("created_at")?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema::{create_tables, run_migrations};

    fn setup_test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        create_tables(&conn).unwrap();
        run_migrations(&conn).unwrap();
        conn
    }

    /// Helper to insert a minimal library track for testing FK relationships
    fn insert_test_library_track(conn: &Connection, filepath: &str) -> i64 {
        conn.execute(
            "INSERT INTO library (filepath, duration) VALUES (?1, 180)",
            [filepath],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    #[test]
    fn test_upsert_loved_track() {
        let conn = setup_test_db();

        let id = upsert_loved_track(&conn, "Artist", "Track", Some(1234567890)).unwrap();
        assert!(id > 0);

        // Second insert should update, not duplicate
        let id2 = upsert_loved_track(&conn, "Artist", "Track", Some(1234567899)).unwrap();

        // Count should still be 1
        let count = get_loved_count(&conn).unwrap();
        assert_eq!(count, 1);

        // The loved_at should be updated to the newer value
        let entry = get_loved_by_name(&conn, "Artist", "Track")
            .unwrap()
            .unwrap();
        assert_eq!(entry.loved_at, Some(1234567899));
    }

    #[test]
    fn test_bulk_insert() {
        let conn = setup_test_db();

        let tracks = vec![
            ("Artist 1".to_string(), "Track 1".to_string(), Some(1000)),
            ("Artist 2".to_string(), "Track 2".to_string(), Some(2000)),
            ("Artist 3".to_string(), "Track 3".to_string(), None),
        ];

        let inserted = bulk_insert_loved_tracks(&conn, &tracks).unwrap();
        assert_eq!(inserted, 3);

        let count = get_loved_count(&conn).unwrap();
        assert_eq!(count, 3);
    }

    #[test]
    fn test_get_unmatched() {
        let conn = setup_test_db();

        // Insert some tracks
        let id1 = upsert_loved_track(&conn, "Artist 1", "Track 1", None).unwrap();
        let _id2 = upsert_loved_track(&conn, "Artist 2", "Track 2", None).unwrap();

        // Create a library track to satisfy FK constraint
        let library_track_id = insert_test_library_track(&conn, "/test/track1.mp3");

        // Mark one as matched
        set_matched_track(&conn, id1, library_track_id).unwrap();

        // Should only get the unmatched one
        let unmatched = get_unmatched_loved_tracks(&conn, None).unwrap();
        assert_eq!(unmatched.len(), 1);
        assert_eq!(unmatched[0].artist, "Artist 2");
    }

    #[test]
    fn test_loved_stats() {
        let conn = setup_test_db();

        upsert_loved_track(&conn, "Artist 1", "Track 1", None).unwrap();
        let id2 = upsert_loved_track(&conn, "Artist 2", "Track 2", None).unwrap();
        upsert_loved_track(&conn, "Artist 3", "Track 3", None).unwrap();

        // Create a library track to satisfy FK constraint
        let library_track_id = insert_test_library_track(&conn, "/test/track2.mp3");

        set_matched_track(&conn, id2, library_track_id).unwrap();

        let stats = get_loved_stats(&conn).unwrap();
        assert_eq!(stats.total_cached, 3);
        assert_eq!(stats.matched_count, 1);
        assert_eq!(stats.unmatched_count, 2);
    }

    #[test]
    fn test_clear_match() {
        let conn = setup_test_db();

        let id = upsert_loved_track(&conn, "Artist", "Track", None).unwrap();

        // Create a library track to satisfy FK constraint
        let library_track_id = insert_test_library_track(&conn, "/test/track.mp3");

        set_matched_track(&conn, id, library_track_id).unwrap();

        let entry = get_loved_by_name(&conn, "Artist", "Track")
            .unwrap()
            .unwrap();
        assert_eq!(entry.matched_track_id, Some(library_track_id));

        clear_match(&conn, library_track_id).unwrap();

        let entry = get_loved_by_name(&conn, "Artist", "Track")
            .unwrap()
            .unwrap();
        assert_eq!(entry.matched_track_id, None);
    }

    #[test]
    fn test_remove_loved_track() {
        let conn = setup_test_db();

        let id = upsert_loved_track(&conn, "Artist", "Track", None).unwrap();

        let removed = remove_loved_track(&conn, id).unwrap();
        assert!(removed);

        let count = get_loved_count(&conn).unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn test_clear_cache() {
        let conn = setup_test_db();

        upsert_loved_track(&conn, "Artist 1", "Track 1", None).unwrap();
        upsert_loved_track(&conn, "Artist 2", "Track 2", None).unwrap();

        let deleted = clear_loved_cache(&conn).unwrap();
        assert_eq!(deleted, 2);

        let count = get_loved_count(&conn).unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn test_most_recent_loved_at() {
        let conn = setup_test_db();

        // Empty cache
        let ts = get_most_recent_loved_at(&conn).unwrap();
        assert_eq!(ts, None);

        // Add some tracks
        upsert_loved_track(&conn, "Artist 1", "Track 1", Some(1000)).unwrap();
        upsert_loved_track(&conn, "Artist 2", "Track 2", Some(3000)).unwrap();
        upsert_loved_track(&conn, "Artist 3", "Track 3", Some(2000)).unwrap();

        let ts = get_most_recent_loved_at(&conn).unwrap();
        assert_eq!(ts, Some(3000));
    }
}
