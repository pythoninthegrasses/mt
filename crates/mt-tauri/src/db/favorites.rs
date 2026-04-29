//! Favorites database operations.
//!
//! Operations for favorited tracks, top played, and recently played.

use rusqlite::{Connection, params};

use crate::db::library::row_to_track;
use crate::db::{DbResult, FavoriteTrack, PaginatedResult, Track};

/// Get favorited tracks with pagination
pub(crate) fn get_favorites(
    conn: &Connection,
    limit: i64,
    offset: i64,
) -> DbResult<PaginatedResult<FavoriteTrack>> {
    let total: i64 = conn.query_row("SELECT COUNT(*) FROM favorites", [], |row| row.get(0))?;

    let mut stmt = conn.prepare(
        "SELECT l.id, l.filepath, l.title, l.artist, l.album, l.album_artist,
                l.track_number, l.track_total, l.disc_number, l.disc_total, l.date, l.genre,
                l.duration, l.file_size, l.play_count, l.last_played, l.added_date,
                l.missing, l.last_seen_at, l.file_mtime_ns, l.file_inode, l.content_hash,
                f.timestamp as favorited_date
         FROM favorites f
         JOIN library l ON f.track_id = l.id
         ORDER BY f.timestamp ASC
         LIMIT ? OFFSET ?",
    )?;

    let tracks: Vec<FavoriteTrack> = stmt
        .query_map([limit, offset], |row| {
            Ok(FavoriteTrack {
                track: row_to_track(row)?,
                favorited_date: row.get("favorited_date")?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();

    Ok(PaginatedResult {
        items: tracks,
        total,
    })
}

/// Get top 25 most played tracks
pub(crate) fn get_top_25(conn: &Connection) -> DbResult<Vec<Track>> {
    let mut stmt = conn.prepare(
        "SELECT id, filepath, title, artist, album, album_artist,
                track_number, track_total, disc_number, disc_total, date, genre,
                duration, file_size, play_count, last_played, added_date,
                missing, last_seen_at, file_mtime_ns, file_ctime_ns, file_inode, content_hash
         FROM library
         WHERE play_count > 0
         ORDER BY play_count DESC, last_played DESC
         LIMIT 25",
    )?;

    let tracks: Vec<Track> = stmt
        .query_map([], row_to_track)?
        .filter_map(|r| r.ok())
        .collect();

    Ok(tracks)
}

/// Get tracks played within the last N days
pub(crate) fn get_recently_played(
    conn: &Connection,
    days: i64,
    limit: i64,
) -> DbResult<Vec<Track>> {
    let modifier = format!("-{} days", days);

    let mut stmt = conn.prepare(
        "SELECT id, filepath, title, artist, album, album_artist,
                track_number, track_total, disc_number, disc_total, date, genre,
                duration, file_size, play_count, last_played, added_date,
                missing, last_seen_at, file_mtime_ns, file_ctime_ns, file_inode, content_hash
         FROM library
         WHERE last_played IS NOT NULL
           AND last_played >= datetime('now', ?)
         ORDER BY last_played DESC
         LIMIT ?",
    )?;

    let tracks: Vec<Track> = stmt
        .query_map(params![modifier, limit], row_to_track)?
        .filter_map(|r| r.ok())
        .collect();

    Ok(tracks)
}

/// Get tracks added within the last N days
pub(crate) fn get_recently_added(conn: &Connection, days: i64, limit: i64) -> DbResult<Vec<Track>> {
    let modifier = format!("-{} days", days);

    let mut stmt = conn.prepare(
        "SELECT id, filepath, title, artist, album, album_artist,
                track_number, track_total, disc_number, disc_total, date, genre,
                duration, file_size, play_count, last_played, added_date,
                missing, last_seen_at, file_mtime_ns, file_ctime_ns, file_inode, content_hash
         FROM library
         WHERE added_date IS NOT NULL
           AND added_date >= datetime('now', ?)
         ORDER BY added_date DESC
         LIMIT ?",
    )?;

    let tracks: Vec<Track> = stmt
        .query_map(params![modifier, limit], row_to_track)?
        .filter_map(|r| r.ok())
        .collect();

    Ok(tracks)
}

/// Count, total duration, and total file size of favorited tracks.
pub(crate) fn get_favorites_stats(conn: &Connection) -> DbResult<(i64, f64, i64)> {
    let (count, duration, size) = conn.query_row(
        "SELECT COUNT(*), COALESCE(SUM(l.duration), 0), COALESCE(SUM(l.file_size), 0)
         FROM favorites f JOIN library l ON f.track_id = l.id",
        [],
        |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, f64>(1)?,
                row.get::<_, i64>(2)?,
            ))
        },
    )?;
    Ok((count, duration, size))
}

/// Count, total duration, and total file size of top 25 most played tracks.
pub(crate) fn get_top_25_stats(conn: &Connection) -> DbResult<(i64, f64, i64)> {
    let (count, duration, size) = conn.query_row(
        "SELECT COUNT(*), COALESCE(SUM(duration), 0), COALESCE(SUM(file_size), 0)
         FROM (SELECT duration, file_size FROM library WHERE play_count > 0
               ORDER BY play_count DESC, last_played DESC LIMIT 25)",
        [],
        |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, f64>(1)?,
                row.get::<_, i64>(2)?,
            ))
        },
    )?;
    Ok((count, duration, size))
}

