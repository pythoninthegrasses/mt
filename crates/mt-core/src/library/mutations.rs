//! Mutations: each DB half of a `library_*` write command, paired with the
//! bookkeeping that has to share its transaction.
//!
//! Two rules keep the move honest. A mutation returns what it changed rather
//! than emitting an event, so the desktop adapter decides what to announce; and
//! every totals reading that accompanies a change is taken on the same
//! connection that made it, exactly as before, so a reconcile event can never
//! describe a library the frontend has already been shown.

use std::path::Path;

use rusqlite::Connection;
use tracing::debug;

use crate::db::{Database, Track, TrackMetadata, library, removed, revision};
use crate::scanner::metadata::extract_metadata_or_default;

/// Authoritative library totals, measured right after a mutation.
///
/// `total_tracks` includes remote Plex tracks (virtual-scroll pagination needs
/// them); `total_duration` is local-only (the footer excludes remote tracks).
#[derive(Debug)]
pub struct ReconcileStats {
    pub total_tracks: i64,
    pub local_file_count: i64,
    pub total_duration: f64,
    pub revision: i64,
}

/// Query authoritative stats + revision for reconcile events.
/// total_tracks includes all tracks (for virtual-scroll pagination);
/// total_duration is local-only (remote Plex tracks excluded, for footer display).
pub(crate) fn get_reconcile_stats(conn: &Connection) -> Result<ReconcileStats, String> {
    let stats = library::get_library_stats(conn).map_err(|e| e.to_string())?;
    let (local_count, local_duration, _) =
        library::get_local_file_stats(conn).map_err(|e| e.to_string())?;
    let rev = revision::get_revision(conn).map_err(|e| e.to_string())?;
    Ok(ReconcileStats {
        total_tracks: stats.total_tracks,
        local_file_count: local_count,
        total_duration: local_duration as f64,
        revision: rev,
    })
}

/// Delete a track from the library and record the removal to prevent re-addition on scan
pub fn delete_track(db: &Database, track_id: i64) -> Result<bool, String> {
    db.transaction(|conn| {
        // Fetch track info before deleting so we can record the removal
        let track = library::get_track_by_id(conn, track_id)?;
        let deleted = library::delete_track(conn, track_id)?;
        if deleted && let Some(track) = track {
            removed::record_removal(
                conn,
                &track.filepath,
                track.content_hash.as_deref(),
                track.remote_id.as_deref(),
            )?;
        }
        Ok(deleted)
    })
    .map_err(|e| e.to_string())
}

/// Re-measure the library after a deletion so the caller can emit a reconcile
/// event with totals from the same connection that performed the delete.
pub fn reconcile_stats(db: &Database) -> Result<ReconcileStats, String> {
    let conn = db.conn().map_err(|e| e.to_string())?;
    get_reconcile_stats(&conn)
}

/// Purge all tracks marked as missing from the database
pub fn purge_missing(db: &Database) -> Result<usize, String> {
    db.transaction(library::delete_missing_tracks)
        .map_err(|e| e.to_string())
}

/// Delete multiple tracks by ID in a single transaction and record removals
pub fn delete_tracks(db: &Database, track_ids: &[i64]) -> Result<usize, String> {
    db.transaction(|conn| {
        // Fetch track info before deleting to record removals (single bulk query)
        let removals = removed::get_track_removal_info_bulk(conn, track_ids)?;

        let deleted = library::delete_tracks_by_ids(conn, track_ids)?;

        if !removals.is_empty() {
            removed::record_removals_bulk(conn, &removals)?;
        }

        Ok(deleted)
    })
    .map_err(|e| e.to_string())
}

/// Delete ALL tracks from the library (favorites, playlist_items, library rows).
/// Also clears the removed tracks list for a clean slate.
pub fn delete_all(db: &Database) -> Result<usize, String> {
    db.transaction(|conn| {
        let deleted = library::delete_all_tracks(conn)?;
        removed::clear_all_removals(conn)?;
        Ok(deleted)
    })
    .map_err(|e| e.to_string())
}

