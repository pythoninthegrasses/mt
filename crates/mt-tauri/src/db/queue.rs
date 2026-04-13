//! Queue database operations.
//!
//! Operations for the playback queue.

use rusqlite::{Connection, params};

use crate::db::{DbError, DbResult, QueueItem, QueueState, Track, library::get_track_by_filepath};

/// Get all items in the queue with track metadata
pub(crate) fn get_queue(conn: &Connection) -> DbResult<Vec<QueueItem>> {
    let mut stmt = conn.prepare(
        "SELECT q.id as queue_id, q.filepath,
                l.id, l.title, l.artist, l.album, l.album_artist,
                l.track_number, l.track_total, l.disc_number, l.disc_total,
                l.date, l.genre, l.duration, l.file_size,
                l.play_count, l.last_played, l.added_date, l.missing, l.last_seen_at,
                l.file_mtime_ns, l.file_ctime_ns, l.file_inode, l.content_hash
         FROM queue q
         LEFT JOIN library l ON q.filepath = l.filepath
         ORDER BY q.id",
    )?;

    let mut items = Vec::new();
    let mut rows = stmt.query([])?;
    let mut position = 0;

    while let Some(row) = rows.next()? {
        let filepath: String = row.get("filepath")?;
        let track = Track {
            id: row.get::<_, Option<i64>>("id")?.unwrap_or(0),
            filepath: filepath.clone(),
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
            file_ctime_ns: row.get("file_ctime_ns").unwrap_or(None),
            file_inode: row.get("file_inode")?,
            content_hash: row.get("content_hash")?,
            added_date: row.get("added_date")?,
            last_played: row.get("last_played")?,
            play_count: row.get::<_, Option<i64>>("play_count")?.unwrap_or(0),
            missing: row.get::<_, Option<i64>>("missing")?.unwrap_or(0) != 0,
            last_seen_at: row.get("last_seen_at")?,
        };

        items.push(QueueItem { position, track });
        position += 1;
    }

    Ok(items)
}

/// Add tracks to the queue by track IDs
pub(crate) fn add_to_queue(
    conn: &Connection,
    track_ids: &[i64],
    position: Option<i64>,
) -> DbResult<i64> {
    // Get filepaths for track IDs
    let placeholders = track_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let sql = format!(
        "SELECT id, filepath FROM library WHERE id IN ({})",
        placeholders
    );

    let mut stmt = conn.prepare(&sql)?;
    let params: Vec<&dyn rusqlite::ToSql> = track_ids
        .iter()
        .map(|id| id as &dyn rusqlite::ToSql)
        .collect();

    let tracks: Vec<(i64, String)> = stmt
        .query_map(params.as_slice(), |row| Ok((row.get(0)?, row.get(1)?)))?
        .filter_map(|r| r.ok())
        .collect();

    let track_map: std::collections::HashMap<i64, String> = tracks.into_iter().collect();

    let tx = conn.unchecked_transaction()?;

    if let Some(pos) = position {
        // Get current queue
        let mut stmt = tx.prepare("SELECT id, filepath FROM queue ORDER BY id")?;
        let current_queue: Vec<(i64, String)> = stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
            .filter_map(|r| r.ok())
            .collect();
        drop(stmt);

        // Clear and rebuild queue
        tx.execute("DELETE FROM queue", [])?;

        let pos = pos as usize;

        // Insert items before position
        for (_, filepath) in current_queue.iter().take(pos) {
            tx.execute("INSERT INTO queue (filepath) VALUES (?)", [filepath])?;
        }

        // Insert new items
        for track_id in track_ids {
            if let Some(filepath) = track_map.get(track_id) {
                tx.execute("INSERT INTO queue (filepath) VALUES (?)", [filepath])?;
            }
        }

        // Insert items after position
        for (_, filepath) in current_queue.iter().skip(pos) {
            tx.execute("INSERT INTO queue (filepath) VALUES (?)", [filepath])?;
        }
    } else {
        // Append to end
        for track_id in track_ids {
            if let Some(filepath) = track_map.get(track_id) {
                tx.execute("INSERT INTO queue (filepath) VALUES (?)", [filepath])?;
            }
        }
    }

    tx.commit()?;

    Ok(track_ids
        .iter()
        .filter(|id| track_map.contains_key(id))
        .count() as i64)
}

