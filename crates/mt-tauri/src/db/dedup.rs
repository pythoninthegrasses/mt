//! Cross-directory deduplication database operations.
//!
//! Tracks which filepaths have been suppressed (hidden from library) because
//! they are duplicates of a kept track in another watched directory.
//! Records are preserved so suppressed files can be reinstated if the kept
//! copy goes missing.

use rusqlite::{Connection, params};

use crate::db::DbResult;

/// Info about a suppressed track that might be reinstated
#[derive(Debug, Clone)]
#[allow(dead_code)] // Fields read in reinstatement callers
pub(crate) struct MissingKeptTrack {
    pub kept_track_id: i64,
    pub suppressed_filepath: String,
    pub suppressed_content_hash: Option<String>,
    pub suppressed_ctime_ns: Option<i64>,
    pub suppressed_mtime_ns: Option<i64>,
}

/// Info returned when clearing all suppressions (for re-scanning)
#[derive(Debug, Clone)]
#[allow(dead_code)] // Fields read in clear_all_suppressions callers
pub(crate) struct SuppressedTrackInfo {
    pub suppressed_filepath: String,
    pub suppressed_content_hash: Option<String>,
}

/// Record a suppressed duplicate filepath
pub(crate) fn suppress_track(
    conn: &Connection,
    kept_track_id: i64,
    filepath: &str,
    content_hash: Option<&str>,
    ctime_ns: Option<i64>,
    mtime_ns: Option<i64>,
) -> DbResult<()> {
    conn.execute(
        "INSERT INTO deduplicated_tracks
         (kept_track_id, suppressed_filepath, suppressed_content_hash,
          suppressed_ctime_ns, suppressed_mtime_ns)
         VALUES (?, ?, ?, ?, ?)",
        params![kept_track_id, filepath, content_hash, ctime_ns, mtime_ns],
    )?;
    Ok(())
}