/// Rescan a track's metadata from its file.
///
/// The artwork cache is the desktop's to invalidate — a stale cover survives a
/// metadata rewrite until something drops it — so the caller invalidates it
/// with the returned track ID.
pub fn rescan_track(db: &Database, track_id: i64) -> Result<Track, String> {
    let conn = db.conn().map_err(|e| e.to_string())?;

    // Get the existing track
    let track = library::get_track_by_id(&conn, track_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Track with id {} not found", track_id))?;

    // Extract fresh metadata (use or_default to handle files with malformed tags)
    let extracted = extract_metadata_or_default(&track.filepath);

    // Convert to TrackMetadata for update
    let metadata = TrackMetadata {
        title: extracted.title,
        artist: extracted.artist,
        album: extracted.album,
        album_artist: extracted.album_artist,
        track_number: extracted.track_number,
        track_total: extracted.track_total,
        disc_number: extracted.disc_number.map(|n| n.to_string()),
        disc_total: extracted.disc_total.map(|n| n.to_string()),
        date: extracted.date,
        genre: extracted.genre,
        duration: extracted.duration,
        file_size: Some(extracted.file_size),
        file_mtime_ns: extracted.file_mtime_ns,
        file_ctime_ns: None,
        file_inode: None,
        content_hash: None,
    };

    // Update in database
    library::update_track_metadata(&conn, track_id, &metadata).map_err(|e| e.to_string())?;

    // Get updated track
    library::get_track_by_id(&conn, track_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Track not found after update".to_string())
}

/// Increment play count for a track
pub fn update_play_count(db: &Database, track_id: i64) -> Result<Track, String> {
    let conn = db.conn().map_err(|e| e.to_string())?;

    library::update_play_count(&conn, track_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Track with id {} not found", track_id))
}

/// What [`locate_track`] did, so the caller can announce both halves of it.
#[derive(Debug)]
pub struct LocateTrackOutcome {
    /// The track that was located, with its new filepath.
    pub track: Track,
    /// A duplicate found at the new path, which was deleted to keep this
    /// track's play history and favorites. `None` in the ordinary case.
    pub deleted_duplicate_id: Option<i64>,
}

/// Update a missing track's filepath after user locates the file.
/// If the new path already exists as another track (duplicate), the duplicate is removed
/// and the original track's path is updated (preserving play history, favorites, etc.)
pub fn locate_track(
    db: &Database,
    track_id: i64,
    new_path: &str,
) -> Result<LocateTrackOutcome, String> {
    // Verify the new path exists
    if !Path::new(&new_path).exists() {
        return Err(format!("File not found: {}", new_path));
    }

    let conn = db.conn().map_err(|e| e.to_string())?;

    // Verify the track exists
    library::get_track_by_id(&conn, track_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Track with id {} not found", track_id))?;

    // Check if another track already exists at the new path (duplicate scenario)
    // This can happen when:
    // 1. A file was moved, creating a "missing" track at old path
    // 2. The watcher detected the file at new location and added it as a "new" track
    // 3. User uses "Locate" to point the missing track to the same file
    let mut deleted_duplicate_id: Option<i64> = None;
    if let Ok(Some(existing_track)) = library::get_track_by_filepath(&conn, new_path)
        && existing_track.id != track_id
    {
        // There's a duplicate track at this path - remove it
        // The original track (being located) takes precedence to preserve play history
        debug!(
            duplicate_id = existing_track.id,
            path = %new_path,
            kept_id = track_id,
            "Removing duplicate track at path (keeping original)"
        );
        library::delete_track(&conn, existing_track.id).map_err(|e| e.to_string())?;
        deleted_duplicate_id = Some(existing_track.id);
    }

    // Update the filepath (also clears missing flag and updates last_seen_at)
    library::update_track_filepath(&conn, track_id, new_path).map_err(|e| e.to_string())?;

    // Get updated track
    let updated_track = library::get_track_by_id(&conn, track_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Track not found after update".to_string())?;

    Ok(LocateTrackOutcome {
        track: updated_track,
        deleted_duplicate_id,
    })
}

/// Check if a track's file exists and update its missing status
pub fn check_status(db: &Database, track_id: i64) -> Result<Track, String> {
    let conn = db.conn().map_err(|e| e.to_string())?;

    library::check_and_update_track_status(&conn, track_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Track with id {} not found", track_id))
}

/// Manually mark a track as missing
pub fn mark_missing(db: &Database, track_id: i64) -> Result<Track, String> {
    let conn = db.conn().map_err(|e| e.to_string())?;

    let marked = library::mark_track_missing(&conn, track_id).map_err(|e| e.to_string())?;

    if !marked {
        return Err(format!("Track with id {} not found", track_id));
    }

    library::get_track_by_id(&conn, track_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Track not found after marking".to_string())
}

/// Manually mark a track as present (not missing)
pub fn mark_present(db: &Database, track_id: i64) -> Result<Track, String> {
    let conn = db.conn().map_err(|e| e.to_string())?;

    let marked = library::mark_track_present(&conn, track_id).map_err(|e| e.to_string())?;

    if !marked {
        return Err(format!("Track with id {} not found", track_id));
    }

    library::get_track_by_id(&conn, track_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Track not found after marking".to_string())
}

#[cfg(test)]
#[path = "mutations_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "mutations_track_tests.rs"]
mod track_tests;