/// Add files directly to the queue
pub(crate) fn add_files_to_queue(
    conn: &Connection,
    filepaths: &[String],
    position: Option<i64>,
) -> DbResult<(i64, Vec<Track>)> {
    let mut added_tracks = Vec::new();

    for filepath in filepaths {
        // Check if file exists in library
        if let Some(track) = get_track_by_filepath(conn, filepath)? {
            added_tracks.push(track);
        } else {
            // Add to library with minimal metadata
            let filename = std::path::Path::new(filepath)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("Unknown");
            let title = std::path::Path::new(filename)
                .file_stem()
                .and_then(|n| n.to_str())
                .unwrap_or(filename);

            conn.execute(
                "INSERT INTO library (filepath, title) VALUES (?, ?)",
                params![filepath, title],
            )?;

            if let Some(track) = get_track_by_filepath(conn, filepath)? {
                added_tracks.push(track);
            }
        }
    }

    // Add to queue
    if let Some(pos) = position {
        let mut stmt = conn.prepare("SELECT id, filepath FROM queue ORDER BY id")?;
        let current_queue: Vec<(i64, String)> = stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
            .filter_map(|r| r.ok())
            .collect();

        conn.execute("DELETE FROM queue", [])?;

        let pos = pos as usize;

        for (_, filepath) in current_queue.iter().take(pos) {
            conn.execute("INSERT INTO queue (filepath) VALUES (?)", [filepath])?;
        }

        for track in &added_tracks {
            conn.execute("INSERT INTO queue (filepath) VALUES (?)", [&track.filepath])?;
        }

        for (_, filepath) in current_queue.iter().skip(pos) {
            conn.execute("INSERT INTO queue (filepath) VALUES (?)", [filepath])?;
        }
    } else {
        for track in &added_tracks {
            conn.execute("INSERT INTO queue (filepath) VALUES (?)", [&track.filepath])?;
        }
    }

    Ok((added_tracks.len() as i64, added_tracks))
}

/// Remove a track from the queue by position
pub(crate) fn remove_from_queue(conn: &Connection, position: i64) -> DbResult<bool> {
    let mut stmt = conn.prepare("SELECT id FROM queue ORDER BY id")?;
    let items: Vec<i64> = stmt
        .query_map([], |row| row.get(0))?
        .filter_map(|r| r.ok())
        .collect();

    if position < 0 || position as usize >= items.len() {
        return Ok(false);
    }

    let queue_id = items[position as usize];
    let deleted = conn.execute("DELETE FROM queue WHERE id = ?", [queue_id])?;
    Ok(deleted > 0)
}

/// Clear the entire queue
pub(crate) fn clear_queue(conn: &Connection) -> DbResult<()> {
    conn.execute("DELETE FROM queue", [])?;
    Ok(())
}

/// Reorder tracks in the queue
pub(crate) fn reorder_queue(
    conn: &Connection,
    from_position: i64,
    to_position: i64,
) -> DbResult<bool> {
    let mut stmt = conn.prepare("SELECT id, filepath FROM queue ORDER BY id")?;
    let items: Vec<(i64, String)> = stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
        .filter_map(|r| r.ok())
        .collect();

    let from = from_position as usize;
    let to = to_position as usize;

    if from >= items.len() || to >= items.len() {
        return Ok(false);
    }

    // Reorder in memory
    let mut filepaths: Vec<String> = items.into_iter().map(|(_, fp)| fp).collect();
    let item = filepaths.remove(from);
    filepaths.insert(to, item);

    // Rebuild queue
    conn.execute("DELETE FROM queue", [])?;
    for filepath in filepaths {
        conn.execute("INSERT INTO queue (filepath) VALUES (?)", [filepath])?;
    }

    Ok(true)
}

