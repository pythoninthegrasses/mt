//! Removed tracks database operations.
//!
//! Tracks user-initiated removals so that library scans don't re-add
//! files the user has explicitly deleted from the library.

use rusqlite::{Connection, params};
use std::collections::HashSet;

use crate::db::DbResult;

/// Record a track removal by filepath and optional content hash.
/// Uses INSERT OR REPLACE so re-removing the same filepath just updates the timestamp.
pub(crate) fn record_removal(
    conn: &Connection,
    filepath: &str,
    content_hash: Option<&str>,
) -> DbResult<()> {
    conn.execute(
        "INSERT OR REPLACE INTO removed_tracks (filepath, content_hash, removed_at)
         VALUES (?, ?, strftime('%s','now'))",
        params![filepath, content_hash],
    )?;
    Ok(())
}

/// Record multiple track removals in bulk.
/// Caller must ensure this runs inside a transaction for atomicity.
pub(crate) fn record_removals_bulk(
    conn: &Connection,
    tracks: &[(String, Option<String>)],
) -> DbResult<usize> {
    if tracks.is_empty() {
        return Ok(0);
    }

    let mut stmt = conn.prepare(
        "INSERT OR REPLACE INTO removed_tracks (filepath, content_hash, removed_at)
         VALUES (?, ?, strftime('%s','now'))",
    )?;

    let mut count = 0;
    for (filepath, content_hash) in tracks {
        stmt.execute(params![filepath, content_hash])?;
        count += 1;
    }
    Ok(count)
}

/// Check if a filepath has been removed by the user.
#[allow(dead_code)]
pub(crate) fn is_filepath_removed(conn: &Connection, filepath: &str) -> DbResult<bool> {
    let count: i32 = conn.query_row(
        "SELECT COUNT(*) FROM removed_tracks WHERE filepath = ?",
        [filepath],
        |row| row.get(0),
    )?;
    Ok(count > 0)
}

/// Get all removed filepaths as a set for efficient batch lookups during scanning.
pub(crate) fn get_removed_filepaths(conn: &Connection) -> DbResult<HashSet<String>> {
    let mut stmt = conn.prepare("SELECT filepath FROM removed_tracks")?;
    let paths: HashSet<String> = stmt
        .query_map([], |row| row.get(0))?
        .collect::<Result<HashSet<_>, _>>()?;
    Ok(paths)
}

/// Get all removed content hashes as a set for hash-based matching during scanning.
pub(crate) fn get_removed_content_hashes(conn: &Connection) -> DbResult<HashSet<String>> {
    let mut stmt =
        conn.prepare("SELECT content_hash FROM removed_tracks WHERE content_hash IS NOT NULL")?;
    let hashes: HashSet<String> = stmt
        .query_map([], |row| row.get(0))?
        .collect::<Result<HashSet<_>, _>>()?;
    Ok(hashes)
}

/// Remove a filepath from the removed list (un-remove / re-allow).
/// Used when user explicitly re-adds a track.
#[allow(dead_code)]
pub(crate) fn clear_removal(conn: &Connection, filepath: &str) -> DbResult<bool> {
    let deleted = conn.execute("DELETE FROM removed_tracks WHERE filepath = ?", [filepath])?;
    Ok(deleted > 0)
}

/// Clear all removal records. Used when user resets/clears the entire library.
pub(crate) fn clear_all_removals(conn: &Connection) -> DbResult<usize> {
    let deleted = conn.execute("DELETE FROM removed_tracks", [])?;
    Ok(deleted)
}

/// Filter a list of `(filepath, TrackMetadata)` pairs, removing any that match
/// previously-removed filepaths or content hashes. Returns the filtered vec and
/// the number of tracks that were skipped.
pub(crate) fn filter_removed_tracks(
    conn: &Connection,
    tracks: Vec<(String, crate::db::TrackMetadata)>,
) -> DbResult<(Vec<(String, crate::db::TrackMetadata)>, usize)> {
    let removed_paths = get_removed_filepaths(conn)?;
    let removed_hashes = get_removed_content_hashes(conn)?;

    if removed_paths.is_empty() && removed_hashes.is_empty() {
        return Ok((tracks, 0));
    }

    let before = tracks.len();
    let filtered: Vec<_> = tracks
        .into_iter()
        .filter(|(filepath, meta)| {
            if removed_paths.contains(filepath) {
                return false;
            }
            if let Some(ref hash) = meta.content_hash
                && removed_hashes.contains(hash)
            {
                return false;
            }
            true
        })
        .collect();
    let skipped = before - filtered.len();
    Ok((filtered, skipped))
}