/// Find kept tracks that are missing and have suppressed candidates for reinstatement.
///
/// Returns records where the kept track is marked missing=1 in the library.
pub(crate) fn find_missing_kept_tracks(conn: &Connection) -> DbResult<Vec<MissingKeptTrack>> {
    let mut stmt = conn.prepare(
        "SELECT dt.kept_track_id, dt.suppressed_filepath,
                dt.suppressed_content_hash, dt.suppressed_ctime_ns, dt.suppressed_mtime_ns
         FROM deduplicated_tracks dt
         JOIN library l ON l.id = dt.kept_track_id
         WHERE l.missing = 1
         ORDER BY dt.kept_track_id, dt.suppressed_ctime_ns ASC NULLS LAST",
    )?;

    let rows: Vec<MissingKeptTrack> = stmt
        .query_map([], |row| {
            Ok(MissingKeptTrack {
                kept_track_id: row.get(0)?,
                suppressed_filepath: row.get(1)?,
                suppressed_content_hash: row.get(2)?,
                suppressed_ctime_ns: row.get(3)?,
                suppressed_mtime_ns: row.get(4)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();

    Ok(rows)
}

/// Remove all suppression records for a given kept track
#[allow(dead_code)]
pub(crate) fn clear_suppressions_for_kept_track(
    conn: &Connection,
    kept_track_id: i64,
) -> DbResult<usize> {
    let deleted = conn.execute(
        "DELETE FROM deduplicated_tracks WHERE kept_track_id = ?",
        [kept_track_id],
    )?;
    Ok(deleted)
}

/// Remove all suppression records and return the suppressed filepaths for re-scanning.
///
/// Used when the cross-directory dedup setting is disabled — all previously
/// suppressed tracks should be re-added to the library.
pub(crate) fn clear_all_suppressions(conn: &Connection) -> DbResult<Vec<SuppressedTrackInfo>> {
    let mut stmt = conn
        .prepare("SELECT suppressed_filepath, suppressed_content_hash FROM deduplicated_tracks")?;

    let infos: Vec<SuppressedTrackInfo> = stmt
        .query_map([], |row| {
            Ok(SuppressedTrackInfo {
                suppressed_filepath: row.get(0)?,
                suppressed_content_hash: row.get(1)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();

    conn.execute("DELETE FROM deduplicated_tracks", [])?;

    Ok(infos)
}

/// Update kept_track_id in deduplicated_tracks (after reinstatement, point
/// remaining suppression records at the new keeper).
pub(crate) fn update_kept_track_id(
    conn: &Connection,
    old_kept_id: i64,
    new_kept_id: i64,
) -> DbResult<usize> {
    let updated = conn.execute(
        "UPDATE deduplicated_tracks SET kept_track_id = ? WHERE kept_track_id = ?",
        params![new_kept_id, old_kept_id],
    )?;
    Ok(updated)
}

/// Remove the suppression record for a specific filepath (e.g. after reinstatement)
pub(crate) fn remove_suppression_by_filepath(conn: &Connection, filepath: &str) -> DbResult<usize> {
    let deleted = conn.execute(
        "DELETE FROM deduplicated_tracks WHERE suppressed_filepath = ?",
        [filepath],
    )?;
    Ok(deleted)
}

/// Count total suppressed tracks
pub(crate) fn count_suppressed(conn: &Connection) -> DbResult<i64> {
    let count: i64 = conn.query_row("SELECT COUNT(*) FROM deduplicated_tracks", [], |row| {
        row.get(0)
    })?;
    Ok(count)
}

type TrackVec = Vec<(String, crate::db::TrackMetadata)>;

/// Get all suppressed filepaths from deduplicated_tracks.
pub(crate) fn get_suppressed_filepaths(
    conn: &Connection,
) -> DbResult<std::collections::HashSet<String>> {
    let mut stmt = conn.prepare("SELECT suppressed_filepath FROM deduplicated_tracks")?;
    let paths: std::collections::HashSet<String> = stmt
        .query_map([], |row| row.get(0))?
        .filter_map(|r| r.ok())
        .collect();
    Ok(paths)
}

/// Filter a list of `(filepath, TrackMetadata)` pairs, removing any whose
/// filepath is currently suppressed by cross-directory dedup. Returns the
/// filtered vec and the number of tracks that were skipped.
///
/// On DB errors, the original `tracks` vec is returned alongside the error so
/// the caller can fall back to unfiltered insertion.
pub(crate) fn filter_suppressed_tracks(
    conn: &Connection,
    tracks: TrackVec,
) -> Result<(TrackVec, usize), (crate::db::DbError, TrackVec)> {
    let suppressed = match get_suppressed_filepaths(conn) {
        Ok(v) => v,
        Err(e) => return Err((e, tracks)),
    };

    if suppressed.is_empty() {
        return Ok((tracks, 0));
    }

    let before = tracks.len();
    let filtered: Vec<_> = tracks
        .into_iter()
        .filter(|(filepath, _)| !suppressed.contains(filepath))
        .collect();
    let skipped = before - filtered.len();
    Ok((filtered, skipped))
}

/// Result of running reinstatement
#[derive(Debug, Default)]
pub(crate) struct ReinstatementResult {
    pub reinstated: u32,
    pub errors: u32,
}

/// Perform reinstatement of suppressed tracks when their kept track is missing.
///
/// For each missing kept track:
/// 1. Check if any suppressed filepath still exists on disk
/// 2. If found: add the file to the library and merge metadata from the missing kept track
/// 3. Update remaining suppression records to point at the new track
///
/// The `extract_and_add` callback handles the filesystem-dependent work
/// (metadata extraction + DB insert), returning the new track ID on success.
pub(crate) fn reinstate_missing_kept_tracks<F>(
    conn: &Connection,
    mut extract_and_add: F,
) -> DbResult<ReinstatementResult>
where
    F: FnMut(&str) -> Option<i64>,
{
    let missing = find_missing_kept_tracks(conn)?;
    if missing.is_empty() {
        return Ok(ReinstatementResult::default());
    }

    // Group by kept_track_id
    let mut groups: std::collections::HashMap<i64, Vec<MissingKeptTrack>> =
        std::collections::HashMap::new();
    for record in missing {
        groups.entry(record.kept_track_id).or_default().push(record);
    }

    let mut result = ReinstatementResult::default();

    for (old_kept_id, candidates) in &groups {
        let mut reinstated = false;

        for candidate in candidates {
            // The extract_and_add callback checks disk existence and does metadata extraction
            if let Some(new_track_id) = extract_and_add(&candidate.suppressed_filepath) {
                // Update suppression records BEFORE merging to avoid FK violation
                // (merge deletes old_kept_id from library, which deduplicated_tracks references)
                let _ = update_kept_track_id(conn, *old_kept_id, new_track_id);
                let _ = remove_suppression_by_filepath(conn, &candidate.suppressed_filepath);

                // Transfer play_count, favorites, playlists from missing kept track
                match crate::db::library::merge_duplicate_tracks(conn, new_track_id, *old_kept_id) {
                    Ok(true) => {
                        result.reinstated += 1;
                        reinstated = true;
                        break;
                    }
                    Ok(false) => {
                        result.errors += 1;
                    }
                    Err(_) => {
                        result.errors += 1;
                    }
                }
            }
        }

        if !reinstated {
            // None of the suppressed filepaths exist on disk — nothing to reinstate
            // The kept track remains missing; suppression records are kept for future attempts
        }
    }

    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::TrackMetadata;
    use crate::db::library;
    use crate::db::schema::{create_tables, run_migrations};

    fn setup_test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        create_tables(&conn).unwrap();
        run_migrations(&conn).unwrap();
        conn
    }

    fn add_test_track(conn: &Connection, path: &str) -> i64 {
        let metadata = TrackMetadata {
            title: Some(path.to_string()),
            content_hash: Some("sha256:abc123".to_string()),
            ..Default::default()
        };
        library::add_track(conn, path, &metadata).unwrap()
    }

    #[test]
    fn test_suppress_and_count() {
        let conn = setup_test_db();
        let kept_id = add_test_track(&conn, "/music/a/song.mp3");

        suppress_track(
            &conn,
            kept_id,
            "/music/b/song.mp3",
            Some("sha256:abc123"),
            Some(1000),
            Some(2000),
        )
        .unwrap();

        assert_eq!(count_suppressed(&conn).unwrap(), 1);
    }

    #[test]
    fn test_suppress_multiple_and_clear_for_kept_track() {
        let conn = setup_test_db();
        let kept_id = add_test_track(&conn, "/music/a/song.mp3");
        let other_id = add_test_track(&conn, "/music/c/other.mp3");

        suppress_track(&conn, kept_id, "/music/b/song.mp3", None, None, None).unwrap();
        suppress_track(&conn, kept_id, "/music/d/song.mp3", None, None, None).unwrap();
        suppress_track(&conn, other_id, "/music/e/other.mp3", None, None, None).unwrap();

        assert_eq!(count_suppressed(&conn).unwrap(), 3);

        let cleared = clear_suppressions_for_kept_track(&conn, kept_id).unwrap();
        assert_eq!(cleared, 2);
        assert_eq!(count_suppressed(&conn).unwrap(), 1);
    }

    #[test]
    fn test_clear_all_suppressions_returns_filepaths() {
        let conn = setup_test_db();
        let kept_id = add_test_track(&conn, "/music/a/song.mp3");

        suppress_track(
            &conn,
            kept_id,
            "/music/b/song.mp3",
            Some("sha256:abc"),
            None,
            None,
        )
        .unwrap();
        suppress_track(
            &conn,
            kept_id,
            "/music/c/song.mp3",
            Some("sha256:def"),
            None,
            None,
        )
        .unwrap();

        let infos = clear_all_suppressions(&conn).unwrap();
        assert_eq!(infos.len(), 2);

        let paths: Vec<&str> = infos
            .iter()
            .map(|i| i.suppressed_filepath.as_str())
            .collect();
        assert!(paths.contains(&"/music/b/song.mp3"));
        assert!(paths.contains(&"/music/c/song.mp3"));

        assert_eq!(count_suppressed(&conn).unwrap(), 0);
    }

    #[test]
    fn test_find_missing_kept_tracks() {
        let conn = setup_test_db();
        let kept_id = add_test_track(&conn, "/music/a/song.mp3");

        suppress_track(&conn, kept_id, "/music/b/song.mp3", None, None, None).unwrap();

        // Kept track is not missing yet
        let missing = find_missing_kept_tracks(&conn).unwrap();
        assert!(missing.is_empty());

        // Mark kept track as missing
        library::mark_track_missing(&conn, kept_id).unwrap();

        let missing = find_missing_kept_tracks(&conn).unwrap();
        assert_eq!(missing.len(), 1);
        assert_eq!(missing[0].kept_track_id, kept_id);
        assert_eq!(missing[0].suppressed_filepath, "/music/b/song.mp3");
    }

    #[test]
    fn test_update_kept_track_id() {
        let conn = setup_test_db();
        let old_id = add_test_track(&conn, "/music/a/song.mp3");
        let new_id = add_test_track(&conn, "/music/b/song.mp3");

        suppress_track(&conn, old_id, "/music/c/song.mp3", None, None, None).unwrap();
        suppress_track(&conn, old_id, "/music/d/song.mp3", None, None, None).unwrap();

        let updated = update_kept_track_id(&conn, old_id, new_id).unwrap();
        assert_eq!(updated, 2);

        // Mark new_id as missing, verify suppressions point to it
        library::mark_track_missing(&conn, new_id).unwrap();
        let missing = find_missing_kept_tracks(&conn).unwrap();
        assert_eq!(missing.len(), 2);
        assert!(missing.iter().all(|m| m.kept_track_id == new_id));
    }

    #[test]
    fn test_remove_suppression_by_filepath() {
        let conn = setup_test_db();
        let kept_id = add_test_track(&conn, "/music/a/song.mp3");

        suppress_track(&conn, kept_id, "/music/b/song.mp3", None, None, None).unwrap();
        suppress_track(&conn, kept_id, "/music/c/song.mp3", None, None, None).unwrap();

        let removed = remove_suppression_by_filepath(&conn, "/music/b/song.mp3").unwrap();
        assert_eq!(removed, 1);
        assert_eq!(count_suppressed(&conn).unwrap(), 1);
    }

    // =========================================================================
    // Reinstatement tests
    // =========================================================================

    #[test]
    fn test_reinstate_missing_kept_track_with_existing_suppressed() {
        let conn = setup_test_db();

        // Set up: kept track with play count, suppressed duplicate
        let kept_id = add_test_track(&conn, "/music/a/song.mp3");
        conn.execute("UPDATE library SET play_count = 5 WHERE id = ?", [kept_id])
            .unwrap();

        suppress_track(&conn, kept_id, "/music/b/song.mp3", None, None, None).unwrap();

        // Mark kept track as missing
        library::mark_track_missing(&conn, kept_id).unwrap();

        // Reinstate: the callback simulates finding the file and inserting it
        let result = reinstate_missing_kept_tracks(&conn, |filepath| {
            if filepath == "/music/b/song.mp3" {
                let meta = TrackMetadata {
                    title: Some("Reinstated".to_string()),
                    ..Default::default()
                };
                library::add_track(&conn, filepath, &meta).ok()
            } else {
                None
            }
        })
        .unwrap();

        assert_eq!(result.reinstated, 1);
        assert_eq!(result.errors, 0);

        // The old kept track should be deleted (merged into new)
        let old = library::get_track_by_id(&conn, kept_id).unwrap();
        assert!(old.is_none());

        // Suppression record for reinstated filepath should be removed
        assert_eq!(count_suppressed(&conn).unwrap(), 0);
    }

    #[test]
    fn test_reinstate_no_suppressed_files_exist() {
        let conn = setup_test_db();

        let kept_id = add_test_track(&conn, "/music/a/song.mp3");
        suppress_track(&conn, kept_id, "/music/b/song.mp3", None, None, None).unwrap();
        library::mark_track_missing(&conn, kept_id).unwrap();

        // Callback returns None for all filepaths (file doesn't exist)
        let result = reinstate_missing_kept_tracks(&conn, |_| None).unwrap();

        assert_eq!(result.reinstated, 0);
        assert_eq!(result.errors, 0);

        // Suppression records should still exist (kept for future attempts)
        assert_eq!(count_suppressed(&conn).unwrap(), 1);
    }

    #[test]
    fn test_reinstate_updates_remaining_suppression_records() {
        let conn = setup_test_db();

        let kept_id = add_test_track(&conn, "/music/a/song.mp3");
        suppress_track(&conn, kept_id, "/music/b/song.mp3", None, None, None).unwrap();
        suppress_track(&conn, kept_id, "/music/c/song.mp3", None, None, None).unwrap();
        library::mark_track_missing(&conn, kept_id).unwrap();

        // Only /music/b/song.mp3 exists
        let result = reinstate_missing_kept_tracks(&conn, |filepath| {
            if filepath == "/music/b/song.mp3" {
                let meta = TrackMetadata::default();
                library::add_track(&conn, filepath, &meta).ok()
            } else {
                None
            }
        })
        .unwrap();

        assert_eq!(result.reinstated, 1);

        // /music/c/song.mp3 suppression should now point to the new track
        // The reinstated filepath suppression should be removed
        assert_eq!(count_suppressed(&conn).unwrap(), 1);
    }

    // =========================================================================
    // filter_suppressed_tracks tests
    // =========================================================================

    #[test]
    fn test_filter_suppressed_tracks_removes_suppressed() {
        let conn = setup_test_db();
        let kept_id = add_test_track(&conn, "/music/a/song.mp3");

        suppress_track(
            &conn,
            kept_id,
            "/music/b/song.mp3",
            Some("sha256:abc123"),
            None,
            None,
        )
        .unwrap();

        let tracks = vec![
            ("/music/b/song.mp3".to_string(), TrackMetadata::default()),
            ("/music/c/other.mp3".to_string(), TrackMetadata::default()),
        ];

        let (filtered, skipped) = filter_suppressed_tracks(&conn, tracks).unwrap();
        assert_eq!(skipped, 1);
        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].0, "/music/c/other.mp3");
    }

    #[test]
    fn test_filter_suppressed_tracks_no_suppressions() {
        let conn = setup_test_db();

        let tracks = vec![
            ("/music/a/song.mp3".to_string(), TrackMetadata::default()),
            ("/music/b/song.mp3".to_string(), TrackMetadata::default()),
        ];

        let (filtered, skipped) = filter_suppressed_tracks(&conn, tracks).unwrap();
        assert_eq!(skipped, 0);
        assert_eq!(filtered.len(), 2);
    }

    #[test]
    fn test_filter_suppressed_tracks_all_suppressed() {
        let conn = setup_test_db();
        let kept_id = add_test_track(&conn, "/music/a/song.mp3");

        suppress_track(&conn, kept_id, "/music/b/song.mp3", None, None, None).unwrap();
        suppress_track(&conn, kept_id, "/music/c/song.mp3", None, None, None).unwrap();

        let tracks = vec![
            ("/music/b/song.mp3".to_string(), TrackMetadata::default()),
            ("/music/c/song.mp3".to_string(), TrackMetadata::default()),
        ];

        let (filtered, skipped) = filter_suppressed_tracks(&conn, tracks).unwrap();
        assert_eq!(skipped, 2);
        assert!(filtered.is_empty());
    }
}
