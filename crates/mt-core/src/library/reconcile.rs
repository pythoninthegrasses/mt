//! The reconcile pipeline: fingerprint backfill, deduplication, and
//! cross-directory suppression.
//!
//! The desktop `run_backfill_and_dedup` grew around three things that do not
//! belong in the core: `AppHandle` progress events, a `settings.json` read, and
//! a reconcile emission. All three are now the caller's — the pipeline reports
//! progress through [`ReconcileProgress`], takes the cross-directory setting as
//! a parameter, and returns the deleted IDs with the totals measured beside
//! them.

use std::sync::atomic::{AtomicU32, Ordering};

use rayon::prelude::*;
use rusqlite::Connection;
use tracing::info;

use crate::db::{TrackMetadata, dedup, library, revision, watched};
use crate::scanner::fingerprint::{FileFingerprint, compute_content_hash};
use crate::scanner::metadata::extract_metadata_or_default;

/// Progress of [`run_backfill_and_dedup`], reported at the same points the
/// desktop command used to emit `reconcile-progress` events.
///
/// Implemented by the desktop adapter over its event payload, which keeps the
/// wire format out of the core. The trait is `Sync` because phase 1 reports
/// progress from inside a `rayon` map.
pub trait ReconcileProgress: Sync {
    fn fingerprinting(&self, done: u32, total: u32);
    fn deduplicating(&self, done: u32, total: u32);
    fn cross_directory_dedup(&self, done: u32, total: u32);
    fn complete(&self, total: u32);
}

#[derive(Clone, Debug, serde::Serialize)]
pub struct ReconcileScanResult {
    pub backfilled: u32,
    pub duplicates_merged: u32,
    pub cross_directory_suppressed: u32,
    pub reinstated: u32,
    pub errors: u32,
}

/// What dedup removed, with the totals measured on the same connection
/// immediately afterwards.
///
/// `total_duration` here is the library-wide figure (`get_library_stats`), not
/// the local-only figure the delete path reports with
/// [`crate::library::mutations::ReconcileStats`]: the two disagree as soon as a
/// remote Plex track is in the library, and each event has carried its own
/// figure since they were written.
#[derive(Debug)]
pub struct DedupReconcile {
    pub deleted_ids: Vec<i64>,
    pub total_tracks: i64,
    pub local_file_count: i64,
    pub total_duration: f64,
    pub revision: i64,
}

/// Outcome of [`run_backfill_and_dedup`]: counters for the caller's log and
/// response, plus what dedup deleted so the caller can emit one reconcile event.
#[derive(Debug)]
pub struct BackfillOutcome {
    pub result: ReconcileScanResult,
    /// `None` when dedup deleted nothing, which is when no event is due.
    pub dedup: Option<DedupReconcile>,
}