/// Get the number of items in the queue
pub(crate) fn get_queue_length(conn: &Connection) -> DbResult<i64> {
    let count: i64 = conn.query_row("SELECT COUNT(*) FROM queue", [], |row| row.get(0))?;
    Ok(count)
}

/// Get queue playback state
pub(crate) fn get_queue_state(conn: &Connection) -> DbResult<QueueState> {
    let result = conn.query_row(
        "SELECT current_index, shuffle_enabled, loop_mode, original_order_json
         FROM queue_state WHERE id = 1",
        [],
        |row| {
            Ok(QueueState {
                current_index: row.get(0)?,
                shuffle_enabled: row.get::<_, i64>(1)? != 0,
                loop_mode: row.get(2)?,
                original_order_json: row.get(3)?,
            })
        },
    );

    match result {
        Ok(state) => Ok(state),
        Err(rusqlite::Error::QueryReturnedNoRows) => {
            // Initialize default state if not exists
            let default_state = QueueState {
                current_index: -1,
                shuffle_enabled: false,
                loop_mode: "none".to_string(),
                original_order_json: None,
            };
            set_queue_state(conn, &default_state)?;
            Ok(default_state)
        }
        Err(e) => Err(e.into()),
    }
}

/// Set queue playback state
pub(crate) fn set_queue_state(conn: &Connection, state: &QueueState) -> DbResult<()> {
    conn.execute(
        "INSERT OR REPLACE INTO queue_state (id, current_index, shuffle_enabled, loop_mode, original_order_json)
         VALUES (1, ?, ?, ?, ?)",
        params![
            state.current_index,
            if state.shuffle_enabled { 1 } else { 0 },
            &state.loop_mode,
            &state.original_order_json
        ],
    )?;
    Ok(())
}

/// Update current index in queue state
pub(crate) fn set_current_index(conn: &Connection, index: i64) -> DbResult<()> {
    // Ensure state exists
    let _ = get_queue_state(conn)?;

    conn.execute(
        "UPDATE queue_state SET current_index = ? WHERE id = 1",
        params![index],
    )?;
    Ok(())
}

/// Update shuffle enabled in queue state
pub(crate) fn set_shuffle_enabled(conn: &Connection, enabled: bool) -> DbResult<()> {
    // Ensure state exists
    let _ = get_queue_state(conn)?;

    conn.execute(
        "UPDATE queue_state SET shuffle_enabled = ? WHERE id = 1",
        params![if enabled { 1 } else { 0 }],
    )?;
    Ok(())
}

/// Update loop mode in queue state
pub(crate) fn set_loop_mode(conn: &Connection, mode: &str) -> DbResult<()> {
    // Ensure state exists
    let _ = get_queue_state(conn)?;

    conn.execute(
        "UPDATE queue_state SET loop_mode = ? WHERE id = 1",
        params![mode],
    )?;
    Ok(())
}

/// Update original order JSON in queue state
#[allow(dead_code)]
pub(crate) fn set_original_order_json(conn: &Connection, json: Option<String>) -> DbResult<()> {
    // Ensure state exists
    let _ = get_queue_state(conn)?;

    conn.execute(
        "UPDATE queue_state SET original_order_json = ? WHERE id = 1",
        params![json],
    )?;
    Ok(())
}

/// Result of a play-context operation: the installed queue and the track to play.
#[cfg_attr(not(test), allow(dead_code))]
pub(crate) struct PlayContextResult {
    pub items: Vec<QueueItem>,
    pub current_track: Track,
    pub shuffle_enabled: bool,
    pub original_order_json: Option<String>,
}

