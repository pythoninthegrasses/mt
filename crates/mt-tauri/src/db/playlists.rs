//! Playlist database operations.
//!
//! Operations for playlists and playlist items.

use rusqlite::{params, Connection};

use crate::db::{DbResult, Playlist, PlaylistTrack, PlaylistWithTracks, Track};

/// Get all playlists with track counts
pub fn get_playlists(conn: &Connection) -> DbResult<Vec<Playlist>> {
    let mut stmt = conn.prepare(
        "SELECT p.id, p.name, p.position, p.created_at,
                COUNT(pi.id) as track_count
         FROM playlists p
         LEFT JOIN playlist_items pi ON p.id = pi.playlist_id
         GROUP BY p.id
         ORDER BY p.position ASC, p.created_at ASC",
    )?;

    let playlists: Vec<Playlist> = stmt
        .query_map([], |row| {
            Ok(Playlist {
                id: row.get("id")?,
                name: row.get("name")?,
                position: row.get::<_, Option<i64>>("position")?.unwrap_or(0),
                created_at: row.get("created_at")?,
                track_count: row.get("track_count")?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();

    Ok(playlists)
}

/// Create a new playlist
pub fn create_playlist(conn: &Connection, name: &str) -> DbResult<Option<Playlist>> {
    match conn.execute("INSERT INTO playlists (name) VALUES (?)", [name]) {
        Ok(_) => {
            let id = conn.last_insert_rowid();

            let mut stmt = conn.prepare("SELECT * FROM playlists WHERE id = ?")?;
            let playlist = stmt
                .query_row([id], |row| {
                    Ok(Playlist {
                        id: row.get("id")?,
                        name: row.get("name")?,
                        position: row.get::<_, Option<i64>>("position")?.unwrap_or(0),
                        created_at: row.get("created_at")?,
                        track_count: 0,
                    })
                })
                .ok();

            Ok(playlist)
        }
        Err(rusqlite::Error::SqliteFailure(err, _))
            if err.code == rusqlite::ErrorCode::ConstraintViolation =>
        {
            Ok(None) // Name already exists
        }
        Err(e) => Err(e.into()),
    }
}

/// Get a playlist with its tracks
pub fn get_playlist(conn: &Connection, playlist_id: i64) -> DbResult<Option<PlaylistWithTracks>> {
    // Get playlist metadata
    let playlist = match conn.query_row(
        "SELECT * FROM playlists WHERE id = ?",
        [playlist_id],
        |row| {
            Ok(Playlist {
                id: row.get("id")?,
                name: row.get("name")?,
                position: row.get::<_, Option<i64>>("position")?.unwrap_or(0),
                created_at: row.get("created_at")?,
                track_count: 0,
            })
        },
    ) {
        Ok(p) => p,
        Err(rusqlite::Error::QueryReturnedNoRows) => return Ok(None),
        Err(e) => return Err(e.into()),
    };

    // Get tracks
    let mut stmt = conn.prepare(
        "SELECT l.id, l.filepath, l.title, l.artist, l.album, l.album_artist,
                l.track_number, l.track_total, l.date, l.duration, l.file_size,
                l.play_count, l.last_played, l.added_date, l.missing, l.last_seen_at,
                l.file_mtime_ns, l.file_inode, l.content_hash, pi.position, pi.added_at
         FROM playlist_items pi
         JOIN library l ON pi.track_id = l.id
         WHERE pi.playlist_id = ?
         ORDER BY pi.position ASC",
    )?;

    let tracks: Vec<PlaylistTrack> = stmt
        .query_map([playlist_id], |row| {
            Ok(PlaylistTrack {
                position: row.get("position")?,
                added_date: row.get("added_at")?,
                track: Track {
                    id: row.get("id")?,
                    filepath: row.get("filepath")?,
                    title: row.get("title")?,
                    artist: row.get("artist")?,
                    album: row.get("album")?,
                    album_artist: row.get("album_artist")?,
                    track_number: row.get("track_number")?,
                    track_total: row.get("track_total")?,
                    date: row.get("date")?,
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
                },
            })
        })?
        .filter_map(|r| r.ok())
        .collect();

    Ok(Some(PlaylistWithTracks {
        id: playlist.id,
        name: playlist.name,
        position: playlist.position,
        created_at: playlist.created_at,
        track_count: tracks.len() as i64,
        tracks,
    }))
}

/// Update playlist metadata
pub fn update_playlist(
    conn: &Connection,
    playlist_id: i64,
    name: Option<&str>,
) -> DbResult<Option<Playlist>> {
    if let Some(new_name) = name {
        match conn.execute(
            "UPDATE playlists SET name = ? WHERE id = ?",
            params![new_name, playlist_id],
        ) {
            Ok(_) => {}
            Err(rusqlite::Error::SqliteFailure(err, _))
                if err.code == rusqlite::ErrorCode::ConstraintViolation =>
            {
                return Ok(None); // Name conflict
            }
            Err(e) => return Err(e.into()),
        }
    }

    let track_count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM playlist_items WHERE playlist_id = ?",
        [playlist_id],
        |row| row.get(0),
    )?;

    match conn.query_row(
        "SELECT * FROM playlists WHERE id = ?",
        [playlist_id],
        |row| {
            Ok(Playlist {
                id: row.get("id")?,
                name: row.get("name")?,
                position: row.get::<_, Option<i64>>("position")?.unwrap_or(0),
                created_at: row.get("created_at")?,
                track_count,
            })
        },
    ) {
        Ok(p) => Ok(Some(p)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

/// Delete a playlist
pub fn delete_playlist(conn: &Connection, playlist_id: i64) -> DbResult<bool> {
    let deleted = conn.execute("DELETE FROM playlists WHERE id = ?", [playlist_id])?;
    Ok(deleted > 0)
}

/// Add tracks to a playlist
pub fn add_tracks_to_playlist(
    conn: &Connection,
    playlist_id: i64,
    track_ids: &[i64],
    _position: Option<i64>,
) -> DbResult<i64> {
    // Get current max position
    let max_position: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(position), -1) FROM playlist_items WHERE playlist_id = ?",
            [playlist_id],
            |row| row.get(0),
        )
        .unwrap_or(-1);

    let mut current_pos = max_position;
    let mut added = 0;

    for track_id in track_ids {
        current_pos += 1;
        match conn.execute(
            "INSERT INTO playlist_items (playlist_id, track_id, position) VALUES (?, ?, ?)",
            params![playlist_id, track_id, current_pos],
        ) {
            Ok(_) => added += 1,
            Err(rusqlite::Error::SqliteFailure(err, _))
                if err.code == rusqlite::ErrorCode::ConstraintViolation =>
            {
                current_pos -= 1; // Duplicate, skip
            }
            Err(e) => return Err(e.into()),
        }
    }

    Ok(added)
}

/// Remove a track from a playlist by position
pub fn remove_track_from_playlist(
    conn: &Connection,
    playlist_id: i64,
    position: i64,
) -> DbResult<bool> {
    // Get item at position
    let item_id: Option<i64> = conn
        .query_row(
            "SELECT id FROM playlist_items WHERE playlist_id = ? AND position = ?",
            params![playlist_id, position],
            |row| row.get(0),
        )
        .ok();

    let Some(id) = item_id else {
        return Ok(false);
    };

    conn.execute("DELETE FROM playlist_items WHERE id = ?", [id])?;

    // Reindex positions
    let mut stmt =
        conn.prepare("SELECT id FROM playlist_items WHERE playlist_id = ? ORDER BY position")?;
    let items: Vec<i64> = stmt
        .query_map([playlist_id], |row| row.get(0))?
        .filter_map(|r| r.ok())
        .collect();

    for (new_pos, item_id) in items.iter().enumerate() {
        conn.execute(
            "UPDATE playlist_items SET position = ? WHERE id = ?",
            params![new_pos as i64, item_id],
        )?;
    }

    Ok(true)
}

/// Reorder tracks within a playlist
pub fn reorder_playlist(
    conn: &Connection,
    playlist_id: i64,
    from_position: i64,
    to_position: i64,
) -> DbResult<bool> {
    let mut stmt = conn.prepare(
        "SELECT id, track_id FROM playlist_items WHERE playlist_id = ? ORDER BY position",
    )?;
    let items: Vec<i64> = stmt
        .query_map([playlist_id], |row| row.get::<_, i64>(0))?
        .filter_map(|r| r.ok())
        .collect();

    let from = from_position as usize;
    let to = to_position as usize;

    if from >= items.len() || to >= items.len() {
        return Ok(false);
    }

    // Reorder
    let mut item_ids = items;
    let moved = item_ids.remove(from);
    item_ids.insert(to, moved);

    // Update positions
    for (pos, item_id) in item_ids.iter().enumerate() {
        conn.execute(
            "UPDATE playlist_items SET position = ? WHERE id = ?",
            params![pos as i64, item_id],
        )?;
    }

    Ok(true)
}

/// Get the number of tracks in a playlist
pub fn get_playlist_track_count(conn: &Connection, playlist_id: i64) -> DbResult<i64> {
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM playlist_items WHERE playlist_id = ?",
        [playlist_id],
        |row| row.get(0),
    )?;
    Ok(count)
}

/// Reorder playlists in the sidebar
pub fn reorder_playlists(
    conn: &Connection,
    from_position: i64,
    to_position: i64,
) -> DbResult<bool> {
    let mut stmt =
        conn.prepare("SELECT id FROM playlists ORDER BY position ASC, created_at ASC")?;
    let items: Vec<i64> = stmt
        .query_map([], |row| row.get(0))?
        .filter_map(|r| r.ok())
        .collect();

    let from = from_position as usize;
    let to = to_position as usize;

    if from >= items.len() || to >= items.len() {
        return Ok(false);
    }

    let mut playlist_ids = items;
    let moved = playlist_ids.remove(from);
    playlist_ids.insert(to, moved);

    for (pos, playlist_id) in playlist_ids.iter().enumerate() {
        conn.execute(
            "UPDATE playlists SET position = ? WHERE id = ?",
            params![pos as i64, playlist_id],
        )?;
    }

    Ok(true)
}

/// Generate a unique playlist name
pub fn generate_unique_playlist_name(conn: &Connection, base: &str) -> DbResult<String> {
    let exists: bool = conn
        .query_row(
            "SELECT COUNT(*) > 0 FROM playlists WHERE name = ?",
            [base],
            |row| row.get(0),
        )
        .unwrap_or(false);

    if !exists {
        return Ok(base.to_string());
    }

    let mut suffix = 2;
    loop {
        let candidate = format!("{} ({})", base, suffix);
        let exists: bool = conn
            .query_row(
                "SELECT COUNT(*) > 0 FROM playlists WHERE name = ?",
                [&candidate],
                |row| row.get(0),
            )
            .unwrap_or(false);

        if !exists {
            return Ok(candidate);
        }
        suffix += 1;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{
        library::add_track,
        schema::{create_tables, run_migrations},
        TrackMetadata,
    };

    fn setup_test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        create_tables(&conn).unwrap();
        run_migrations(&conn).unwrap();
        conn
    }

    fn add_test_tracks(conn: &Connection, count: i32) -> Vec<i64> {
        (1..=count)
            .map(|i| {
                let metadata = TrackMetadata {
                    title: Some(format!("Track {}", i)),
                    ..Default::default()
                };
                add_track(conn, &format!("/music/track{}.mp3", i), &metadata).unwrap()
            })
            .collect()
    }

    #[test]
    fn test_create_and_get_playlist() {
        let conn = setup_test_db();

        let playlist = create_playlist(&conn, "My Playlist").unwrap().unwrap();
        assert_eq!(playlist.name, "My Playlist");
        assert_eq!(playlist.track_count, 0);

        let playlists = get_playlists(&conn).unwrap();
        assert_eq!(playlists.len(), 1);
    }

    #[test]
    fn test_add_tracks_to_playlist() {
        let conn = setup_test_db();
        let track_ids = add_test_tracks(&conn, 5);

        let playlist = create_playlist(&conn, "Test Playlist").unwrap().unwrap();
        let added = add_tracks_to_playlist(&conn, playlist.id, &track_ids, None).unwrap();
        assert_eq!(added, 5);

        let playlist = get_playlist(&conn, playlist.id).unwrap().unwrap();
        assert_eq!(playlist.track_count, 5);
        assert_eq!(playlist.tracks.len(), 5);
    }

    #[test]
    fn test_remove_track_from_playlist() {
        let conn = setup_test_db();
        let track_ids = add_test_tracks(&conn, 3);

        let playlist = create_playlist(&conn, "Test").unwrap().unwrap();
        add_tracks_to_playlist(&conn, playlist.id, &track_ids, None).unwrap();

        let removed = remove_track_from_playlist(&conn, playlist.id, 1).unwrap();
        assert!(removed);

        let playlist = get_playlist(&conn, playlist.id).unwrap().unwrap();
        assert_eq!(playlist.track_count, 2);

        // Verify positions are reindexed
        assert_eq!(playlist.tracks[0].position, 0);
        assert_eq!(playlist.tracks[1].position, 1);
    }

    #[test]
    fn test_reorder_playlist() {
        let conn = setup_test_db();
        let track_ids = add_test_tracks(&conn, 3);

        let playlist = create_playlist(&conn, "Test").unwrap().unwrap();
        add_tracks_to_playlist(&conn, playlist.id, &track_ids, None).unwrap();

        // Move track from position 2 to position 0
        let success = reorder_playlist(&conn, playlist.id, 2, 0).unwrap();
        assert!(success);

        let playlist = get_playlist(&conn, playlist.id).unwrap().unwrap();
        assert_eq!(playlist.tracks[0].track.title, Some("Track 3".to_string()));
    }

    #[test]
    fn test_generate_unique_name() {
        let conn = setup_test_db();

        create_playlist(&conn, "New playlist").unwrap();
        create_playlist(&conn, "New playlist (2)").unwrap();

        let name = generate_unique_playlist_name(&conn, "New playlist").unwrap();
        assert_eq!(name, "New playlist (3)");

        let name = generate_unique_playlist_name(&conn, "Unique name").unwrap();
        assert_eq!(name, "Unique name");
    }

    #[test]
    fn test_delete_playlist() {
        let conn = setup_test_db();

        let playlist = create_playlist(&conn, "To Delete").unwrap().unwrap();
        let deleted = delete_playlist(&conn, playlist.id).unwrap();
        assert!(deleted);

        let playlists = get_playlists(&conn).unwrap();
        assert!(playlists.is_empty());
    }

    #[test]
    fn test_create_playlist_duplicate_name() {
        let conn = setup_test_db();

        // Create first playlist
        let playlist = create_playlist(&conn, "Duplicate").unwrap();
        assert!(playlist.is_some());

        // Try to create with same name - should return None
        let duplicate = create_playlist(&conn, "Duplicate").unwrap();
        assert!(duplicate.is_none());
    }

    #[test]
    fn test_get_playlist_nonexistent() {
        let conn = setup_test_db();

        let result = get_playlist(&conn, 999).unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn test_update_playlist_name() {
        let conn = setup_test_db();

        let playlist = create_playlist(&conn, "Original").unwrap().unwrap();
        let updated = update_playlist(&conn, playlist.id, Some("Renamed")).unwrap();

        assert!(updated.is_some());
        assert_eq!(updated.unwrap().name, "Renamed");
    }

    #[test]
    fn test_update_playlist_name_conflict() {
        let conn = setup_test_db();

        create_playlist(&conn, "Existing").unwrap();
        let playlist = create_playlist(&conn, "Original").unwrap().unwrap();

        // Try to rename to existing name - should return None
        let updated = update_playlist(&conn, playlist.id, Some("Existing")).unwrap();
        assert!(updated.is_none());
    }

    #[test]
    fn test_update_playlist_nonexistent() {
        let conn = setup_test_db();

        let result = update_playlist(&conn, 999, Some("New Name")).unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn test_update_playlist_no_changes() {
        let conn = setup_test_db();

        let playlist = create_playlist(&conn, "Unchanged").unwrap().unwrap();

        // Update with None (no changes)
        let updated = update_playlist(&conn, playlist.id, None).unwrap();
        assert!(updated.is_some());
        assert_eq!(updated.unwrap().name, "Unchanged");
    }

    #[test]
    fn test_add_duplicate_track_to_playlist() {
        let conn = setup_test_db();
        let track_ids = add_test_tracks(&conn, 2);

        let playlist = create_playlist(&conn, "Test").unwrap().unwrap();

        // Add tracks
        let added1 = add_tracks_to_playlist(&conn, playlist.id, &track_ids, None).unwrap();
        assert_eq!(added1, 2);

        // Try to add same tracks again - should skip duplicates
        let added2 = add_tracks_to_playlist(&conn, playlist.id, &track_ids, None).unwrap();
        assert_eq!(added2, 0);

        let playlist = get_playlist(&conn, playlist.id).unwrap().unwrap();
        assert_eq!(playlist.track_count, 2); // Still only 2
    }

    #[test]
    fn test_remove_track_invalid_position() {
        let conn = setup_test_db();
        let track_ids = add_test_tracks(&conn, 2);

        let playlist = create_playlist(&conn, "Test").unwrap().unwrap();
        add_tracks_to_playlist(&conn, playlist.id, &track_ids, None).unwrap();

        // Try to remove from invalid position
        let removed = remove_track_from_playlist(&conn, playlist.id, 999).unwrap();
        assert!(!removed);
    }

    #[test]
    fn test_reorder_playlist_invalid_from() {
        let conn = setup_test_db();
        let track_ids = add_test_tracks(&conn, 3);

        let playlist = create_playlist(&conn, "Test").unwrap().unwrap();
        add_tracks_to_playlist(&conn, playlist.id, &track_ids, None).unwrap();

        // Invalid from position
        let success = reorder_playlist(&conn, playlist.id, 999, 0).unwrap();
        assert!(!success);
    }

    #[test]
    fn test_reorder_playlist_invalid_to() {
        let conn = setup_test_db();
        let track_ids = add_test_tracks(&conn, 3);

        let playlist = create_playlist(&conn, "Test").unwrap().unwrap();
        add_tracks_to_playlist(&conn, playlist.id, &track_ids, None).unwrap();

        // Invalid to position
        let success = reorder_playlist(&conn, playlist.id, 0, 999).unwrap();
        assert!(!success);
    }

    #[test]
    fn test_reorder_playlists() {
        let conn = setup_test_db();

        // Create 3 playlists
        create_playlist(&conn, "First").unwrap();
        create_playlist(&conn, "Second").unwrap();
        create_playlist(&conn, "Third").unwrap();

        // Move first to last position
        let success = reorder_playlists(&conn, 0, 2).unwrap();
        assert!(success);

        let playlists = get_playlists(&conn).unwrap();
        assert_eq!(playlists[0].name, "Second");
        assert_eq!(playlists[1].name, "Third");
        assert_eq!(playlists[2].name, "First");
    }

    #[test]
    fn test_reorder_playlists_invalid_positions() {
        let conn = setup_test_db();

        create_playlist(&conn, "Only").unwrap();

        // Invalid from position
        let success = reorder_playlists(&conn, 999, 0).unwrap();
        assert!(!success);

        // Invalid to position
        let success = reorder_playlists(&conn, 0, 999).unwrap();
        assert!(!success);
    }

    #[test]
    fn test_get_playlist_track_count() {
        let conn = setup_test_db();
        let track_ids = add_test_tracks(&conn, 5);

        let playlist = create_playlist(&conn, "Test").unwrap().unwrap();
        add_tracks_to_playlist(&conn, playlist.id, &track_ids, None).unwrap();

        let count = get_playlist_track_count(&conn, playlist.id).unwrap();
        assert_eq!(count, 5);
    }

    #[test]
    fn test_get_playlist_track_count_empty() {
        let conn = setup_test_db();

        let playlist = create_playlist(&conn, "Empty").unwrap().unwrap();
        let count = get_playlist_track_count(&conn, playlist.id).unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn test_delete_playlist_nonexistent() {
        let conn = setup_test_db();

        let deleted = delete_playlist(&conn, 999).unwrap();
        assert!(!deleted);
    }

    #[test]
    fn test_playlist_with_tracks_returns_track_data() {
        let conn = setup_test_db();

        // Add a track with specific metadata
        let metadata = TrackMetadata {
            title: Some("Specific Track".to_string()),
            artist: Some("Test Artist".to_string()),
            album: Some("Test Album".to_string()),
            ..Default::default()
        };
        let track_id = add_track(&conn, "/music/specific.mp3", &metadata).unwrap();

        let playlist = create_playlist(&conn, "Test").unwrap().unwrap();
        add_tracks_to_playlist(&conn, playlist.id, &[track_id], None).unwrap();

        let playlist = get_playlist(&conn, playlist.id).unwrap().unwrap();
        assert_eq!(playlist.tracks.len(), 1);
        assert_eq!(playlist.tracks[0].track.title, Some("Specific Track".to_string()));
        assert_eq!(playlist.tracks[0].track.artist, Some("Test Artist".to_string()));
        assert_eq!(playlist.tracks[0].position, 0);
    }
}
