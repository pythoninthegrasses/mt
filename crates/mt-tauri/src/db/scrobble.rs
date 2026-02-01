//! Scrobble queue database operations.
//!
//! Operations for offline Last.fm scrobble queue.

use rusqlite::{params, Connection};

use crate::db::{DbResult, ScrobbleEntry};

/// Add a scrobble to the offline queue
pub fn queue_scrobble(
    conn: &Connection,
    artist: &str,
    track: &str,
    album: Option<&str>,
    timestamp: i64,
) -> DbResult<i64> {
    conn.execute(
        "INSERT INTO scrobble_queue (artist, track, album, timestamp) VALUES (?, ?, ?, ?)",
        params![artist, track, album, timestamp],
    )?;

    Ok(conn.last_insert_rowid())
}

/// Get queued scrobbles for retry
pub fn get_queued_scrobbles(conn: &Connection, limit: i64) -> DbResult<Vec<ScrobbleEntry>> {
    let mut stmt = conn.prepare(
        "SELECT id, artist, track, album, timestamp, created_at, retry_count
         FROM scrobble_queue
         ORDER BY created_at ASC
         LIMIT ?",
    )?;

    let entries: Vec<ScrobbleEntry> = stmt
        .query_map([limit], |row| {
            Ok(ScrobbleEntry {
                id: row.get("id")?,
                artist: row.get("artist")?,
                track: row.get("track")?,
                album: row.get("album")?,
                timestamp: row.get("timestamp")?,
                created_at: row.get("created_at")?,
                retry_count: row.get::<_, Option<i64>>("retry_count")?.unwrap_or(0),
            })
        })?
        .filter_map(|r| r.ok())
        .collect();

    Ok(entries)
}

/// Remove a successfully scrobbled item from the queue
pub fn remove_queued_scrobble(conn: &Connection, scrobble_id: i64) -> DbResult<bool> {
    let deleted = conn.execute("DELETE FROM scrobble_queue WHERE id = ?", [scrobble_id])?;
    Ok(deleted > 0)
}

/// Increment retry count for a failed scrobble
pub fn increment_scrobble_retry(conn: &Connection, scrobble_id: i64) -> DbResult<i64> {
    conn.execute(
        "UPDATE scrobble_queue SET retry_count = retry_count + 1 WHERE id = ?",
        [scrobble_id],
    )?;

    let count: i64 = conn
        .query_row(
            "SELECT retry_count FROM scrobble_queue WHERE id = ?",
            [scrobble_id],
            |row| row.get(0),
        )
        .unwrap_or(0);

    Ok(count)
}

/// Remove old queued scrobbles that are unlikely to succeed
pub fn clean_old_scrobbles(conn: &Connection, max_age_days: i64) -> DbResult<i64> {
    let modifier = format!("-{} days", max_age_days);

    let deleted = conn.execute(
        "DELETE FROM scrobble_queue WHERE created_at < datetime('now', ?)",
        [modifier],
    )?;

    Ok(deleted as i64)
}

/// Get the count of queued scrobbles
pub fn get_scrobble_queue_count(conn: &Connection) -> DbResult<i64> {
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM scrobble_queue",
        [],
        |row| row.get(0),
    )?;
    Ok(count)
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

    #[test]
    fn test_queue_and_get_scrobbles() {
        let conn = setup_test_db();

        let timestamp = chrono::Utc::now().timestamp();

        let id = queue_scrobble(&conn, "Artist", "Track", Some("Album"), timestamp).unwrap();
        assert!(id > 0);

        let entries = get_queued_scrobbles(&conn, 10).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].artist, "Artist");
        assert_eq!(entries[0].track, "Track");
        assert_eq!(entries[0].album, Some("Album".to_string()));
    }

    #[test]
    fn test_remove_scrobble() {
        let conn = setup_test_db();

        let timestamp = chrono::Utc::now().timestamp();
        let id = queue_scrobble(&conn, "Artist", "Track", None, timestamp).unwrap();

        let removed = remove_queued_scrobble(&conn, id).unwrap();
        assert!(removed);

        let count = get_scrobble_queue_count(&conn).unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn test_increment_retry() {
        let conn = setup_test_db();

        let timestamp = chrono::Utc::now().timestamp();
        let id = queue_scrobble(&conn, "Artist", "Track", None, timestamp).unwrap();

        let count = increment_scrobble_retry(&conn, id).unwrap();
        assert_eq!(count, 1);

        let count = increment_scrobble_retry(&conn, id).unwrap();
        assert_eq!(count, 2);
    }

    #[test]
    fn test_scrobble_ordering() {
        let conn = setup_test_db();

        for i in 1..=5 {
            let timestamp = chrono::Utc::now().timestamp() + i;
            queue_scrobble(&conn, &format!("Artist {}", i), "Track", None, timestamp).unwrap();
        }

        let entries = get_queued_scrobbles(&conn, 3).unwrap();
        assert_eq!(entries.len(), 3);
        assert_eq!(entries[0].artist, "Artist 1"); // Oldest first
    }
}