/// Atomically replace the queue with a new play context.
///
/// Clears the queue, resolves track IDs to filepaths, orders them
/// (rotated for sequential, Fisher-Yates shuffled for shuffle), inserts
/// all tracks, and updates queue state — all in a single transaction.
///
/// Returns the installed queue items and the track at index 0 (to play).
pub(crate) fn play_context(
    conn: &Connection,
    track_ids: &[i64],
    start_index: i64,
    shuffle: bool,
) -> DbResult<PlayContextResult> {
    use rand::rng;
    use rand::seq::SliceRandom;

    if track_ids.is_empty() {
        return Err(DbError::NotFound("Empty track list".to_string()));
    }

    let len = track_ids.len() as i64;
    if start_index < 0 || start_index >= len {
        return Err(DbError::NotFound(format!(
            "start_index {} out of bounds for {} tracks",
            start_index, len
        )));
    }

    let tx = conn.unchecked_transaction()?;

    // Clear existing queue
    tx.execute("DELETE FROM queue", [])?;

    // Look up filepaths preserving input order
    let placeholders = track_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let sql = format!(
        "SELECT id, filepath FROM library WHERE id IN ({})",
        placeholders
    );
    let mut stmt = tx.prepare(&sql)?;
    let params_vec: Vec<&dyn rusqlite::ToSql> = track_ids
        .iter()
        .map(|id| id as &dyn rusqlite::ToSql)
        .collect();
    let track_map: std::collections::HashMap<i64, String> = stmt
        .query_map(params_vec.as_slice(), |row| Ok((row.get(0)?, row.get(1)?)))?
        .filter_map(|r| r.ok())
        .collect();
    drop(stmt);

    // Build ordered filepath list, skipping IDs not found in library
    let resolved: Vec<(i64, String)> = track_ids
        .iter()
        .filter_map(|id| track_map.get(id).map(|fp| (*id, fp.clone())))
        .collect();

    if resolved.is_empty() {
        tx.rollback().ok();
        return Err(DbError::NotFound(
            "No valid tracks found for given IDs".to_string(),
        ));
    }

    // Adjust start_index if some tracks were filtered out
    // Find the position of the original start track in the resolved list
    let start_track_id = track_ids[start_index as usize];
    let start_pos = resolved
        .iter()
        .position(|(id, _)| *id == start_track_id)
        .ok_or_else(|| {
            DbError::NotFound(format!(
                "Start track {} not found in library",
                start_track_id
            ))
        })?;

    // Build the final ordered list
    let mut ordered: Vec<(i64, String)>;
    let original_order_json: Option<String>;

    if shuffle {
        // Save original order for unshuffle
        let original_ids: Vec<i64> = resolved.iter().map(|(id, _)| *id).collect();
        original_order_json = Some(serde_json::to_string(&original_ids).unwrap_or_default());

        // Start track at index 0, shuffle the rest
        let start_item = resolved[start_pos].clone();
        let mut rest: Vec<(i64, String)> = resolved
            .iter()
            .enumerate()
            .filter(|(i, _)| *i != start_pos)
            .map(|(_, item)| item.clone())
            .collect();
        rest.shuffle(&mut rng());
        ordered = Vec::with_capacity(resolved.len());
        ordered.push(start_item);
        ordered.extend(rest);
    } else {
        original_order_json = None;

        // Rotate so start track is at index 0: [subsequent..., preceding...]
        let mut rotated = Vec::with_capacity(resolved.len());
        rotated.extend_from_slice(&resolved[start_pos..]);
        rotated.extend_from_slice(&resolved[..start_pos]);
        ordered = rotated;
    }

    // Insert all tracks into queue
    for (_, filepath) in &ordered {
        tx.execute("INSERT INTO queue (filepath) VALUES (?)", params![filepath])?;
    }

    // Update queue state
    let current_state = get_queue_state(&tx)?;
    let new_state = QueueState {
        current_index: 0,
        shuffle_enabled: shuffle,
        loop_mode: current_state.loop_mode,
        original_order_json: original_order_json.clone(),
    };
    set_queue_state(&tx, &new_state)?;

    tx.commit()?;

    // Read back the installed queue with full track metadata
    let items = get_queue(conn)?;

    // The track at index 0 is the one to play
    let current_track = items
        .first()
        .map(|item| item.track.clone())
        .ok_or_else(|| DbError::NotFound("Queue empty after insert".to_string()))?;

    Ok(PlayContextResult {
        items,
        current_track,
        shuffle_enabled: shuffle,
        original_order_json,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{
        TrackMetadata,
        library::add_track,
        schema::{create_tables, run_migrations},
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
    fn test_add_to_queue() {
        let conn = setup_test_db();
        let track_ids = add_test_tracks(&conn, 3);

        let added = add_to_queue(&conn, &track_ids, None).unwrap();
        assert_eq!(added, 3);

        let queue = get_queue(&conn).unwrap();
        assert_eq!(queue.len(), 3);
        assert_eq!(queue[0].position, 0);
        assert_eq!(queue[1].position, 1);
        assert_eq!(queue[2].position, 2);
    }

    #[test]
    fn test_add_to_queue_at_position() {
        let conn = setup_test_db();
        let track_ids = add_test_tracks(&conn, 5);

        // Add first 3 tracks
        add_to_queue(&conn, &track_ids[0..3], None).unwrap();

        // Add remaining 2 at position 1
        add_to_queue(&conn, &track_ids[3..5], Some(1)).unwrap();

        let queue = get_queue(&conn).unwrap();
        assert_eq!(queue.len(), 5);

        // Order should be: track1, track4, track5, track2, track3
        assert_eq!(queue[0].track.title, Some("Track 1".to_string()));
        assert_eq!(queue[1].track.title, Some("Track 4".to_string()));
        assert_eq!(queue[2].track.title, Some("Track 5".to_string()));
    }

    #[test]
    fn test_remove_from_queue() {
        let conn = setup_test_db();
        let track_ids = add_test_tracks(&conn, 3);
        add_to_queue(&conn, &track_ids, None).unwrap();

        let removed = remove_from_queue(&conn, 1).unwrap();
        assert!(removed);

        let queue = get_queue(&conn).unwrap();
        assert_eq!(queue.len(), 2);
    }

    #[test]
    fn test_reorder_queue() {
        let conn = setup_test_db();
        let track_ids = add_test_tracks(&conn, 3);
        add_to_queue(&conn, &track_ids, None).unwrap();

        // Move track at position 2 to position 0
        let success = reorder_queue(&conn, 2, 0).unwrap();
        assert!(success);

        let queue = get_queue(&conn).unwrap();
        assert_eq!(queue[0].track.title, Some("Track 3".to_string()));
        assert_eq!(queue[1].track.title, Some("Track 1".to_string()));
        assert_eq!(queue[2].track.title, Some("Track 2".to_string()));
    }

    #[test]
    fn test_clear_queue() {
        let conn = setup_test_db();
        let track_ids = add_test_tracks(&conn, 3);
        add_to_queue(&conn, &track_ids, None).unwrap();

        clear_queue(&conn).unwrap();

        let length = get_queue_length(&conn).unwrap();
        assert_eq!(length, 0);
    }

    #[test]
    fn test_remove_from_queue_invalid_position() {
        let conn = setup_test_db();
        let track_ids = add_test_tracks(&conn, 3);
        add_to_queue(&conn, &track_ids, None).unwrap();

        // Invalid positive position
        let removed = remove_from_queue(&conn, 999).unwrap();
        assert!(!removed);

        // Invalid negative position
        let removed = remove_from_queue(&conn, -1).unwrap();
        assert!(!removed);
    }

    #[test]
    fn test_reorder_queue_invalid_from() {
        let conn = setup_test_db();
        let track_ids = add_test_tracks(&conn, 3);
        add_to_queue(&conn, &track_ids, None).unwrap();

        let success = reorder_queue(&conn, 999, 0).unwrap();
        assert!(!success);
    }

    #[test]
    fn test_reorder_queue_invalid_to() {
        let conn = setup_test_db();
        let track_ids = add_test_tracks(&conn, 3);
        add_to_queue(&conn, &track_ids, None).unwrap();

        let success = reorder_queue(&conn, 0, 999).unwrap();
        assert!(!success);
    }

    #[test]
    fn test_get_queue_state_default() {
        let conn = setup_test_db();

        // First call should initialize default state
        let state = get_queue_state(&conn).unwrap();
        assert_eq!(state.current_index, -1);
        assert!(!state.shuffle_enabled);
        assert_eq!(state.loop_mode, "none");
        assert!(state.original_order_json.is_none());
    }

    #[test]
    fn test_set_queue_state() {
        let conn = setup_test_db();

        let state = QueueState {
            current_index: 5,
            shuffle_enabled: true,
            loop_mode: "all".to_string(),
            original_order_json: Some("[1,2,3]".to_string()),
        };

        set_queue_state(&conn, &state).unwrap();

        let retrieved = get_queue_state(&conn).unwrap();
        assert_eq!(retrieved.current_index, 5);
        assert!(retrieved.shuffle_enabled);
        assert_eq!(retrieved.loop_mode, "all");
        assert_eq!(retrieved.original_order_json, Some("[1,2,3]".to_string()));
    }

    #[test]
    fn test_set_current_index() {
        let conn = setup_test_db();

        set_current_index(&conn, 10).unwrap();

        let state = get_queue_state(&conn).unwrap();
        assert_eq!(state.current_index, 10);
    }

    #[test]
    fn test_set_shuffle_enabled() {
        let conn = setup_test_db();

        set_shuffle_enabled(&conn, true).unwrap();

        let state = get_queue_state(&conn).unwrap();
        assert!(state.shuffle_enabled);

        set_shuffle_enabled(&conn, false).unwrap();

        let state = get_queue_state(&conn).unwrap();
        assert!(!state.shuffle_enabled);
    }

    #[test]
    fn test_set_loop_mode() {
        let conn = setup_test_db();

        set_loop_mode(&conn, "one").unwrap();

        let state = get_queue_state(&conn).unwrap();
        assert_eq!(state.loop_mode, "one");

        set_loop_mode(&conn, "all").unwrap();

        let state = get_queue_state(&conn).unwrap();
        assert_eq!(state.loop_mode, "all");
    }

    #[test]
    fn test_set_original_order_json() {
        let conn = setup_test_db();

        set_original_order_json(&conn, Some("[5,4,3,2,1]".to_string())).unwrap();

        let state = get_queue_state(&conn).unwrap();
        assert_eq!(state.original_order_json, Some("[5,4,3,2,1]".to_string()));

        // Clear it
        set_original_order_json(&conn, None).unwrap();

        let state = get_queue_state(&conn).unwrap();
        assert!(state.original_order_json.is_none());
    }

    #[test]
    fn test_add_files_to_queue_new_files() {
        let conn = setup_test_db();

        // Add files not in library
        let filepaths = vec!["/music/new1.mp3".to_string(), "/music/new2.mp3".to_string()];

        let (count, tracks) = add_files_to_queue(&conn, &filepaths, None).unwrap();
        assert_eq!(count, 2);
        assert_eq!(tracks.len(), 2);

        let queue = get_queue(&conn).unwrap();
        assert_eq!(queue.len(), 2);
    }

    #[test]
    fn test_add_files_to_queue_existing_files() {
        let conn = setup_test_db();
        let track_ids = add_test_tracks(&conn, 2);

        // Get filepaths from library
        let filepaths = vec![
            "/music/track1.mp3".to_string(),
            "/music/track2.mp3".to_string(),
        ];

        let (count, tracks) = add_files_to_queue(&conn, &filepaths, None).unwrap();
        assert_eq!(count, 2);
        assert_eq!(tracks.len(), 2);
        assert_eq!(tracks[0].id, track_ids[0]);
        assert_eq!(tracks[1].id, track_ids[1]);
    }

    #[test]
    fn test_add_files_to_queue_at_position() {
        let conn = setup_test_db();

        // Add initial files
        let initial = vec![
            "/music/first.mp3".to_string(),
            "/music/second.mp3".to_string(),
        ];
        add_files_to_queue(&conn, &initial, None).unwrap();

        // Add new files at position 1
        let new_files = vec!["/music/inserted.mp3".to_string()];
        add_files_to_queue(&conn, &new_files, Some(1)).unwrap();

        let queue = get_queue(&conn).unwrap();
        assert_eq!(queue.len(), 3);
        assert_eq!(queue[0].track.filepath, "/music/first.mp3");
        assert_eq!(queue[1].track.filepath, "/music/inserted.mp3");
        assert_eq!(queue[2].track.filepath, "/music/second.mp3");
    }

    #[test]
    fn test_get_queue_empty() {
        let conn = setup_test_db();

        let queue = get_queue(&conn).unwrap();
        assert!(queue.is_empty());
    }

    #[test]
    fn test_get_queue_length() {
        let conn = setup_test_db();
        let track_ids = add_test_tracks(&conn, 5);
        add_to_queue(&conn, &track_ids, None).unwrap();

        let length = get_queue_length(&conn).unwrap();
        assert_eq!(length, 5);
    }

    #[test]
    fn test_add_to_queue_nonexistent_tracks() {
        let conn = setup_test_db();

        // Try to add nonexistent track IDs
        let added = add_to_queue(&conn, &[9999, 9998], None).unwrap();
        assert_eq!(added, 0);

        let queue = get_queue(&conn).unwrap();
        assert!(queue.is_empty());
    }

    #[test]
    fn test_play_context_sequential_rotation() {
        let conn = setup_test_db();
        let track_ids = add_test_tracks(&conn, 5);

        // Play from index 2 (track3) without shuffle
        let result = play_context(&conn, &track_ids, 2, false).unwrap();

        // Queue should be rotated: [track3, track4, track5, track1, track2]
        assert_eq!(result.items.len(), 5);
        assert_eq!(result.items[0].track.id, track_ids[2]);
        assert_eq!(result.items[1].track.id, track_ids[3]);
        assert_eq!(result.items[2].track.id, track_ids[4]);
        assert_eq!(result.items[3].track.id, track_ids[0]);
        assert_eq!(result.items[4].track.id, track_ids[1]);

        // Current track is the one at index 0
        assert_eq!(result.current_track.id, track_ids[2]);
        assert!(!result.shuffle_enabled);
        assert!(result.original_order_json.is_none());

        // Queue state should reflect current_index=0, shuffle=false
        let state = get_queue_state(&conn).unwrap();
        assert_eq!(state.current_index, 0);
        assert!(!state.shuffle_enabled);
    }

    #[test]
    fn test_play_context_sequential_first_track() {
        let conn = setup_test_db();
        let track_ids = add_test_tracks(&conn, 3);

        // Play from index 0 — no rotation needed
        let result = play_context(&conn, &track_ids, 0, false).unwrap();

        assert_eq!(result.items.len(), 3);
        assert_eq!(result.items[0].track.id, track_ids[0]);
        assert_eq!(result.items[1].track.id, track_ids[1]);
        assert_eq!(result.items[2].track.id, track_ids[2]);
    }

    #[test]
    fn test_play_context_sequential_last_track() {
        let conn = setup_test_db();
        let track_ids = add_test_tracks(&conn, 3);

        // Play from last index
        let result = play_context(&conn, &track_ids, 2, false).unwrap();

        assert_eq!(result.items.len(), 3);
        assert_eq!(result.items[0].track.id, track_ids[2]);
        assert_eq!(result.items[1].track.id, track_ids[0]);
        assert_eq!(result.items[2].track.id, track_ids[1]);
    }

    #[test]
    fn test_play_context_shuffle_current_at_index_zero() {
        let conn = setup_test_db();
        let track_ids = add_test_tracks(&conn, 10);

        let result = play_context(&conn, &track_ids, 3, true).unwrap();

        // The clicked track (index 3) must be at position 0
        assert_eq!(result.items.len(), 10);
        assert_eq!(result.items[0].track.id, track_ids[3]);
        assert!(result.shuffle_enabled);
        assert!(result.original_order_json.is_some());

        // All tracks must be present (no duplicates, no missing)
        let mut ids: Vec<i64> = result.items.iter().map(|i| i.track.id).collect();
        ids.sort();
        let mut expected = track_ids.clone();
        expected.sort();
        assert_eq!(ids, expected);

        // Queue state
        let state = get_queue_state(&conn).unwrap();
        assert_eq!(state.current_index, 0);
        assert!(state.shuffle_enabled);
        assert!(state.original_order_json.is_some());
    }

    #[test]
    fn test_play_context_single_track() {
        let conn = setup_test_db();
        let track_ids = add_test_tracks(&conn, 1);

        let result = play_context(&conn, &track_ids, 0, false).unwrap();

        assert_eq!(result.items.len(), 1);
        assert_eq!(result.current_track.id, track_ids[0]);
    }

    #[test]
    fn test_play_context_single_track_shuffle() {
        let conn = setup_test_db();
        let track_ids = add_test_tracks(&conn, 1);

        let result = play_context(&conn, &track_ids, 0, true).unwrap();

        assert_eq!(result.items.len(), 1);
        assert_eq!(result.items[0].track.id, track_ids[0]);
        assert!(result.shuffle_enabled);
    }

    #[test]
    fn test_play_context_empty_track_list() {
        let conn = setup_test_db();

        let result = play_context(&conn, &[], 0, false);
        assert!(result.is_err());
    }

    #[test]
    fn test_play_context_start_index_out_of_bounds() {
        let conn = setup_test_db();
        let track_ids = add_test_tracks(&conn, 3);

        let result = play_context(&conn, &track_ids, 5, false);
        assert!(result.is_err());

        let result = play_context(&conn, &track_ids, -1, false);
        assert!(result.is_err());
    }

    #[test]
    fn test_play_context_nonexistent_tracks_skipped() {
        let conn = setup_test_db();
        let track_ids = add_test_tracks(&conn, 3);

        // Mix real and fake IDs, start on a real one
        let mixed = vec![track_ids[0], 9999, track_ids[1], 8888, track_ids[2]];
        let result = play_context(&conn, &mixed, 0, false).unwrap();

        // Only 3 real tracks should be in queue
        assert_eq!(result.items.len(), 3);
        assert_eq!(result.items[0].track.id, track_ids[0]);
        assert_eq!(result.items[1].track.id, track_ids[1]);
        assert_eq!(result.items[2].track.id, track_ids[2]);
    }

    #[test]
    fn test_play_context_start_track_not_in_library() {
        let conn = setup_test_db();
        let track_ids = add_test_tracks(&conn, 2);

        // start_index points to a nonexistent track
        let mixed = vec![9999, track_ids[0], track_ids[1]];
        let result = play_context(&conn, &mixed, 0, false);

        // Should error because the start track doesn't exist
        assert!(result.is_err());
    }

    #[test]
    fn test_play_context_clears_previous_queue() {
        let conn = setup_test_db();
        let track_ids = add_test_tracks(&conn, 5);

        // Add first 3 tracks to queue
        add_to_queue(&conn, &track_ids[..3], None).unwrap();
        assert_eq!(get_queue_length(&conn).unwrap(), 3);

        // Play context with last 2 tracks — should clear the previous 3
        let result = play_context(&conn, &track_ids[3..], 0, false).unwrap();
        assert_eq!(result.items.len(), 2);
        assert_eq!(get_queue_length(&conn).unwrap(), 2);
    }

    #[test]
    fn test_play_context_preserves_loop_mode() {
        let conn = setup_test_db();
        let track_ids = add_test_tracks(&conn, 3);

        // Set loop mode before play_context
        set_loop_mode(&conn, "all").unwrap();

        let _result = play_context(&conn, &track_ids, 0, false).unwrap();

        let state = get_queue_state(&conn).unwrap();
        assert_eq!(state.loop_mode, "all");
    }

    #[test]
    fn test_play_context_concurrent_last_wins() {
        let conn = setup_test_db();
        let track_ids = add_test_tracks(&conn, 6);

        // First play context
        play_context(&conn, &track_ids[..3], 0, false).unwrap();

        // Second play context overwrites
        let result = play_context(&conn, &track_ids[3..], 0, false).unwrap();

        assert_eq!(result.items.len(), 3);
        assert_eq!(result.items[0].track.id, track_ids[3]);
        assert_eq!(result.items[1].track.id, track_ids[4]);
        assert_eq!(result.items[2].track.id, track_ids[5]);
    }
}

#[cfg(test)]
#[path = "queue_props_test.rs"]
mod queue_props_test;