/// Count, total duration, and total file size of recently played tracks.
pub(crate) fn get_recently_played_stats(
    conn: &Connection,
    days: i64,
    limit: i64,
) -> DbResult<(i64, f64, i64)> {
    let modifier = format!("-{} days", days);
    let (count, duration, size) = conn.query_row(
        "SELECT COUNT(*), COALESCE(SUM(duration), 0), COALESCE(SUM(file_size), 0)
         FROM (SELECT duration, file_size FROM library
               WHERE last_played IS NOT NULL AND last_played >= datetime('now', ?)
               ORDER BY last_played DESC LIMIT ?)",
        params![modifier, limit],
        |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, f64>(1)?,
                row.get::<_, i64>(2)?,
            ))
        },
    )?;
    Ok((count, duration, size))
}

/// Count, total duration, and total file size of recently added tracks.
pub(crate) fn get_recently_added_stats(
    conn: &Connection,
    days: i64,
    limit: i64,
) -> DbResult<(i64, f64, i64)> {
    let modifier = format!("-{} days", days);
    let (count, duration, size) = conn.query_row(
        "SELECT COUNT(*), COALESCE(SUM(duration), 0), COALESCE(SUM(file_size), 0)
         FROM (SELECT duration, file_size FROM library
               WHERE added_date IS NOT NULL AND added_date >= datetime('now', ?)
               ORDER BY added_date DESC LIMIT ?)",
        params![modifier, limit],
        |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, f64>(1)?,
                row.get::<_, i64>(2)?,
            ))
        },
    )?;
    Ok((count, duration, size))
}

/// Check if a track is favorited
pub(crate) fn is_favorite(conn: &Connection, track_id: i64) -> DbResult<(bool, Option<String>)> {
    match conn.query_row(
        "SELECT timestamp FROM favorites WHERE track_id = ?",
        [track_id],
        |row| row.get::<_, String>(0),
    ) {
        Ok(timestamp) => Ok((true, Some(timestamp))),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok((false, None)),
        Err(e) => Err(e.into()),
    }
}

/// Add a track to favorites
pub(crate) fn add_favorite(conn: &Connection, track_id: i64) -> DbResult<Option<String>> {
    match conn.execute("INSERT INTO favorites (track_id) VALUES (?)", [track_id]) {
        Ok(_) => {
            let timestamp: String = conn.query_row(
                "SELECT timestamp FROM favorites WHERE track_id = ?",
                [track_id],
                |row| row.get(0),
            )?;
            crate::db::revision::bump_revision(conn)?;
            Ok(Some(timestamp))
        }
        Err(rusqlite::Error::SqliteFailure(err, _))
            if err.code == rusqlite::ErrorCode::ConstraintViolation =>
        {
            Ok(None) // Already favorited
        }
        Err(e) => Err(e.into()),
    }
}