/// Run fingerprint backfill, within-directory dedup, and cross-directory dedup.
///
/// Shared between the manual reconcile scan command and the automatic
/// post-scan backfill. Runs on the calling thread (expected to be called
/// from `spawn_blocking`).
///
/// `dedup_enabled` is the `library.deduplicateAcrossDirectories` setting: when
/// it is off, existing suppressions are undone instead of new ones being made,
/// so turning it off restores the tracks it had hidden.
pub fn run_backfill_and_dedup(
    conn: &Connection,
    dedup_enabled: bool,
    progress: &dyn ReconcileProgress,
) -> Result<BackfillOutcome, String> {
    let tracks = library::get_tracks_needing_fingerprints(conn).map_err(|e| e.to_string())?;
    let total = tracks.len() as u32;

    // Phase 1: compute fingerprints and hashes in parallel
    progress.fingerprinting(0, total);

    let processed = AtomicU32::new(0);
    let fp_errors = AtomicU32::new(0);

    let results: Vec<_> = tracks
        .par_iter()
        .map(|track| {
            let path = std::path::Path::new(&track.filepath);
            if !path.exists() {
                let count = processed.fetch_add(1, Ordering::Relaxed) + 1;
                if count.is_multiple_of(100) || count == total {
                    progress.fingerprinting(count, total);
                }
                return (track.id, None, None);
            }

            let fingerprint = match FileFingerprint::from_path(path) {
                Ok(fp) => Some(fp),
                Err(_) => {
                    fp_errors.fetch_add(1, Ordering::Relaxed);
                    None
                }
            };

            let content_hash = match compute_content_hash(path) {
                Ok(h) => Some(h),
                Err(_) => {
                    fp_errors.fetch_add(1, Ordering::Relaxed);
                    None
                }
            };

            let count = processed.fetch_add(1, Ordering::Relaxed) + 1;
            if count.is_multiple_of(100) || count == total {
                progress.fingerprinting(count, total);
            }

            (track.id, fingerprint, content_hash)
        })
        .collect();

    // Phase 1b: sequential DB writes for fingerprint backfill
    let mut backfilled = 0u32;
    let mut errors = fp_errors.load(Ordering::Relaxed);

    for (track_id, fingerprint, content_hash) in &results {
        // Write whatever we have — fingerprint, content_hash, or both
        if fingerprint.is_none() && content_hash.is_none() {
            continue;
        }

        let inode = fingerprint.and_then(|fp| fp.inode);
        match library::update_track_fingerprints(conn, *track_id, inode, content_hash.as_deref()) {
            Ok(true) => backfilled += 1,
            Ok(false) => {}
            Err(_) => errors += 1,
        }
    }

    // Fetch watched folder paths early — needed by Phase 2 (to scope hash dedup
    // to within-directory only) and Phase 3 (cross-directory dedup).
    let watched_folders = watched::get_watched_folders(conn).unwrap_or_default();
    let folder_paths: Vec<String> = watched_folders.iter().map(|f| f.path.clone()).collect();

    // Phase 2: deduplication (within-directory only)
    progress.deduplicating(0, 0);

    let mut duplicates_merged = 0u32;
    let mut deleted_ids = Vec::new();

    let inode_dups = library::find_duplicates_by_inode(conn).map_err(|e| e.to_string())?;
    let dup_total = inode_dups.len() as u32;
    for (i, group) in inode_dups.iter().enumerate() {
        if group.len() < 2 {
            continue;
        }
        let keep = &group[0];
        for dup in &group[1..] {
            match library::merge_duplicate_tracks(conn, keep.id, dup.id) {
                Ok(true) => {
                    duplicates_merged += 1;
                    deleted_ids.push(dup.id);
                }
                Ok(false) => {}
                Err(_) => errors += 1,
            }
        }
        if (i as u32 + 1).is_multiple_of(100) {
            progress.deduplicating(i as u32 + 1, dup_total);
        }
    }

    // Hash dedup: filter to within-directory groups only so cross-directory
    // duplicates are handled by Phase 3 (which writes suppression rows).
    let hash_dups = library::find_duplicates_by_content_hash(conn).map_err(|e| e.to_string())?;
    let hash_dups = library::filter_within_directory_groups(hash_dups, &folder_paths);
    for group in hash_dups {
        if group.len() < 2 {
            continue;
        }
        let keep = &group[0];
        for dup in &group[1..] {
            if deleted_ids.contains(&dup.id) {
                continue;
            }
            match library::merge_duplicate_tracks(conn, keep.id, dup.id) {
                Ok(true) => {
                    duplicates_merged += 1;
                    deleted_ids.push(dup.id);
                }
                Ok(false) => {}
                Err(_) => errors += 1,
            }
        }
    }

    // Phase 3: Cross-directory dedup
    progress.cross_directory_dedup(0, 0);

    let mut cross_directory_suppressed = 0u32;
    let mut reinstated = 0u32;

    // Phase 3a: Reinstatement (always runs if there are suppression records)
    let suppression_count = dedup::count_suppressed(conn).unwrap_or(0);
    if suppression_count > 0 {
        match dedup::reinstate_missing_kept_tracks(conn, |filepath| {
            let path = std::path::Path::new(filepath);
            if !path.exists() {
                return None;
            }
            let extracted = extract_metadata_or_default(filepath);
            let content_hash = compute_content_hash(path).ok();
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
                file_ctime_ns: extracted.file_ctime_ns,
                file_inode: extracted.file_inode,
                content_hash,
            };
            library::add_track(conn, filepath, &metadata).ok()
        }) {
            Ok(r) => {
                reinstated = r.reinstated;
                errors += r.errors;
            }
            Err(e) => {
                info!(error = %e, "Reinstatement phase encountered error");
                errors += 1;
            }
        }
    }

    // Phase 3b: Cross-directory dedup
    if dedup_enabled {
        if folder_paths.len() >= 2 {
            match library::find_cross_directory_duplicates(conn, &folder_paths) {
                Ok(groups) => {
                    let group_total = groups.len() as u32;
                    for (i, group) in groups.iter().enumerate() {
                        if group.len() < 2 {
                            continue;
                        }
                        let keep = &group[0];
                        for dup in &group[1..] {
                            if deleted_ids.contains(&dup.id) {
                                continue;
                            }
                            let _ = dedup::suppress_track(
                                conn,
                                keep.id,
                                &dup.filepath,
                                dup.content_hash.as_deref(),
                                dup.file_ctime_ns,
                                dup.file_mtime_ns,
                            );
                            match library::merge_duplicate_tracks(conn, keep.id, dup.id) {
                                Ok(true) => {
                                    cross_directory_suppressed += 1;
                                    deleted_ids.push(dup.id);
                                }
                                Ok(false) => {}
                                Err(_) => errors += 1,
                            }
                        }
                        if (i as u32 + 1).is_multiple_of(100) || i as u32 + 1 == group_total {
                            progress.cross_directory_dedup(i as u32 + 1, group_total);
                        }
                    }
                }
                Err(e) => {
                    info!(error = %e, "Cross-directory dedup query failed");
                    errors += 1;
                }
            }
        }
    } else if suppression_count > 0 {
        match dedup::clear_all_suppressions(conn) {
            Ok(infos) => {
                for info in &infos {
                    let path = std::path::Path::new(&info.suppressed_filepath);
                    if !path.exists() {
                        continue;
                    }
                    let extracted = extract_metadata_or_default(&info.suppressed_filepath);
                    let content_hash = compute_content_hash(path).ok();
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
                        file_ctime_ns: extracted.file_ctime_ns,
                        file_inode: extracted.file_inode,
                        content_hash,
                    };
                    let _ = library::add_track(conn, &info.suppressed_filepath, &metadata);
                }
                info!(
                    count = infos.len(),
                    "Unsuppressed tracks (dedup setting disabled)"
                );
            }
            Err(e) => {
                info!(error = %e, "Failed to clear suppressions");
                errors += 1;
            }
        }
    }

    progress.complete(total);

    // Emit a single reconcile event with all deleted IDs and authoritative stats
    let dedup_reconcile = if !deleted_ids.is_empty() {
        let stats = library::get_library_stats(conn).map_err(|e| e.to_string())?;
        let (local_file_count, _, _) =
            library::get_local_file_stats(conn).map_err(|e| e.to_string())?;
        let rev = revision::get_revision(conn).map_err(|e| e.to_string())?;
        Some(DedupReconcile {
            deleted_ids,
            total_tracks: stats.total_tracks,
            local_file_count,
            total_duration: stats.total_duration as f64,
            revision: rev,
        })
    } else {
        None
    };

    Ok(BackfillOutcome {
        result: ReconcileScanResult {
            backfilled,
            duplicates_merged,
            cross_directory_suppressed,
            reinstated,
            errors,
        },
        dedup: dedup_reconcile,
    })
}

#[cfg(test)]
#[path = "reconcile_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "reconcile_cross_dir_tests.rs"]
mod cross_dir_tests;
