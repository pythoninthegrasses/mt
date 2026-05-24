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
                l.file_mtime_ns, l.file_ctime_ns, l.file_inode, l.content_hash,
                l.source, l.remote_id
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
            source: row
                .get::<_, String>("source")
                .unwrap_or_else(|_| "local".to_string()),
            remote_id: row.get("remote_id").unwrap_or(None),
        };

        items.push(QueueItem { position, track });
        position += 1;
    }

    Ok(items)
}

/// Look up `id -> filepath` for arbitrary-length id lists, batching to stay
/// under SQLite's SQLITE_MAX_VARIABLE_NUMBER limit (999 in our bundled build).
fn fetch_filepaths_by_id(
    conn: &Connection,
    track_ids: &[i64],
) -> DbResult<std::collections::HashMap<i64, String>> {
    use std::collections::HashMap;
    let mut map: HashMap<i64, String> = HashMap::with_capacity(track_ids.len());
    if track_ids.is_empty() {
        return Ok(map);
    }
    for chunk in track_ids.chunks(500) {
        let placeholders = chunk.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        let sql = format!(
            "SELECT id, filepath FROM library WHERE id IN ({})",
            placeholders
        );
        let mut stmt = conn.prepare(&sql)?;
        let params: Vec<&dyn rusqlite::ToSql> =
            chunk.iter().map(|id| id as &dyn rusqlite::ToSql).collect();
        for row in stmt
            .query_map(params.as_slice(), |row| {
                Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
            })?
            .flatten()
        {
            map.insert(row.0, row.1);
        }
    }
    Ok(map)
}

