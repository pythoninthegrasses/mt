//! Fixtures shared by the `library` module's tests.
//!
//! Each test file covers one slice of the layer (query construction, paging,
//! sections, mutations, the reconcile pipeline) and stays under the 500-line
//! guideline; the row builders they all need live here instead of being
//! restated in each one. Helpers keep the exact column values they had when
//! they were local, because which row dedup deletes and what the footer totals
//! include both depend on them.

use std::fs;
use std::path::Path;
use std::sync::{Arc, Mutex};

use rusqlite::Connection;

use crate::db::schema::{create_tables, run_migrations};
use crate::db::{Database, TrackMetadata, library, removed};
use crate::library::reconcile::ReconcileProgress;

/// An empty database with the full schema, on a connection pool.
///
/// The pool holds a single connection, so drop any guard from [`sample_conn`]
/// before handing the database to a function that takes `&Database`.
pub(crate) fn sample_db() -> Database {
    Database::new_in_memory().unwrap()
}

/// A borrowed-connection database with the full schema, for the helpers that
/// take `&Connection` because the caller owns the transaction.
pub(crate) fn setup_conn() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    create_tables(&conn).unwrap();
    run_migrations(&conn).unwrap();
    conn
}

/// Add a track to a pooled database, without a file size.
pub(crate) fn add_track(db: &Database, index: i32, duration: f64) -> i64 {
    let conn = db.conn().unwrap();
    insert(
        &conn,
        &format!("/music/track{}.mp3", index),
        TrackMetadata {
            title: Some(format!("Track {}", index)),
            artist: Some(format!("Artist {}", index)),
            album: Some(format!("Album {}", index)),
            duration: Some(duration),
            ..Default::default()
        },
    )
}

/// Add a track to a pooled database, with a file size so the size-bearing
/// totals have something to measure.
pub(crate) fn add_sized_track(db: &Database, index: i32, duration: f64) -> i64 {
    let conn = db.conn().unwrap();
    insert(
        &conn,
        &format!("/music/track{}.mp3", index),
        TrackMetadata {
            title: Some(format!("Track {}", index)),
            artist: Some(format!("Artist {}", index)),
            album: Some(format!("Album {}", index)),
            duration: Some(duration),
            file_size: Some(1_000),
            ..Default::default()
        },
    )
}

/// Add a track to a borrowed connection.
pub(crate) fn add_conn_track(conn: &Connection, index: i32, duration: f64) -> i64 {
    insert(
        conn,
        &format!("/music/track{}.mp3", index),
        TrackMetadata {
            title: Some(format!("Track {}", index)),
            artist: Some(format!("Artist {}", index)),
            album: Some(format!("Album {}", index)),
            duration: Some(duration),
            ..Default::default()
        },
    )
}

/// Add a track at an exact path with exact metadata.
pub(crate) fn insert(conn: &Connection, filepath: &str, metadata: TrackMetadata) -> i64 {
    library::add_track(conn, filepath, &metadata).unwrap()
}

/// Turn a row into a streamed Plex track: `source` and `remote_id` together are
/// what the local-only totals and the frontend's remote-row filtering key off.
pub(crate) fn mark_remote(conn: &Connection, id: i64, remote_id: &str) {
    conn.execute(
        "UPDATE library SET source = 'plex', remote_id = ? WHERE id = ?",
        rusqlite::params![remote_id, id],
    )
    .unwrap();
}

/// Write a throwaway file for the paths that check existence on disk. It is not
/// audio, which is what makes `rescan_track` exercise its tagless fallback.
pub(crate) fn write_temp_file(dir: &Path, name: &str) -> String {
    let path = dir.join(name);
    fs::write(&path, b"not actually audio").unwrap();
    path.to_str().unwrap().to_string()
}

pub(crate) fn track_count(db: &Database) -> i64 {
    let conn = db.conn().unwrap();
    conn.query_row("SELECT COUNT(*) FROM library", [], |row| row.get(0))
        .unwrap()
}

pub(crate) fn removal_count(db: &Database) -> i64 {
    let conn = db.conn().unwrap();
    conn.query_row("SELECT COUNT(*) FROM removed_tracks", [], |row| row.get(0))
        .unwrap()
}

pub(crate) fn filepath_is_removed(db: &Database, filepath: &str) -> bool {
    let conn = db.conn().unwrap();
    removed::is_filepath_removed(&conn, filepath).unwrap()
}

/// Create `count` files with distinct bytes so their content hashes differ.
pub(crate) fn write_music_files(dir: &Path, count: usize) -> Vec<String> {
    (0..count)
        .map(|i| {
            let path = dir.join(format!("track{i}.mp3"));
            fs::write(&path, format!("audio payload number {i}").as_bytes()).unwrap();
            path.to_str().unwrap().to_string()
        })
        .collect()
}

/// Add a row the fingerprint backfill will pick up: both fingerprint columns
/// NULL is exactly what selects it.
pub(crate) fn add_backfill_candidate(conn: &Connection, filepath: &str) -> i64 {
    insert(
        conn,
        filepath,
        TrackMetadata {
            title: Some("Candidate".to_string()),
            duration: Some(60.0),
            content_hash: None,
            file_inode: None,
            ..Default::default()
        },
    )
}

/// Pin which member of a duplicate group survives.
///
/// Dedup keeps `added_date ASC`, but `CURRENT_TIMESTAMP` only has second
/// resolution, so rows added inside one test are tied and SQLite's order is
/// unspecified. Anything asserting *which* id was deleted sets these explicitly.
pub(crate) fn set_added_date(conn: &Connection, id: i64, added_date: &str) {
    conn.execute(
        "UPDATE library SET added_date = ? WHERE id = ?",
        rusqlite::params![added_date, id],
    )
    .unwrap();
}

/// One phase callback: `(phase, done, total)`.
type PhaseCall = (&'static str, u32, u32);

/// Records every pipeline callback in call order. The pipeline reports from
/// rayon worker threads, hence the shared `Arc<Mutex<..>>`.
#[derive(Clone, Default)]
pub(crate) struct RecordingProgress {
    calls: Arc<Mutex<Vec<PhaseCall>>>,
}

impl RecordingProgress {
    pub(crate) fn new() -> Self {
        Self::default()
    }

    fn record(&self, phase: &'static str, done: u32, total: u32) {
        self.calls.lock().unwrap().push((phase, done, total));
    }

    /// Every `(done, total)` reported for one phase.
    pub(crate) fn calls(&self, phase: &str) -> Vec<(u32, u32)> {
        self.calls
            .lock()
            .unwrap()
            .iter()
            .filter(|(name, _, _)| *name == phase)
            .map(|(_, done, total)| (*done, *total))
            .collect()
    }

    /// Phase names in order of first appearance, duplicates collapsed.
    pub(crate) fn phases(&self) -> Vec<&'static str> {
        let mut phases: Vec<&'static str> = Vec::new();
        for (name, _, _) in self.calls.lock().unwrap().iter() {
            if !phases.contains(name) {
                phases.push(*name);
            }
        }
        phases
    }
}

impl ReconcileProgress for RecordingProgress {
    fn fingerprinting(&self, done: u32, total: u32) {
        self.record("fingerprinting", done, total);
    }
    fn deduplicating(&self, done: u32, total: u32) {
        self.record("deduplicating", done, total);
    }
    fn cross_directory_dedup(&self, done: u32, total: u32) {
        self.record("cross_directory_dedup", done, total);
    }
    fn complete(&self, total: u32) {
        self.record("complete", total, total);
    }
}