/// Fetch filepath and content_hash for multiple track IDs in a single query.
pub(crate) fn get_track_removal_info_bulk(
    conn: &Connection,
    track_ids: &[i64],
) -> DbResult<Vec<(String, Option<String>)>> {
    if track_ids.is_empty() {
        return Ok(Vec::new());
    }

    let placeholders = track_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let sql = format!(
        "SELECT filepath, content_hash FROM library WHERE id IN ({})",
        placeholders
    );
    let params: Vec<&dyn rusqlite::ToSql> = track_ids
        .iter()
        .map(|id| id as &dyn rusqlite::ToSql)
        .collect();

    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt
        .query_map(params.as_slice(), |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
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
    fn test_record_and_check_removal() {
        let conn = setup_test_db();

        assert!(!is_filepath_removed(&conn, "/music/track.mp3").unwrap());

        record_removal(&conn, "/music/track.mp3", None).unwrap();

        assert!(is_filepath_removed(&conn, "/music/track.mp3").unwrap());
        assert!(!is_filepath_removed(&conn, "/music/other.mp3").unwrap());
    }

    #[test]
    fn test_record_removal_with_hash() {
        let conn = setup_test_db();

        record_removal(&conn, "/music/track.mp3", Some("abc123")).unwrap();

        assert!(is_filepath_removed(&conn, "/music/track.mp3").unwrap());

        let hashes = get_removed_content_hashes(&conn).unwrap();
        assert!(hashes.contains("abc123"));
    }

    #[test]
    fn test_record_removal_idempotent() {
        let conn = setup_test_db();

        record_removal(&conn, "/music/track.mp3", None).unwrap();
        record_removal(&conn, "/music/track.mp3", Some("hash1")).unwrap();

        // Should have exactly one entry (REPLACE on UNIQUE constraint)
        let count: i32 = conn
            .query_row("SELECT COUNT(*) FROM removed_tracks", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 1);

        // Hash should be updated
        let hashes = get_removed_content_hashes(&conn).unwrap();
        assert!(hashes.contains("hash1"));
    }

    #[test]
    fn test_record_removals_bulk() {
        let conn = setup_test_db();

        let tracks = vec![
            ("/music/a.mp3".to_string(), None),
            ("/music/b.mp3".to_string(), Some("hash_b".to_string())),
            ("/music/c.mp3".to_string(), Some("hash_c".to_string())),
        ];

        let count = record_removals_bulk(&conn, &tracks).unwrap();
        assert_eq!(count, 3);

        assert!(is_filepath_removed(&conn, "/music/a.mp3").unwrap());
        assert!(is_filepath_removed(&conn, "/music/b.mp3").unwrap());
        assert!(is_filepath_removed(&conn, "/music/c.mp3").unwrap());
    }

    #[test]
    fn test_get_removed_filepaths() {
        let conn = setup_test_db();

        record_removal(&conn, "/music/a.mp3", None).unwrap();
        record_removal(&conn, "/music/b.mp3", None).unwrap();

        let paths = get_removed_filepaths(&conn).unwrap();
        assert_eq!(paths.len(), 2);
        assert!(paths.contains("/music/a.mp3"));
        assert!(paths.contains("/music/b.mp3"));
    }

    #[test]
    fn test_clear_removal() {
        let conn = setup_test_db();

        record_removal(&conn, "/music/track.mp3", None).unwrap();
        assert!(is_filepath_removed(&conn, "/music/track.mp3").unwrap());

        let cleared = clear_removal(&conn, "/music/track.mp3").unwrap();
        assert!(cleared);
        assert!(!is_filepath_removed(&conn, "/music/track.mp3").unwrap());

        // Clearing non-existent returns false
        let cleared = clear_removal(&conn, "/music/nonexistent.mp3").unwrap();
        assert!(!cleared);
    }

    #[test]
    fn test_clear_all_removals() {
        let conn = setup_test_db();

        record_removal(&conn, "/music/a.mp3", None).unwrap();
        record_removal(&conn, "/music/b.mp3", None).unwrap();

        let cleared = clear_all_removals(&conn).unwrap();
        assert_eq!(cleared, 2);

        assert!(!is_filepath_removed(&conn, "/music/a.mp3").unwrap());
        assert!(!is_filepath_removed(&conn, "/music/b.mp3").unwrap());
    }

    #[test]
    fn test_delete_and_scan_filtering() {
        use crate::db::{TrackMetadata, library};

        let conn = setup_test_db();

        // Add a track to the library
        let meta = TrackMetadata {
            title: Some("Test Track".to_string()),
            artist: Some("Test Artist".to_string()),
            content_hash: Some("hash_abc".to_string()),
            ..Default::default()
        };
        library::add_tracks_bulk(&conn, &[("/music/test.mp3".to_string(), meta)]).unwrap();

        // Verify it was added - get by filepath
        let track_id: i64 = conn
            .query_row(
                "SELECT id FROM library WHERE filepath = ?",
                ["/music/test.mp3"],
                |row| row.get(0),
            )
            .unwrap();

        // Simulate user deleting the track (record removal + delete)
        let track = library::get_track_by_id(&conn, track_id).unwrap().unwrap();
        record_removal(&conn, &track.filepath, track.content_hash.as_deref()).unwrap();
        library::delete_track(&conn, track_id).unwrap();

        // Verify the track is removed from library
        assert!(library::get_track_by_id(&conn, track_id).unwrap().is_none());

        // Verify removal is recorded - should filter by filepath
        let removed_paths = get_removed_filepaths(&conn).unwrap();
        assert!(removed_paths.contains("/music/test.mp3"));

        // Verify removal is recorded - should filter by hash too
        let removed_hashes = get_removed_content_hashes(&conn).unwrap();
        assert!(removed_hashes.contains("hash_abc"));

        // Simulate scan trying to re-add the same file
        let new_tracks: Vec<(String, TrackMetadata)> = vec![(
            "/music/test.mp3".to_string(),
            TrackMetadata {
                title: Some("Test Track".to_string()),
                artist: Some("Test Artist".to_string()),
                ..Default::default()
            },
        )];

        // Filter like the scanner does
        let filtered: Vec<_> = new_tracks
            .into_iter()
            .filter(|(filepath, meta)| {
                if removed_paths.contains(filepath) {
                    return false;
                }
                if let Some(ref hash) = meta.content_hash {
                    if removed_hashes.contains(hash) {
                        return false;
                    }
                }
                true
            })
            .collect();

        // The track should be filtered out
        assert!(filtered.is_empty(), "Removed track should not be re-added");
    }

    #[test]
    fn test_hash_based_filtering_catches_moved_files() {
        let conn = setup_test_db();

        // Record removal with content hash
        record_removal(&conn, "/music/old/track.mp3", Some("hash_xyz")).unwrap();

        let removed_paths = get_removed_filepaths(&conn).unwrap();
        let removed_hashes = get_removed_content_hashes(&conn).unwrap();

        // Simulate scan finding the same file at a different path (moved)
        let filepath = "/music/new/track.mp3".to_string();
        let hash = Some("hash_xyz".to_string());

        let path_blocked = removed_paths.contains(&filepath);
        let hash_blocked = hash.as_ref().map_or(false, |h| removed_hashes.contains(h));

        assert!(!path_blocked, "Different path should not match by path");
        assert!(hash_blocked, "Same hash should be caught even at new path");
    }

    #[test]
    fn test_get_removed_content_hashes_excludes_nulls() {
        let conn = setup_test_db();

        record_removal(&conn, "/music/a.mp3", None).unwrap();
        record_removal(&conn, "/music/b.mp3", Some("hash_b")).unwrap();

        let hashes = get_removed_content_hashes(&conn).unwrap();
        assert_eq!(hashes.len(), 1);
        assert!(hashes.contains("hash_b"));
    }

    #[test]
    fn test_filter_removed_tracks() {
        use crate::db::TrackMetadata;

        let conn = setup_test_db();

        record_removal(&conn, "/music/removed.mp3", None).unwrap();
        record_removal(&conn, "/music/old.mp3", Some("hash_moved")).unwrap();

        let tracks = vec![
            ("/music/removed.mp3".to_string(), TrackMetadata::default()),
            (
                "/music/new_path.mp3".to_string(),
                TrackMetadata {
                    content_hash: Some("hash_moved".to_string()),
                    ..Default::default()
                },
            ),
            ("/music/keeper.mp3".to_string(), TrackMetadata::default()),
        ];

        let (filtered, skipped) = filter_removed_tracks(&conn, tracks).unwrap();
        assert_eq!(skipped, 2);
        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].0, "/music/keeper.mp3");
    }

    #[test]
    fn test_filter_removed_tracks_empty_removals() {
        use crate::db::TrackMetadata;

        let conn = setup_test_db();

        let tracks = vec![("/music/track.mp3".to_string(), TrackMetadata::default())];

        let (filtered, skipped) = filter_removed_tracks(&conn, tracks).unwrap();
        assert_eq!(skipped, 0);
        assert_eq!(filtered.len(), 1);
    }

    #[test]
    fn test_get_track_removal_info_bulk() {
        use crate::db::{TrackMetadata, library};

        let conn = setup_test_db();

        let meta1 = TrackMetadata {
            title: Some("Track 1".to_string()),
            content_hash: Some("h1".to_string()),
            ..Default::default()
        };
        let meta2 = TrackMetadata {
            title: Some("Track 2".to_string()),
            ..Default::default()
        };
        library::add_tracks_bulk(
            &conn,
            &[
                ("/music/a.mp3".to_string(), meta1),
                ("/music/b.mp3".to_string(), meta2),
            ],
        )
        .unwrap();

        let ids: Vec<i64> = conn
            .prepare("SELECT id FROM library ORDER BY id")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();

        let info = get_track_removal_info_bulk(&conn, &ids).unwrap();
        assert_eq!(info.len(), 2);
        assert!(
            info.iter()
                .any(|(p, h)| p == "/music/a.mp3" && h.as_deref() == Some("h1"))
        );
        assert!(info.iter().any(|(p, h)| p == "/music/b.mp3" && h.is_none()));
    }

    #[test]
    fn test_get_track_removal_info_bulk_empty() {
        let conn = setup_test_db();
        let info = get_track_removal_info_bulk(&conn, &[]).unwrap();
        assert!(info.is_empty());
    }
}