/// Add tracks to the queue by track IDs
pub(crate) fn add_to_queue(
    conn: &Connection,
    track_ids: &[i64],
    position: Option<i64>,
) -> DbResult<i64> {
    let track_map = fetch_filepaths_by_id(conn, track_ids)?;

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
        "SELECT current_index, shuffle_enabled, loop_mode, original_order_json,
                play_next_offset, play_history_json, play_next_track_ids_json, repeat_one_pending
         FROM queue_state WHERE id = 1",
        [],
        |row| {
            Ok(QueueState {
                current_index: row.get(0)?,
                shuffle_enabled: row.get::<_, i64>(1)? != 0,
                loop_mode: row.get(2)?,
                original_order_json: row.get(3)?,
                play_next_offset: row.get::<_, Option<i64>>(4)?.unwrap_or(0),
                play_history_json: row.get(5)?,
                play_next_track_ids_json: row.get(6)?,
                repeat_one_pending: row.get::<_, Option<i64>>(7)?.unwrap_or(0) != 0,
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
                play_next_offset: 0,
                play_history_json: None,
                play_next_track_ids_json: None,
                repeat_one_pending: false,
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
        "INSERT OR REPLACE INTO queue_state (id, current_index, shuffle_enabled, loop_mode,
         original_order_json, play_next_offset, play_history_json, play_next_track_ids_json,
         repeat_one_pending)
         VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)",
        params![
            state.current_index,
            if state.shuffle_enabled { 1 } else { 0 },
            &state.loop_mode,
            &state.original_order_json,
            state.play_next_offset,
            &state.play_history_json,
            &state.play_next_track_ids_json,
            if state.repeat_one_pending { 1 } else { 0 },
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

/// Update play_next_offset in queue state
pub(crate) fn set_play_next_offset(conn: &Connection, offset: i64) -> DbResult<()> {
    let _ = get_queue_state(conn)?;
    conn.execute(
        "UPDATE queue_state SET play_next_offset = ? WHERE id = 1",
        params![offset],
    )?;
    Ok(())
}

/// Update play history JSON in queue state
pub(crate) fn set_play_history_json(conn: &Connection, json: Option<String>) -> DbResult<()> {
    let _ = get_queue_state(conn)?;
    conn.execute(
        "UPDATE queue_state SET play_history_json = ? WHERE id = 1",
        params![json],
    )?;
    Ok(())
}

/// Update play-next track IDs JSON in queue state
pub(crate) fn set_play_next_track_ids_json(
    conn: &Connection,
    json: Option<String>,
) -> DbResult<()> {
    let _ = get_queue_state(conn)?;
    conn.execute(
        "UPDATE queue_state SET play_next_track_ids_json = ? WHERE id = 1",
        params![json],
    )?;
    Ok(())
}

/// Update repeat_one_pending flag in queue state
pub(crate) fn set_repeat_one_pending(conn: &Connection, pending: bool) -> DbResult<()> {
    let _ = get_queue_state(conn)?;
    conn.execute(
        "UPDATE queue_state SET repeat_one_pending = ? WHERE id = 1",
        params![if pending { 1 } else { 0 }],
    )?;
    Ok(())
}

/// Add tracks as "play next" after the current track + any existing play-next tracks.
///
/// Move semantics: if a track already exists in the queue (and is not the current track),
/// it is removed first. Tracks are inserted at `current_index + 1 + play_next_offset`.
pub(crate) fn add_play_next(conn: &Connection, track_ids: &[i64]) -> DbResult<Vec<QueueItem>> {
    if track_ids.is_empty() {
        return get_queue(conn);
    }

    let state = get_queue_state(conn)?;
    let items = get_queue(conn)?;

    if items.is_empty() {
        // Nothing playing — just add to end
        add_to_queue(conn, track_ids, None)?;
        return get_queue(conn);
    }

    let track_map = fetch_filepaths_by_id(conn, track_ids)?;

    let current_idx = state.current_index.max(0) as usize;
    let current_track_id = items.get(current_idx).map(|i| i.track.id);

    // Build new queue: remove tracks that are being moved (except current), then insert at position
    let track_id_set: std::collections::HashSet<i64> = track_ids.iter().copied().collect();

    // Tracks to insert
    let new_fps: Vec<String> = track_ids
        .iter()
        .filter_map(|id| track_map.get(id).cloned())
        .collect();

    // Count how many tracks before current_idx will be removed (affects current_idx)
    let removed_before_current: usize = items
        .iter()
        .enumerate()
        .filter(|(i, item)| {
            *i < current_idx
                && track_id_set.contains(&item.track.id)
                && Some(item.track.id) != current_track_id
        })
        .count();

    let adjusted_current_idx = current_idx - removed_before_current;
    let insert_pos = adjusted_current_idx + 1 + state.play_next_offset as usize;

    // Build filepath list excluding tracks being moved (except current)
    let mut kept: Vec<String> = Vec::new();
    for (i, item) in items.iter().enumerate() {
        if track_id_set.contains(&item.track.id)
            && Some(item.track.id) != current_track_id
            && i != current_idx
        {
            continue; // Skip — will be re-inserted at play-next position
        }
        kept.push(item.track.filepath.clone());
    }

    // Insert at position
    let insert_at = insert_pos.min(kept.len());
    for (j, fp) in new_fps.iter().enumerate() {
        kept.insert(insert_at + j, fp.clone());
    }
    // Rebuild queue
    let tx = conn.unchecked_transaction()?;
    tx.execute("DELETE FROM queue", [])?;
    for fp in &kept {
        tx.execute("INSERT INTO queue (filepath) VALUES (?)", params![fp])?;
    }

    // Update state: increment play_next_offset, add to play_next_track_ids
    let new_offset = state.play_next_offset + new_fps.len() as i64;
    let mut play_next_ids: Vec<i64> = state
        .play_next_track_ids_json
        .as_deref()
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or_default();
    for id in track_ids {
        if !play_next_ids.contains(id) {
            play_next_ids.push(*id);
        }
    }
    let play_next_json = serde_json::to_string(&play_next_ids).ok();

    tx.execute(
        "UPDATE queue_state SET play_next_offset = ?, play_next_track_ids_json = ?,
         current_index = ? WHERE id = 1",
        params![new_offset, play_next_json, adjusted_current_idx as i64],
    )?;

    tx.commit()?;
    get_queue(conn)
}

/// Toggle shuffle on/off with full state management.
///
/// Enable: saves original order, separates current + play-next + regular tracks,
/// Fisher-Yates shuffles regular tracks, rebuilds queue as [current, play-next..., shuffled...].
/// Disable: restores original order from saved JSON, finds current track in restored order.
pub(crate) fn toggle_shuffle(conn: &Connection, enabled: bool) -> DbResult<Vec<QueueItem>> {
    use rand::rng;
    use rand::seq::SliceRandom;

    let state = get_queue_state(conn)?;
    let items = get_queue(conn)?;

    if items.is_empty() {
        set_shuffle_enabled(conn, enabled)?;
        return Ok(items);
    }

    let tx = conn.unchecked_transaction()?;

    if enabled {
        // Save current order for unshuffle
        let original_ids: Vec<i64> = items.iter().map(|item| item.track.id).collect();
        let original_order_json = serde_json::to_string(&original_ids).unwrap_or_default();

        // Parse play-next track IDs
        let play_next_ids: Vec<i64> = state
            .play_next_track_ids_json
            .as_deref()
            .and_then(|s| serde_json::from_str(s).ok())
            .unwrap_or_default();

        let current_idx = state.current_index.max(0) as usize;

        // Separate: current track, play-next tracks, regular tracks
        let mut current_fp: Option<String> = None;
        let mut play_next_fps: Vec<String> = Vec::new();
        let mut regular_fps: Vec<String> = Vec::new();

        for (i, item) in items.iter().enumerate() {
            if i == current_idx {
                current_fp = Some(item.track.filepath.clone());
            } else if play_next_ids.contains(&item.track.id) {
                play_next_fps.push(item.track.filepath.clone());
            } else {
                regular_fps.push(item.track.filepath.clone());
            }
        }

        // Fisher-Yates shuffle regular tracks
        regular_fps.shuffle(&mut rng());

        // Rebuild: [current, play-next..., shuffled...]
        tx.execute("DELETE FROM queue", [])?;
        if let Some(fp) = &current_fp {
            tx.execute("INSERT INTO queue (filepath) VALUES (?)", params![fp])?;
        }
        for fp in &play_next_fps {
            tx.execute("INSERT INTO queue (filepath) VALUES (?)", params![fp])?;
        }
        for fp in &regular_fps {
            tx.execute("INSERT INTO queue (filepath) VALUES (?)", params![fp])?;
        }

        // Update state
        tx.execute(
            "UPDATE queue_state SET current_index = 0, shuffle_enabled = 1,
             original_order_json = ? WHERE id = 1",
            params![original_order_json],
        )?;
    } else {
        // Restore original order
        let original_ids: Vec<i64> = state
            .original_order_json
            .as_deref()
            .and_then(|s| serde_json::from_str(s).ok())
            .unwrap_or_default();

        if original_ids.is_empty() {
            // No original order saved — just toggle the flag
            tx.execute(
                "UPDATE queue_state SET shuffle_enabled = 0, original_order_json = NULL WHERE id = 1",
                [],
            )?;
        } else {
            // Build filepath lookup from current queue
            let fp_map: std::collections::HashMap<i64, String> = items
                .iter()
                .map(|item| (item.track.id, item.track.filepath.clone()))
                .collect();

            // Find current track ID before rebuilding
            let current_track_id = if current_idx_valid(&state, &items) {
                Some(items[state.current_index as usize].track.id)
            } else {
                None
            };

            // Rebuild queue in original order
            tx.execute("DELETE FROM queue", [])?;
            for id in &original_ids {
                if let Some(fp) = fp_map.get(id) {
                    tx.execute("INSERT INTO queue (filepath) VALUES (?)", params![fp])?;
                }
            }

            // Find current track's new index in restored order
            let new_index = current_track_id
                .and_then(|tid| original_ids.iter().position(|id| *id == tid))
                .map(|i| i as i64)
                .unwrap_or(0);

            tx.execute(
                "UPDATE queue_state SET current_index = ?, shuffle_enabled = 0,
                 original_order_json = NULL WHERE id = 1",
                params![new_index],
            )?;
        }
    }

    tx.commit()?;
    get_queue(conn)
}

/// Reshuffle the queue for loop restart (loop=all wrapping back to start).
///
/// Different from toggle_shuffle: the just-played track goes to the END
/// (not index 0) to avoid immediate repetition. Does not touch original_order_json.
pub(crate) fn reshuffle_for_loop_restart(conn: &Connection) -> DbResult<Vec<QueueItem>> {
    use rand::rng;
    use rand::seq::SliceRandom;

    let state = get_queue_state(conn)?;
    let items = get_queue(conn)?;

    if items.len() <= 1 {
        return Ok(items);
    }

    let current_idx = state.current_index.max(0) as usize;
    let current_fp = items
        .get(current_idx)
        .map(|item| item.track.filepath.clone());

    // Separate current track from the rest, shuffle the rest
    let mut other_fps: Vec<String> = items
        .iter()
        .enumerate()
        .filter(|(i, _)| *i != current_idx)
        .map(|(_, item)| item.track.filepath.clone())
        .collect();
    other_fps.shuffle(&mut rng());

    // Rebuild: [shuffled..., just-played at END]
    let tx = conn.unchecked_transaction()?;
    tx.execute("DELETE FROM queue", [])?;
    for fp in &other_fps {
        tx.execute("INSERT INTO queue (filepath) VALUES (?)", params![fp])?;
    }
    if let Some(fp) = &current_fp {
        tx.execute("INSERT INTO queue (filepath) VALUES (?)", params![fp])?;
    }

    // Current index is 0 (first track in reshuffled order)
    tx.execute("UPDATE queue_state SET current_index = 0 WHERE id = 1", [])?;

    tx.commit()?;
    get_queue(conn)
}

/// Check if current_index in state points to a valid queue item
fn current_idx_valid(state: &QueueState, items: &[QueueItem]) -> bool {
    state.current_index >= 0 && (state.current_index as usize) < items.len()
}

/// Result of a navigation operation (advance_to_next/previous)
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum NavigationAction {
    /// Play the track at the given index
    Play(usize),
    /// Stop playback (end of queue, no loop)
    Stop,
    /// Restart current track from beginning (>3sec threshold)
    SeekZero,
}

/// Advance to the next track in the queue.
///
/// Handles repeat-one two-phase logic, loop modes, history, and reshuffle on loop restart.
/// Returns the action to take and the updated queue items (may change if reshuffled).
pub(crate) fn advance_to_next(conn: &Connection) -> DbResult<(NavigationAction, Vec<QueueItem>)> {
    let state = get_queue_state(conn)?;
    let items = get_queue(conn)?;

    if items.is_empty() {
        return Ok((NavigationAction::Stop, items));
    }

    let current_idx = state.current_index.max(0) as usize;

    // Phase 2 of repeat-one: flag was set on previous call, clear and advance normally
    if state.repeat_one_pending {
        set_repeat_one_pending(conn, false)?;
        // Fall through to normal advance logic
    }

    // Phase 1 of repeat-one: set flag, change loop to "none", replay
    if state.loop_mode == "one" {
        set_repeat_one_pending(conn, true)?;
        set_loop_mode(conn, "none")?;
        return Ok((NavigationAction::Play(current_idx), items));
    }

    // Push current track to history
    if current_idx < items.len() {
        push_to_history(conn, &state, items[current_idx].track.id)?;
    }

    let next_idx = current_idx + 1;

    if next_idx >= items.len() {
        // End of queue
        if state.loop_mode == "all" {
            // Loop restart
            let new_items = if state.shuffle_enabled {
                reshuffle_for_loop_restart(conn)?
            } else {
                items
            };
            // Reset to index 0
            set_current_index(conn, 0)?;
            set_play_next_offset(conn, 0)?;
            // Remove from play_next_track_ids if present
            if !new_items.is_empty() {
                remove_from_play_next_ids(conn, new_items[0].track.id)?;
            }
            return Ok((NavigationAction::Play(0), new_items));
        } else {
            return Ok((NavigationAction::Stop, items));
        }
    }

    // Normal advance
    set_current_index(conn, next_idx as i64)?;
    set_play_next_offset(conn, 0)?;
    remove_from_play_next_ids(conn, items[next_idx].track.id)?;

    Ok((NavigationAction::Play(next_idx), items))
}

/// Advance to the previous track in the queue.
///
/// If current_time_ms > 3000, returns SeekZero to restart current track.
/// Otherwise tries history, then falls back to decrementing index.
pub(crate) fn advance_to_previous(
    conn: &Connection,
    current_time_ms: u64,
) -> DbResult<(NavigationAction, Vec<QueueItem>)> {
    let state = get_queue_state(conn)?;
    let items = get_queue(conn)?;

    if items.is_empty() {
        return Ok((NavigationAction::Stop, items));
    }

    // >3 seconds into track: restart
    if current_time_ms > 3000 {
        return Ok((NavigationAction::SeekZero, items));
    }

    // Try history
    let history: Vec<i64> = state
        .play_history_json
        .as_deref()
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or_default();

    if !history.is_empty() {
        // Pop from history and find the track in the current queue
        let mut remaining = history.clone();
        while let Some(track_id) = remaining.pop() {
            if let Some(idx) = items.iter().position(|item| item.track.id == track_id) {
                // Save remaining history
                let json = if remaining.is_empty() {
                    None
                } else {
                    Some(serde_json::to_string(&remaining).unwrap_or_default())
                };
                set_play_history_json(conn, json)?;
                set_current_index(conn, idx as i64)?;
                return Ok((NavigationAction::Play(idx), items));
            }
            // Track no longer in queue, try next history entry
        }
        // All history entries exhausted
        set_play_history_json(conn, None)?;
    }

    // Fallback: decrement index
    let current_idx = state.current_index.max(0) as usize;
    if current_idx > 0 {
        let prev_idx = current_idx - 1;
        set_current_index(conn, prev_idx as i64)?;
        return Ok((NavigationAction::Play(prev_idx), items));
    }

    // At start of queue
    if state.loop_mode == "all" && items.len() > 1 {
        let last_idx = items.len() - 1;
        set_current_index(conn, last_idx as i64)?;
        return Ok((NavigationAction::Play(last_idx), items));
    }

    // Stay at beginning
    Ok((NavigationAction::Play(0), items))
}

/// Skip next: override repeat-one by changing to loop=all, then advance.
pub(crate) fn skip_to_next(conn: &Connection) -> DbResult<(NavigationAction, Vec<QueueItem>)> {
    let state = get_queue_state(conn)?;
    if state.loop_mode == "one" || state.repeat_one_pending {
        set_loop_mode(conn, "all")?;
        set_repeat_one_pending(conn, false)?;
    }
    advance_to_next(conn)
}

/// Skip previous: override repeat-one by changing to loop=all, then go previous.
pub(crate) fn skip_to_previous(
    conn: &Connection,
    current_time_ms: u64,
) -> DbResult<(NavigationAction, Vec<QueueItem>)> {
    let state = get_queue_state(conn)?;
    if state.loop_mode == "one" || state.repeat_one_pending {
        set_loop_mode(conn, "all")?;
        set_repeat_one_pending(conn, false)?;
    }
    advance_to_previous(conn, current_time_ms)
}

/// Push a track ID to the play history (FIFO, capped at 100)
fn push_to_history(conn: &Connection, state: &QueueState, track_id: i64) -> DbResult<()> {
    let mut history: Vec<i64> = state
        .play_history_json
        .as_deref()
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or_default();

    history.push(track_id);

    // Cap at 100
    if history.len() > 100 {
        history.drain(..history.len() - 100);
    }

    let json = serde_json::to_string(&history).unwrap_or_default();
    set_play_history_json(conn, Some(json))
}

/// Remove a track ID from the play_next_track_ids set
fn remove_from_play_next_ids(conn: &Connection, track_id: i64) -> DbResult<()> {
    let state = get_queue_state(conn)?;
    let mut ids: Vec<i64> = state
        .play_next_track_ids_json
        .as_deref()
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or_default();

    if ids.is_empty() {
        return Ok(());
    }

    ids.retain(|id| *id != track_id);
    let json = if ids.is_empty() {
        None
    } else {
        Some(serde_json::to_string(&ids).unwrap_or_default())
    };
    set_play_next_track_ids_json(conn, json)
}

/// Report from queue integrity check
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub(crate) struct IntegrityReport {
    pub duplicate_track_ids: Vec<i64>,
    pub index_was_out_of_bounds: bool,
    pub orphaned_play_next_ids: Vec<i64>,
    pub repaired: bool,
}

/// Check queue integrity and repair issues.
///
/// Detects: duplicate track IDs, out-of-bounds current_index, orphaned play_next_track_ids.
/// Auto-repairs by deduplicating and clamping index.
pub(crate) fn check_integrity(conn: &Connection) -> DbResult<IntegrityReport> {
    let items = get_queue(conn)?;
    let state = get_queue_state(conn)?;

    let mut duplicates = Vec::new();
    let mut index_oob = false;
    let mut orphaned = Vec::new();
    let mut needs_repair = false;

    // Check for duplicate track IDs
    let mut seen = std::collections::HashSet::new();
    for item in &items {
        if !seen.insert(item.track.id) {
            duplicates.push(item.track.id);
        }
    }

    // Check current_index bounds
    if !items.is_empty() && (state.current_index < 0 || state.current_index as usize >= items.len())
    {
        index_oob = true;
    }
    if items.is_empty() && state.current_index != -1 {
        index_oob = true;
    }

    // Check play_next_track_ids for orphans
    let play_next_ids: Vec<i64> = state
        .play_next_track_ids_json
        .as_deref()
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or_default();
    let queue_track_ids: std::collections::HashSet<i64> =
        items.iter().map(|i| i.track.id).collect();
    for id in &play_next_ids {
        if !queue_track_ids.contains(id) {
            orphaned.push(*id);
        }
    }

    // Repair if needed
    if !duplicates.is_empty() {
        needs_repair = true;
        // Deduplicate: keep first occurrence of each track ID
        let mut dedup_seen = std::collections::HashSet::new();
        let keep_fps: Vec<String> = items
            .iter()
            .filter(|item| dedup_seen.insert(item.track.id))
            .map(|item| item.track.filepath.clone())
            .collect();

        let tx = conn.unchecked_transaction()?;
        tx.execute("DELETE FROM queue", [])?;
        for fp in &keep_fps {
            tx.execute("INSERT INTO queue (filepath) VALUES (?)", params![fp])?;
        }
        tx.commit()?;
    }

    if index_oob {
        needs_repair = true;
        let new_items = get_queue(conn)?;
        let clamped = if new_items.is_empty() {
            -1
        } else {
            state.current_index.max(0).min(new_items.len() as i64 - 1)
        };
        set_current_index(conn, clamped)?;
    }

    if !orphaned.is_empty() {
        needs_repair = true;
        let cleaned: Vec<i64> = play_next_ids
            .iter()
            .filter(|id| queue_track_ids.contains(id))
            .copied()
            .collect();
        let json = if cleaned.is_empty() {
            None
        } else {
            Some(serde_json::to_string(&cleaned).unwrap_or_default())
        };
        set_play_next_track_ids_json(conn, json)?;
    }

    Ok(IntegrityReport {
        duplicate_track_ids: duplicates,
        index_was_out_of_bounds: index_oob,
        orphaned_play_next_ids: orphaned,
        repaired: needs_repair,
    })
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
    let track_map = fetch_filepaths_by_id(&tx, track_ids)?;

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
        play_next_offset: 0,
        play_history_json: None,
        play_next_track_ids_json: None,
        repeat_one_pending: false,
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
            play_next_offset: 0,
            play_history_json: None,
            play_next_track_ids_json: None,
            repeat_one_pending: false,
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

    #[test]
    fn test_queue_state_new_fields_defaults() {
        let conn = setup_test_db();

        let state = get_queue_state(&conn).unwrap();
        assert_eq!(state.play_next_offset, 0);
        assert!(state.play_history_json.is_none());
        assert!(state.play_next_track_ids_json.is_none());
        assert!(!state.repeat_one_pending);
    }

    #[test]
    fn test_set_play_next_offset() {
        let conn = setup_test_db();

        set_play_next_offset(&conn, 3).unwrap();
        let state = get_queue_state(&conn).unwrap();
        assert_eq!(state.play_next_offset, 3);

        set_play_next_offset(&conn, 0).unwrap();
        let state = get_queue_state(&conn).unwrap();
        assert_eq!(state.play_next_offset, 0);
    }

    #[test]
    fn test_set_play_history_json() {
        let conn = setup_test_db();

        set_play_history_json(&conn, Some("[1,2,3]".to_string())).unwrap();
        let state = get_queue_state(&conn).unwrap();
        assert_eq!(state.play_history_json, Some("[1,2,3]".to_string()));

        set_play_history_json(&conn, None).unwrap();
        let state = get_queue_state(&conn).unwrap();
        assert!(state.play_history_json.is_none());
    }

    #[test]
    fn test_set_play_next_track_ids_json() {
        let conn = setup_test_db();

        set_play_next_track_ids_json(&conn, Some("[10,20]".to_string())).unwrap();
        let state = get_queue_state(&conn).unwrap();
        assert_eq!(state.play_next_track_ids_json, Some("[10,20]".to_string()));

        set_play_next_track_ids_json(&conn, None).unwrap();
        let state = get_queue_state(&conn).unwrap();
        assert!(state.play_next_track_ids_json.is_none());
    }

    #[test]
    fn test_set_repeat_one_pending() {
        let conn = setup_test_db();

        set_repeat_one_pending(&conn, true).unwrap();
        let state = get_queue_state(&conn).unwrap();
        assert!(state.repeat_one_pending);

        set_repeat_one_pending(&conn, false).unwrap();
        let state = get_queue_state(&conn).unwrap();
        assert!(!state.repeat_one_pending);
    }

    #[test]
    fn test_set_queue_state_preserves_new_fields() {
        let conn = setup_test_db();

        let state = QueueState {
            current_index: 2,
            shuffle_enabled: true,
            loop_mode: "one".to_string(),
            original_order_json: None,
            play_next_offset: 5,
            play_history_json: Some("[7,8,9]".to_string()),
            play_next_track_ids_json: Some("[11,12]".to_string()),
            repeat_one_pending: true,
        };
        set_queue_state(&conn, &state).unwrap();

        let retrieved = get_queue_state(&conn).unwrap();
        assert_eq!(retrieved.current_index, 2);
        assert!(retrieved.shuffle_enabled);
        assert_eq!(retrieved.loop_mode, "one");
        assert_eq!(retrieved.play_next_offset, 5);
        assert_eq!(retrieved.play_history_json, Some("[7,8,9]".to_string()));
        assert_eq!(
            retrieved.play_next_track_ids_json,
            Some("[11,12]".to_string())
        );
        assert!(retrieved.repeat_one_pending);
    }

    // ==================== Toggle Shuffle Tests ====================

    #[test]
    fn test_toggle_shuffle_pins_current_at_index_zero() {
        let conn = setup_test_db();
        let track_ids = add_test_tracks(&conn, 5);
        add_to_queue(&conn, &track_ids, None).unwrap();
        set_current_index(&conn, 2).unwrap();

        let items = toggle_shuffle(&conn, true).unwrap();

        // Current track (originally at index 2) should be at index 0
        assert_eq!(items[0].track.id, track_ids[2]);
        assert_eq!(items.len(), 5);

        let state = get_queue_state(&conn).unwrap();
        assert_eq!(state.current_index, 0);
        assert!(state.shuffle_enabled);
        assert!(state.original_order_json.is_some());
    }

    #[test]
    fn test_toggle_shuffle_pins_play_next_tracks() {
        let conn = setup_test_db();
        let track_ids = add_test_tracks(&conn, 5);
        add_to_queue(&conn, &track_ids, None).unwrap();
        set_current_index(&conn, 0).unwrap();

        // Mark tracks 3 and 4 as play-next
        let play_next_ids = serde_json::to_string(&vec![track_ids[2], track_ids[3]]).unwrap();
        set_play_next_track_ids_json(&conn, Some(play_next_ids)).unwrap();

        let items = toggle_shuffle(&conn, true).unwrap();

        // Current track at 0, play-next tracks at 1-2
        assert_eq!(items[0].track.id, track_ids[0]);
        assert_eq!(items[1].track.id, track_ids[2]);
        assert_eq!(items[2].track.id, track_ids[3]);
        assert_eq!(items.len(), 5);
    }

    #[test]
    fn test_toggle_shuffle_unshuffle_restores_order() {
        let conn = setup_test_db();
        let track_ids = add_test_tracks(&conn, 5);
        add_to_queue(&conn, &track_ids, None).unwrap();
        set_current_index(&conn, 2).unwrap();

        // Shuffle
        toggle_shuffle(&conn, true).unwrap();

        // Unshuffle
        let items = toggle_shuffle(&conn, false).unwrap();

        // Original order restored
        for (i, item) in items.iter().enumerate() {
            assert_eq!(item.track.id, track_ids[i]);
        }

        let state = get_queue_state(&conn).unwrap();
        assert!(!state.shuffle_enabled);
        assert!(state.original_order_json.is_none());
        // Current track should be found at its original position
        assert_eq!(state.current_index, 2);
    }

    #[test]
    fn test_toggle_shuffle_preserves_all_tracks() {
        let conn = setup_test_db();
        let track_ids = add_test_tracks(&conn, 10);
        add_to_queue(&conn, &track_ids, None).unwrap();
        set_current_index(&conn, 0).unwrap();

        let items = toggle_shuffle(&conn, true).unwrap();

        // Same count
        assert_eq!(items.len(), 10);

        // Same set of track IDs (permutation)
        let mut shuffled_ids: Vec<i64> = items.iter().map(|i| i.track.id).collect();
        shuffled_ids.sort();
        let mut original_ids = track_ids.clone();
        original_ids.sort();
        assert_eq!(shuffled_ids, original_ids);
    }

    #[test]
    fn test_toggle_shuffle_empty_queue() {
        let conn = setup_test_db();

        let items = toggle_shuffle(&conn, true).unwrap();
        assert!(items.is_empty());

        let state = get_queue_state(&conn).unwrap();
        assert!(state.shuffle_enabled);
    }

    #[test]
    fn test_reshuffle_for_loop_restart_puts_current_at_end() {
        let conn = setup_test_db();
        let track_ids = add_test_tracks(&conn, 5);
        add_to_queue(&conn, &track_ids, None).unwrap();
        set_current_index(&conn, 2).unwrap();

        let items = reshuffle_for_loop_restart(&conn).unwrap();

        // Just-played track (originally at index 2) should be at the END
        assert_eq!(items.last().unwrap().track.id, track_ids[2]);
        // Current index should be 0 (start of reshuffled queue)
        let state = get_queue_state(&conn).unwrap();
        assert_eq!(state.current_index, 0);
        // All tracks preserved
        assert_eq!(items.len(), 5);
    }

    #[test]
    fn test_reshuffle_for_loop_restart_single_track() {
        let conn = setup_test_db();
        let track_ids = add_test_tracks(&conn, 1);
        add_to_queue(&conn, &track_ids, None).unwrap();
        set_current_index(&conn, 0).unwrap();

        let items = reshuffle_for_loop_restart(&conn).unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].track.id, track_ids[0]);
    }

    // ==================== Play-Next Tests ====================

    #[test]
    fn test_add_play_next_at_offset_zero() {
        let conn = setup_test_db();
        let track_ids = add_test_tracks(&conn, 5);
        add_to_queue(&conn, &track_ids[..3], None).unwrap();
        set_current_index(&conn, 0).unwrap();

        // Add track 4 as play-next
        let items = add_play_next(&conn, &[track_ids[3]]).unwrap();

        // Should be: track1(current), track4(play-next), track2, track3
        assert_eq!(items[0].track.id, track_ids[0]);
        assert_eq!(items[1].track.id, track_ids[3]);
        assert_eq!(items[2].track.id, track_ids[1]);
        assert_eq!(items[3].track.id, track_ids[2]);

        let state = get_queue_state(&conn).unwrap();
        assert_eq!(state.play_next_offset, 1);
    }

    #[test]
    fn test_add_play_next_stacked() {
        let conn = setup_test_db();
        let track_ids = add_test_tracks(&conn, 6);
        add_to_queue(&conn, &track_ids[..3], None).unwrap();
        set_current_index(&conn, 0).unwrap();

        // First play-next: track4
        add_play_next(&conn, &[track_ids[3]]).unwrap();
        // Second play-next: track5 — should go AFTER track4
        let items = add_play_next(&conn, &[track_ids[4]]).unwrap();

        // Should be: track1, track4, track5, track2, track3
        assert_eq!(items[0].track.id, track_ids[0]);
        assert_eq!(items[1].track.id, track_ids[3]);
        assert_eq!(items[2].track.id, track_ids[4]);
        assert_eq!(items[3].track.id, track_ids[1]);
        assert_eq!(items[4].track.id, track_ids[2]);

        let state = get_queue_state(&conn).unwrap();
        assert_eq!(state.play_next_offset, 2);
    }

    #[test]
    fn test_add_play_next_move_semantics() {
        let conn = setup_test_db();
        let track_ids = add_test_tracks(&conn, 4);
        add_to_queue(&conn, &track_ids, None).unwrap();
        set_current_index(&conn, 0).unwrap();

        // Move track3 (at index 2) to play-next position
        let items = add_play_next(&conn, &[track_ids[2]]).unwrap();

        // Should be: track1(current), track3(moved), track2, track4
        assert_eq!(items.len(), 4); // No duplicates
        assert_eq!(items[0].track.id, track_ids[0]);
        assert_eq!(items[1].track.id, track_ids[2]);
        assert_eq!(items[2].track.id, track_ids[1]);
        assert_eq!(items[3].track.id, track_ids[3]);
    }

    #[test]
    fn test_add_play_next_current_track_not_moved() {
        let conn = setup_test_db();
        let track_ids = add_test_tracks(&conn, 3);
        add_to_queue(&conn, &track_ids, None).unwrap();
        set_current_index(&conn, 0).unwrap();

        // Try to play-next the currently playing track
        let items = add_play_next(&conn, &[track_ids[0]]).unwrap();

        // Current track should stay at index 0, and be duplicated as play-next
        // (this matches frontend behavior — the track stays and also appears as play-next)
        assert_eq!(items[0].track.id, track_ids[0]);
        assert_eq!(items.len(), 4); // Original 3 + 1 inserted
    }

    #[test]
    fn test_add_play_next_updates_track_ids_json() {
        let conn = setup_test_db();
        let track_ids = add_test_tracks(&conn, 4);
        add_to_queue(&conn, &track_ids[..2], None).unwrap();
        set_current_index(&conn, 0).unwrap();

        add_play_next(&conn, &[track_ids[2]]).unwrap();
        add_play_next(&conn, &[track_ids[3]]).unwrap();

        let state = get_queue_state(&conn).unwrap();
        let ids: Vec<i64> =
            serde_json::from_str(state.play_next_track_ids_json.as_deref().unwrap()).unwrap();
        assert!(ids.contains(&track_ids[2]));
        assert!(ids.contains(&track_ids[3]));
    }

    // ==================== Navigation Tests ====================

    #[test]
    fn test_advance_to_next_normal() {
        let conn = setup_test_db();
        let track_ids = add_test_tracks(&conn, 3);
        add_to_queue(&conn, &track_ids, None).unwrap();
        set_current_index(&conn, 0).unwrap();

        let (action, _items) = advance_to_next(&conn).unwrap();
        assert_eq!(action, NavigationAction::Play(1));

        let state = get_queue_state(&conn).unwrap();
        assert_eq!(state.current_index, 1);
    }

    #[test]
    fn test_advance_to_next_end_no_loop() {
        let conn = setup_test_db();
        let track_ids = add_test_tracks(&conn, 3);
        add_to_queue(&conn, &track_ids, None).unwrap();
        set_current_index(&conn, 2).unwrap();
        set_loop_mode(&conn, "none").unwrap();

        let (action, _) = advance_to_next(&conn).unwrap();
        assert_eq!(action, NavigationAction::Stop);
    }

    #[test]
    fn test_advance_to_next_end_loop_all() {
        let conn = setup_test_db();
        let track_ids = add_test_tracks(&conn, 3);
        add_to_queue(&conn, &track_ids, None).unwrap();
        set_current_index(&conn, 2).unwrap();
        set_loop_mode(&conn, "all").unwrap();

        let (action, _) = advance_to_next(&conn).unwrap();
        assert_eq!(action, NavigationAction::Play(0));

        let state = get_queue_state(&conn).unwrap();
        assert_eq!(state.current_index, 0);
    }

    #[test]
    fn test_advance_to_next_repeat_one_two_phase() {
        let conn = setup_test_db();
        let track_ids = add_test_tracks(&conn, 3);
        add_to_queue(&conn, &track_ids, None).unwrap();
        set_current_index(&conn, 1).unwrap();
        set_loop_mode(&conn, "one").unwrap();

        // Phase 1: sets repeat_one_pending, changes loop to none, replays current
        let (action, _) = advance_to_next(&conn).unwrap();
        assert_eq!(action, NavigationAction::Play(1));
        let state = get_queue_state(&conn).unwrap();
        assert!(state.repeat_one_pending);
        assert_eq!(state.loop_mode, "none");

        // Phase 2: clears pending, advances normally (no second replay)
        let (action, _) = advance_to_next(&conn).unwrap();
        assert_eq!(action, NavigationAction::Play(2));
        let state = get_queue_state(&conn).unwrap();
        assert!(!state.repeat_one_pending);
    }

    #[test]
    fn test_advance_to_next_pushes_history() {
        let conn = setup_test_db();
        let track_ids = add_test_tracks(&conn, 3);
        add_to_queue(&conn, &track_ids, None).unwrap();
        set_current_index(&conn, 0).unwrap();

        advance_to_next(&conn).unwrap();

        let state = get_queue_state(&conn).unwrap();
        let history: Vec<i64> =
            serde_json::from_str(state.play_history_json.as_deref().unwrap()).unwrap();
        assert_eq!(history, vec![track_ids[0]]);
    }

    #[test]
    fn test_advance_to_next_resets_play_next_offset() {
        let conn = setup_test_db();
        let track_ids = add_test_tracks(&conn, 3);
        add_to_queue(&conn, &track_ids, None).unwrap();
        set_current_index(&conn, 0).unwrap();
        set_play_next_offset(&conn, 2).unwrap();

        advance_to_next(&conn).unwrap();

        let state = get_queue_state(&conn).unwrap();
        assert_eq!(state.play_next_offset, 0);
    }

    #[test]
    fn test_advance_to_previous_seek_zero() {
        let conn = setup_test_db();
        let track_ids = add_test_tracks(&conn, 3);
        add_to_queue(&conn, &track_ids, None).unwrap();
        set_current_index(&conn, 1).unwrap();

        let (action, _) = advance_to_previous(&conn, 5000).unwrap();
        assert_eq!(action, NavigationAction::SeekZero);
    }

    #[test]
    fn test_advance_to_previous_uses_history() {
        let conn = setup_test_db();
        let track_ids = add_test_tracks(&conn, 5);
        add_to_queue(&conn, &track_ids, None).unwrap();
        set_current_index(&conn, 3).unwrap();

        // Set history: track at index 0 was played before
        let history = serde_json::to_string(&vec![track_ids[0]]).unwrap();
        set_play_history_json(&conn, Some(history)).unwrap();

        let (action, _) = advance_to_previous(&conn, 0).unwrap();
        assert_eq!(action, NavigationAction::Play(0));

        let state = get_queue_state(&conn).unwrap();
        assert_eq!(state.current_index, 0);
        // History should be empty after popping
        assert!(state.play_history_json.is_none());
    }

    #[test]
    fn test_advance_to_previous_fallback_decrement() {
        let conn = setup_test_db();
        let track_ids = add_test_tracks(&conn, 3);
        add_to_queue(&conn, &track_ids, None).unwrap();
        set_current_index(&conn, 2).unwrap();

        let (action, _) = advance_to_previous(&conn, 0).unwrap();
        assert_eq!(action, NavigationAction::Play(1));

        let state = get_queue_state(&conn).unwrap();
        assert_eq!(state.current_index, 1);
    }

    #[test]
    fn test_advance_to_previous_loop_all_wrap() {
        let conn = setup_test_db();
        let track_ids = add_test_tracks(&conn, 3);
        add_to_queue(&conn, &track_ids, None).unwrap();
        set_current_index(&conn, 0).unwrap();
        set_loop_mode(&conn, "all").unwrap();

        let (action, _) = advance_to_previous(&conn, 0).unwrap();
        assert_eq!(action, NavigationAction::Play(2));

        let state = get_queue_state(&conn).unwrap();
        assert_eq!(state.current_index, 2);
    }

    #[test]
    fn test_skip_next_overrides_repeat_one() {
        let conn = setup_test_db();
        let track_ids = add_test_tracks(&conn, 3);
        add_to_queue(&conn, &track_ids, None).unwrap();
        set_current_index(&conn, 0).unwrap();
        set_loop_mode(&conn, "one").unwrap();

        // skip_next should change loop to "all" and advance (not replay)
        let (action, _) = skip_to_next(&conn).unwrap();
        assert_eq!(action, NavigationAction::Play(1));

        let state = get_queue_state(&conn).unwrap();
        assert_eq!(state.loop_mode, "all");
        assert!(!state.repeat_one_pending);
    }

    #[test]
    fn test_skip_previous_overrides_repeat_one() {
        let conn = setup_test_db();
        let track_ids = add_test_tracks(&conn, 3);
        add_to_queue(&conn, &track_ids, None).unwrap();
        set_current_index(&conn, 1).unwrap();
        set_loop_mode(&conn, "one").unwrap();

        let (action, _) = skip_to_previous(&conn, 0).unwrap();
        assert_eq!(action, NavigationAction::Play(0));

        let state = get_queue_state(&conn).unwrap();
        assert_eq!(state.loop_mode, "all");
    }

    #[test]
    fn test_advance_to_next_end_loop_all_shuffle_reshuffles() {
        let conn = setup_test_db();
        let track_ids = add_test_tracks(&conn, 5);
        add_to_queue(&conn, &track_ids, None).unwrap();
        set_current_index(&conn, 4).unwrap(); // Last track
        set_loop_mode(&conn, "all").unwrap();
        set_shuffle_enabled(&conn, true).unwrap();

        let (action, items) = advance_to_next(&conn).unwrap();
        assert_eq!(action, NavigationAction::Play(0));

        // All 5 tracks preserved
        assert_eq!(items.len(), 5);
        // Just-played track (track_ids[4]) should be at the END
        assert_eq!(items.last().unwrap().track.id, track_ids[4]);
    }

    #[test]
    fn test_advance_to_next_empty_queue() {
        let conn = setup_test_db();

        let (action, _) = advance_to_next(&conn).unwrap();
        assert_eq!(action, NavigationAction::Stop);
    }

    // ==================== Integrity Check Tests ====================

    #[test]
    fn test_check_integrity_clean_queue() {
        let conn = setup_test_db();
        let track_ids = add_test_tracks(&conn, 3);
        add_to_queue(&conn, &track_ids, None).unwrap();
        set_current_index(&conn, 1).unwrap();

        let report = check_integrity(&conn).unwrap();
        assert!(report.duplicate_track_ids.is_empty());
        assert!(!report.index_was_out_of_bounds);
        assert!(report.orphaned_play_next_ids.is_empty());
        assert!(!report.repaired);
    }

    #[test]
    fn test_check_integrity_out_of_bounds_index() {
        let conn = setup_test_db();
        let track_ids = add_test_tracks(&conn, 3);
        add_to_queue(&conn, &track_ids, None).unwrap();
        set_current_index(&conn, 10).unwrap();

        let report = check_integrity(&conn).unwrap();
        assert!(report.index_was_out_of_bounds);
        assert!(report.repaired);

        let state = get_queue_state(&conn).unwrap();
        assert_eq!(state.current_index, 2); // Clamped to last valid index
    }

    #[test]
    fn test_check_integrity_orphaned_play_next_ids() {
        let conn = setup_test_db();
        let track_ids = add_test_tracks(&conn, 3);
        add_to_queue(&conn, &track_ids, None).unwrap();
        set_current_index(&conn, 0).unwrap();

        // Set play-next IDs including one that doesn't exist in queue
        let ids = serde_json::to_string(&vec![track_ids[1], 9999]).unwrap();
        set_play_next_track_ids_json(&conn, Some(ids)).unwrap();

        let report = check_integrity(&conn).unwrap();
        assert_eq!(report.orphaned_play_next_ids, vec![9999]);
        assert!(report.repaired);

        // Orphan should be removed
        let state = get_queue_state(&conn).unwrap();
        let cleaned: Vec<i64> =
            serde_json::from_str(state.play_next_track_ids_json.as_deref().unwrap()).unwrap();
        assert_eq!(cleaned, vec![track_ids[1]]);
    }

    #[test]
    fn test_check_integrity_duplicate_tracks() {
        let conn = setup_test_db();
        let track_ids = add_test_tracks(&conn, 2);
        // Manually insert duplicate
        add_to_queue(&conn, &track_ids, None).unwrap();
        conn.execute(
            "INSERT INTO queue (filepath) VALUES (?)",
            params![format!("/music/track1.mp3")],
        )
        .unwrap();
        set_current_index(&conn, 0).unwrap();

        let report = check_integrity(&conn).unwrap();
        assert!(!report.duplicate_track_ids.is_empty());
        assert!(report.repaired);

        // After repair, no duplicates
        let items = get_queue(&conn).unwrap();
        let ids: Vec<i64> = items.iter().map(|i| i.track.id).collect();
        let unique: std::collections::HashSet<i64> = ids.iter().copied().collect();
        assert_eq!(ids.len(), unique.len());
    }

    #[test]
    fn play_context_handles_library_over_sqlite_param_limit() {
        let conn = setup_test_db();
        let ids = add_test_tracks(&conn, 1500);
        let result = play_context(&conn, &ids, 0, false).expect("must not overflow IN()");
        assert_eq!(result.items.len(), 1500);
    }

    #[test]
    fn add_to_queue_handles_param_limit() {
        let conn = setup_test_db();
        let ids = add_test_tracks(&conn, 1200);
        let n = add_to_queue(&conn, &ids, None).expect("must not overflow IN()");
        assert_eq!(n, 1200);
    }
}

#[cfg(test)]
#[path = "queue_props_test.rs"]
mod queue_props_test;