/// Remove a track from favorites
pub(crate) fn remove_favorite(conn: &Connection, track_id: i64) -> DbResult<bool> {
    let deleted = conn.execute("DELETE FROM favorites WHERE track_id = ?", [track_id])?;
    if deleted > 0 {
        crate::db::revision::bump_revision(conn)?;
    }
    Ok(deleted > 0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{
        TrackMetadata,
        library::{add_track, update_play_count},
        schema::{create_tables, run_migrations},
    };

    fn setup_test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        create_tables(&conn).unwrap();
        run_migrations(&conn).unwrap();
        conn
    }

    #[test]
    fn test_add_and_remove_favorite() {
        let conn = setup_test_db();

        let metadata = TrackMetadata {
            title: Some("Test".to_string()),
            ..Default::default()
        };
        let id = add_track(&conn, "/music/test.mp3", &metadata).unwrap();

        // Add favorite
        let timestamp = add_favorite(&conn, id).unwrap();
        assert!(timestamp.is_some());

        // Check is favorite
        let (is_fav, _) = is_favorite(&conn, id).unwrap();
        assert!(is_fav);

        // Adding again should return None
        let timestamp = add_favorite(&conn, id).unwrap();
        assert!(timestamp.is_none());

        // Remove favorite
        let removed = remove_favorite(&conn, id).unwrap();
        assert!(removed);

        // Check is not favorite
        let (is_fav, _) = is_favorite(&conn, id).unwrap();
        assert!(!is_fav);
    }

    #[test]
    fn test_get_favorites() {
        let conn = setup_test_db();

        for i in 1..=5 {
            let metadata = TrackMetadata {
                title: Some(format!("Track {}", i)),
                ..Default::default()
            };
            let id = add_track(&conn, &format!("/music/track{}.mp3", i), &metadata).unwrap();
            add_favorite(&conn, id).unwrap();
        }

        let result = get_favorites(&conn, 10, 0).unwrap();
        assert_eq!(result.total, 5);
        assert_eq!(result.items.len(), 5);
    }

    #[test]
    fn test_get_top_25() {
        let conn = setup_test_db();

        for i in 1..=30 {
            let metadata = TrackMetadata {
                title: Some(format!("Track {}", i)),
                ..Default::default()
            };
            let id = add_track(&conn, &format!("/music/track{}.mp3", i), &metadata).unwrap();

            // Increment play count for some tracks
            for _ in 0..i {
                update_play_count(&conn, id).unwrap();
            }
        }

        let top = get_top_25(&conn).unwrap();
        assert_eq!(top.len(), 25);
        assert_eq!(top[0].play_count, 30); // Most played first
    }

    #[test]
    fn test_get_recently_played_empty() {
        let conn = setup_test_db();

        // No tracks played yet
        let recent = get_recently_played(&conn, 7, 10).unwrap();
        assert!(recent.is_empty());
    }

    #[test]
    fn test_get_recently_played_with_tracks() {
        let conn = setup_test_db();

        // Add a track and update its play count (which also sets last_played)
        let metadata = TrackMetadata {
            title: Some("Recently Played".to_string()),
            ..Default::default()
        };
        let id = add_track(&conn, "/music/recent.mp3", &metadata).unwrap();
        update_play_count(&conn, id).unwrap();

        // Should find the recently played track
        let recent = get_recently_played(&conn, 7, 10).unwrap();
        assert_eq!(recent.len(), 1);
        assert_eq!(recent[0].title, Some("Recently Played".to_string()));
    }

    #[test]
    fn test_get_recently_played_respects_limit() {
        let conn = setup_test_db();

        // Add 5 tracks and play them
        for i in 1..=5 {
            let metadata = TrackMetadata {
                title: Some(format!("Track {}", i)),
                ..Default::default()
            };
            let id = add_track(&conn, &format!("/music/track{}.mp3", i), &metadata).unwrap();
            update_play_count(&conn, id).unwrap();
        }

        // Request only 3
        let recent = get_recently_played(&conn, 7, 3).unwrap();
        assert_eq!(recent.len(), 3);
    }

    #[test]
    fn test_get_recently_added_empty() {
        let conn = setup_test_db();

        // No tracks added
        let recent = get_recently_added(&conn, 7, 10).unwrap();
        assert!(recent.is_empty());
    }

    #[test]
    fn test_get_recently_added_with_tracks() {
        let conn = setup_test_db();

        // Add a track (added_date is set automatically)
        let metadata = TrackMetadata {
            title: Some("New Track".to_string()),
            ..Default::default()
        };
        add_track(&conn, "/music/new.mp3", &metadata).unwrap();

        // Should find the recently added track
        let recent = get_recently_added(&conn, 7, 10).unwrap();
        assert_eq!(recent.len(), 1);
        assert_eq!(recent[0].title, Some("New Track".to_string()));
    }

    #[test]
    fn test_get_recently_added_respects_limit() {
        let conn = setup_test_db();

        // Add 5 tracks
        for i in 1..=5 {
            let metadata = TrackMetadata {
                title: Some(format!("Track {}", i)),
                ..Default::default()
            };
            add_track(&conn, &format!("/music/track{}.mp3", i), &metadata).unwrap();
        }

        // Request only 2
        let recent = get_recently_added(&conn, 7, 2).unwrap();
        assert_eq!(recent.len(), 2);
    }

    #[test]
    fn test_remove_favorite_nonexistent() {
        let conn = setup_test_db();

        // Try to remove a favorite that doesn't exist
        let removed = remove_favorite(&conn, 999).unwrap();
        assert!(!removed);
    }

    #[test]
    fn test_is_favorite_nonexistent_track() {
        let conn = setup_test_db();

        // Check if nonexistent track is favorite
        let (is_fav, timestamp) = is_favorite(&conn, 999).unwrap();
        assert!(!is_fav);
        assert!(timestamp.is_none());
    }

    #[test]
    fn test_get_favorites_pagination() {
        let conn = setup_test_db();

        // Add 10 tracks and favorite them
        for i in 1..=10 {
            let metadata = TrackMetadata {
                title: Some(format!("Track {}", i)),
                ..Default::default()
            };
            let id = add_track(&conn, &format!("/music/track{}.mp3", i), &metadata).unwrap();
            add_favorite(&conn, id).unwrap();
        }

        // Get first page
        let page1 = get_favorites(&conn, 5, 0).unwrap();
        assert_eq!(page1.total, 10);
        assert_eq!(page1.items.len(), 5);

        // Get second page
        let page2 = get_favorites(&conn, 5, 5).unwrap();
        assert_eq!(page2.total, 10);
        assert_eq!(page2.items.len(), 5);

        // Different tracks on each page
        assert_ne!(page1.items[0].track.id, page2.items[0].track.id);
    }

    #[test]
    fn test_get_top_25_with_zero_plays() {
        let conn = setup_test_db();

        // Add tracks but don't play them
        for i in 1..=5 {
            let metadata = TrackMetadata {
                title: Some(format!("Track {}", i)),
                ..Default::default()
            };
            add_track(&conn, &format!("/music/track{}.mp3", i), &metadata).unwrap();
        }

        // Should return empty since no tracks have been played
        let top = get_top_25(&conn).unwrap();
        assert!(top.is_empty());
    }

    #[test]
    fn test_get_top_25_orders_by_play_count() {
        let conn = setup_test_db();

        // Add 3 tracks with different play counts
        let metadata1 = TrackMetadata {
            title: Some("Low Plays".to_string()),
            ..Default::default()
        };
        let id1 = add_track(&conn, "/music/low.mp3", &metadata1).unwrap();
        update_play_count(&conn, id1).unwrap(); // 1 play

        let metadata2 = TrackMetadata {
            title: Some("High Plays".to_string()),
            ..Default::default()
        };
        let id2 = add_track(&conn, "/music/high.mp3", &metadata2).unwrap();
        for _ in 0..10 {
            update_play_count(&conn, id2).unwrap(); // 10 plays
        }

        let metadata3 = TrackMetadata {
            title: Some("Medium Plays".to_string()),
            ..Default::default()
        };
        let id3 = add_track(&conn, "/music/medium.mp3", &metadata3).unwrap();
        for _ in 0..5 {
            update_play_count(&conn, id3).unwrap(); // 5 plays
        }

        let top = get_top_25(&conn).unwrap();
        assert_eq!(top.len(), 3);
        assert_eq!(top[0].title, Some("High Plays".to_string()));
        assert_eq!(top[1].title, Some("Medium Plays".to_string()));
        assert_eq!(top[2].title, Some("Low Plays".to_string()));
    }

    #[test]
    fn test_favorites_independent_of_lastfm_settings() {
        let conn = setup_test_db();

        // Set a fake Last.fm session key
        use crate::db::settings;
        settings::set_setting(&conn, "lastfm_session_key", &serde_json::json!("fake_key")).unwrap();

        // Favorites operations should work regardless
        let metadata = TrackMetadata {
            title: Some("Test".to_string()),
            artist: Some("Test Artist".to_string()),
            ..Default::default()
        };
        let id = add_track(&conn, "/music/test.mp3", &metadata).unwrap();

        let ts = add_favorite(&conn, id).unwrap();
        assert!(ts.is_some());

        let (is_fav, _) = is_favorite(&conn, id).unwrap();
        assert!(is_fav);

        let removed = remove_favorite(&conn, id).unwrap();
        assert!(removed);

        let (is_fav, _) = is_favorite(&conn, id).unwrap();
        assert!(!is_fav);
    }

    #[test]
    fn test_get_favorites_stats_empty() {
        let conn = setup_test_db();
        let (count, duration, size) = get_favorites_stats(&conn).unwrap();
        assert_eq!(count, 0);
        assert_eq!(duration, 0.0);
        assert_eq!(size, 0);
    }

    #[test]
    fn test_get_favorites_stats_with_tracks() {
        let conn = setup_test_db();
        for i in 1..=3 {
            let metadata = TrackMetadata {
                title: Some(format!("Track {}", i)),
                duration: Some(120.0 + i as f64),
                ..Default::default()
            };
            let id = add_track(&conn, &format!("/music/track{}.mp3", i), &metadata).unwrap();
            add_favorite(&conn, id).unwrap();
        }
        let (count, duration, _size) = get_favorites_stats(&conn).unwrap();
        assert_eq!(count, 3);
        assert_eq!(duration, 121.0 + 122.0 + 123.0);
    }

    #[test]
    fn test_get_top_25_stats() {
        let conn = setup_test_db();
        for i in 1..=3 {
            let metadata = TrackMetadata {
                title: Some(format!("Track {}", i)),
                duration: Some(100.0 * i as f64),
                ..Default::default()
            };
            let id = add_track(&conn, &format!("/music/track{}.mp3", i), &metadata).unwrap();
            update_play_count(&conn, id).unwrap();
        }
        let (count, duration, _size) = get_top_25_stats(&conn).unwrap();
        assert_eq!(count, 3);
        assert_eq!(duration, 100.0 + 200.0 + 300.0);
    }

    #[test]
    fn test_get_recently_played_stats() {
        let conn = setup_test_db();
        let metadata = TrackMetadata {
            title: Some("Played".to_string()),
            duration: Some(200.0),
            ..Default::default()
        };
        let id = add_track(&conn, "/music/played.mp3", &metadata).unwrap();
        update_play_count(&conn, id).unwrap();

        let (count, duration, _size) = get_recently_played_stats(&conn, 7, 100).unwrap();
        assert_eq!(count, 1);
        assert_eq!(duration, 200.0);
    }

    #[test]
    fn test_get_recently_added_stats() {
        let conn = setup_test_db();
        let metadata = TrackMetadata {
            title: Some("New".to_string()),
            duration: Some(150.0),
            ..Default::default()
        };
        add_track(&conn, "/music/new.mp3", &metadata).unwrap();

        let (count, duration, _size) = get_recently_added_stats(&conn, 7, 100).unwrap();
        assert_eq!(count, 1);
        assert_eq!(duration, 150.0);
    }

    #[test]
    fn test_favorite_track_without_metadata() {
        let conn = setup_test_db();

        // Track with no artist/title
        let metadata = TrackMetadata::default();
        let id = add_track(&conn, "/music/unknown.mp3", &metadata).unwrap();

        let ts = add_favorite(&conn, id).unwrap();
        assert!(ts.is_some());

        let (is_fav, _) = is_favorite(&conn, id).unwrap();
        assert!(is_fav);
    }
}
