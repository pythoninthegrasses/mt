//! Database schema definitions and migrations.
//!
//! This module contains the SQL statements for creating tables and running
//! incremental migrations, matching the Python backend exactly.

use rusqlite::Connection;
use tracing::info;

use crate::db::DbResult;

/// SQL statements for creating all database tables
pub const CREATE_TABLES: &[(&str, &str)] = &[
    (
        "queue",
        "CREATE TABLE IF NOT EXISTS queue (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            filepath TEXT NOT NULL
        )",
    ),
    (
        "library",
        "CREATE TABLE IF NOT EXISTS library (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            filepath TEXT NOT NULL,
            title TEXT,
            artist TEXT,
            album TEXT,
            album_artist TEXT,
            track_number TEXT,
            track_total TEXT,
            disc_number TEXT,
            disc_total TEXT,
            date TEXT,
            genre TEXT,
            duration REAL,
            file_size INTEGER DEFAULT 0,
            file_mtime_ns INTEGER,
            added_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            last_played TIMESTAMP,
            play_count INTEGER DEFAULT 0
        )",
    ),
    (
        "settings",
        "CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT
        )",
    ),
    (
        "favorites",
        "CREATE TABLE IF NOT EXISTS favorites (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            track_id INTEGER NOT NULL,
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (track_id) REFERENCES library(id),
            UNIQUE(track_id)
        )",
    ),
    (
        "lyrics_cache",
        "CREATE TABLE IF NOT EXISTS lyrics_cache (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            artist TEXT NOT NULL,
            title TEXT NOT NULL,
            album TEXT,
            lyrics TEXT,
            source_url TEXT,
            fetched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(artist, title)
        )",
    ),
    (
        "playlists",
        "CREATE TABLE IF NOT EXISTS playlists (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            position INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )",
    ),
    (
        "playlist_items",
        "CREATE TABLE IF NOT EXISTS playlist_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            playlist_id INTEGER NOT NULL,
            track_id INTEGER NOT NULL,
            position INTEGER NOT NULL,
            added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(playlist_id, track_id),
            FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
            FOREIGN KEY (track_id) REFERENCES library(id) ON DELETE CASCADE
        )",
    ),
    (
        "scrobble_queue",
        "CREATE TABLE IF NOT EXISTS scrobble_queue (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            artist TEXT NOT NULL,
            track TEXT NOT NULL,
            album TEXT,
            timestamp INTEGER NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            retry_count INTEGER DEFAULT 0
        )",
    ),
    (
        "watched_folders",
        "CREATE TABLE IF NOT EXISTS watched_folders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            path TEXT NOT NULL UNIQUE,
            mode TEXT NOT NULL DEFAULT 'startup',
            cadence_minutes INTEGER DEFAULT 10,
            enabled INTEGER NOT NULL DEFAULT 1,
            last_scanned_at INTEGER,
            created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
            updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
        )",
    ),
    (
        "queue_state",
        "CREATE TABLE IF NOT EXISTS queue_state (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            current_index INTEGER DEFAULT -1,
            shuffle_enabled INTEGER DEFAULT 0,
            loop_mode TEXT DEFAULT 'none',
            original_order_json TEXT
        )",
    ),
    (
        "lastfm_loved_tracks",
        "CREATE TABLE IF NOT EXISTS lastfm_loved_tracks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            artist TEXT NOT NULL,
            track TEXT NOT NULL,
            loved_at INTEGER,
            matched_track_id INTEGER,
            last_checked_at INTEGER,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(artist, track),
            FOREIGN KEY (matched_track_id) REFERENCES library(id) ON DELETE SET NULL
        )",
    ),
    (
        "removed_tracks",
        "CREATE TABLE IF NOT EXISTS removed_tracks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            filepath TEXT NOT NULL,
            content_hash TEXT,
            removed_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
            UNIQUE(filepath)
        )",
    ),
    (
        "play_history",
        "CREATE TABLE IF NOT EXISTS play_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            track_id INTEGER NOT NULL,
            played_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
            FOREIGN KEY (track_id) REFERENCES library(id) ON DELETE CASCADE
        )",
    ),
    (
        "library_revision",
        "CREATE TABLE IF NOT EXISTS library_revision (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            revision INTEGER NOT NULL DEFAULT 0
        )",
    ),
];

/// Create all database tables
pub(crate) fn create_tables(conn: &Connection) -> DbResult<()> {
    for (_, sql) in CREATE_TABLES {
        conn.execute(sql, [])?;
    }
    // Seed the singleton revision row
    conn.execute(
        "INSERT OR IGNORE INTO library_revision (id, revision) VALUES (1, 0)",
        [],
    )?;
    Ok(())
}

/// Run database migrations for schema updates
///
/// These migrations match the Python backend's migration logic exactly
/// to ensure backward compatibility with existing databases.
pub(crate) fn run_migrations(conn: &Connection) -> DbResult<()> {
    // Get current library columns
    let library_columns = get_table_columns(conn, "library")?;

    // Migration: Add file_size column to library table
    if !library_columns.contains(&"file_size".to_string()) {
        info!("Adding file_size column to library table");
        conn.execute(
            "ALTER TABLE library ADD COLUMN file_size INTEGER DEFAULT 0",
            [],
        )?;
        info!("file_size column added");
    }

    // Migration: Add position column to playlists table
    let playlist_columns = get_table_columns(conn, "playlists")?;
    if !playlist_columns.contains(&"position".to_string()) {
        info!("Adding position column to playlists table");
        conn.execute(
            "ALTER TABLE playlists ADD COLUMN position INTEGER DEFAULT 0",
            [],
        )?;

        // Initialize positions based on creation order
        let mut stmt = conn.prepare("SELECT id FROM playlists ORDER BY created_at ASC")?;
        let ids: Vec<i64> = stmt
            .query_map([], |row| row.get(0))?
            .filter_map(|r| r.ok())
            .collect();

        for (pos, id) in ids.iter().enumerate() {
            conn.execute(
                "UPDATE playlists SET position = ? WHERE id = ?",
                [pos as i64, *id],
            )?;
        }
        info!("position column added");
    }

    // Migration: Add filepath index for performance
    if !index_exists(conn, "idx_library_filepath")? {
        info!("Creating filepath index on library table");
        conn.execute("CREATE INDEX idx_library_filepath ON library(filepath)", [])?;
        info!("Filepath index created");
    }

    // Migration: Add file_mtime_ns column for change detection
    let library_columns = get_table_columns(conn, "library")?;
    if !library_columns.contains(&"file_mtime_ns".to_string()) {
        info!("Adding file_mtime_ns column to library table");
        conn.execute("ALTER TABLE library ADD COLUMN file_mtime_ns INTEGER", [])?;
        info!("file_mtime_ns column added");
    }

    // Migration: Add lastfm_loved column for Last.fm integration
    if !library_columns.contains(&"lastfm_loved".to_string()) {
        info!("Adding lastfm_loved column to library table");
        conn.execute(
            "ALTER TABLE library ADD COLUMN lastfm_loved BOOLEAN DEFAULT FALSE",
            [],
        )?;
        info!("lastfm_loved column added");
    }

    // Migration: Add missing track columns for file status tracking
    if !library_columns.contains(&"missing".to_string()) {
        info!("Adding missing column to library table");
        conn.execute(
            "ALTER TABLE library ADD COLUMN missing INTEGER DEFAULT 0",
            [],
        )?;
        info!("missing column added");
    }

    if !library_columns.contains(&"last_seen_at".to_string()) {
        info!("Adding last_seen_at column to library table");
        conn.execute("ALTER TABLE library ADD COLUMN last_seen_at INTEGER", [])?;
        info!("last_seen_at column added");
    }

    // Migration: Add file_inode column for move detection (same-volume)
    let library_columns = get_table_columns(conn, "library")?;
    if !library_columns.contains(&"file_inode".to_string()) {
        info!("Adding file_inode column to library table");
        conn.execute("ALTER TABLE library ADD COLUMN file_inode INTEGER", [])?;
        info!("file_inode column added");
    }

    // Migration: Add content_hash column for move detection (cross-volume fallback)
    if !library_columns.contains(&"content_hash".to_string()) {
        info!("Adding content_hash column to library table");
        conn.execute("ALTER TABLE library ADD COLUMN content_hash TEXT", [])?;
        info!("content_hash column added");
    }

    // Migration: Add index on file_inode for fast move detection lookups
    if !index_exists(conn, "idx_library_file_inode")? {
        info!("Creating file_inode index on library table");
        conn.execute(
            "CREATE INDEX idx_library_file_inode ON library(file_inode) WHERE file_inode IS NOT NULL",
            [],
        )?;
        info!("file_inode index created");
    }

    // Migration: Add index on content_hash for move detection fallback
    if !index_exists(conn, "idx_library_content_hash")? {
        info!("Creating content_hash index on library table");
        conn.execute(
            "CREATE INDEX idx_library_content_hash ON library(content_hash) WHERE content_hash IS NOT NULL",
            [],
        )?;
        info!("content_hash index created");
    }

    // Migration: Create lastfm_loved_tracks table for existing databases
    if !table_exists(conn, "lastfm_loved_tracks")? {
        info!("Creating lastfm_loved_tracks table");
        conn.execute(
            "CREATE TABLE lastfm_loved_tracks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                artist TEXT NOT NULL,
                track TEXT NOT NULL,
                loved_at INTEGER,
                matched_track_id INTEGER,
                last_checked_at INTEGER,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(artist, track),
                FOREIGN KEY (matched_track_id) REFERENCES library(id) ON DELETE SET NULL
            )",
            [],
        )?;
        info!("lastfm_loved_tracks table created");
    }

    // Migration: Add index on lastfm_loved_tracks for fast lookups on artist/track
    if !index_exists(conn, "idx_lastfm_loved_artist_track")? {
        info!("Creating artist/track index on lastfm_loved_tracks table");
        conn.execute(
            "CREATE INDEX idx_lastfm_loved_artist_track ON lastfm_loved_tracks(artist, track)",
            [],
        )?;
        info!("artist/track index created");
    }

    // Migration: Add partial index for unmatched loved tracks (common query pattern)
    if !index_exists(conn, "idx_lastfm_loved_unmatched")? {
        info!("Creating unmatched tracks index on lastfm_loved_tracks table");
        conn.execute(
            "CREATE INDEX idx_lastfm_loved_unmatched ON lastfm_loved_tracks(id) WHERE matched_track_id IS NULL",
            [],
        )?;
        info!("unmatched tracks index created");
    }

    // Migration: Add disc_number column for disc metadata
    let library_columns = get_table_columns(conn, "library")?;
    if !library_columns.contains(&"disc_number".to_string()) {
        info!("Adding disc_number column to library table");
        conn.execute("ALTER TABLE library ADD COLUMN disc_number TEXT", [])?;
        info!("disc_number column added");
    }

    // Migration: Add disc_total column for disc metadata
    if !library_columns.contains(&"disc_total".to_string()) {
        info!("Adding disc_total column to library table");
        conn.execute("ALTER TABLE library ADD COLUMN disc_total TEXT", [])?;
        info!("disc_total column added");
    }

    // Migration: Add genre column for track metadata
    if !library_columns.contains(&"genre".to_string()) {
        info!("Adding genre column to library table");
        conn.execute("ALTER TABLE library ADD COLUMN genre TEXT", [])?;
        info!("genre column added");
    }

    // Migration: Create removed_tracks table for existing databases
    if !table_exists(conn, "removed_tracks")? {
        info!("Creating removed_tracks table");
        conn.execute(
            "CREATE TABLE removed_tracks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                filepath TEXT NOT NULL,
                content_hash TEXT,
                removed_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
                UNIQUE(filepath)
            )",
            [],
        )?;
        info!("removed_tracks table created");
    }

    // Migration: Add index on removed_tracks filepath for fast lookups
    if !index_exists(conn, "idx_removed_tracks_filepath")? {
        info!("Creating filepath index on removed_tracks table");
        conn.execute(
            "CREATE INDEX idx_removed_tracks_filepath ON removed_tracks(filepath)",
            [],
        )?;
        info!("removed_tracks filepath index created");
    }

    // Migration: Add index on removed_tracks content_hash for hash-based lookups
    if !index_exists(conn, "idx_removed_tracks_content_hash")? {
        info!("Creating content_hash index on removed_tracks table");
        conn.execute(
            "CREATE INDEX idx_removed_tracks_content_hash ON removed_tracks(content_hash) WHERE content_hash IS NOT NULL",
            [],
        )?;
        info!("removed_tracks content_hash index created");
    }

    // Migration: Add composite index for artist sort (canonical album_artist subquery)
    // and the default secondary sort. Without this, ORDER BY with the correlated
    // CANONICAL_ALBUM_ARTIST subquery does a full table scan per row — O(n^2).
    if !index_exists(conn, "idx_library_album_artist_sort")? {
        info!("Creating album/artist sort index on library table");
        conn.execute(
            "CREATE INDEX idx_library_album_artist_sort ON library(album, album_artist, artist, missing)",
            [],
        )?;
        info!("album/artist sort index created");
    }

    // Migration: Create play_history table for listening statistics
    if !table_exists(conn, "play_history")? {
        info!("Creating play_history table");
        conn.execute(
            "CREATE TABLE play_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                track_id INTEGER NOT NULL,
                played_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
                FOREIGN KEY (track_id) REFERENCES library(id) ON DELETE CASCADE
            )",
            [],
        )?;
        info!("play_history table created");

        // Backfill from existing play data (one entry per track using last_played timestamp)
        let backfilled: usize = conn.execute(
            "INSERT INTO play_history (track_id, played_at)
             SELECT id, CAST(strftime('%s', last_played) AS INTEGER)
             FROM library
             WHERE play_count > 0 AND last_played IS NOT NULL",
            [],
        )?;
        if backfilled > 0 {
            info!(
                count = backfilled,
                "Backfilled play_history from existing library data"
            );
        }
    }

    // Migration: Add indexes on play_history for stats queries
    if !index_exists(conn, "idx_play_history_played_at")? {
        info!("Creating played_at index on play_history table");
        conn.execute(
            "CREATE INDEX idx_play_history_played_at ON play_history(played_at)",
            [],
        )?;
        info!("play_history played_at index created");
    }

    if !index_exists(conn, "idx_play_history_track_id")? {
        info!("Creating track_id index on play_history table");
        conn.execute(
            "CREATE INDEX idx_play_history_track_id ON play_history(track_id)",
            [],
        )?;
        info!("play_history track_id index created");
    }

    // Migration: Add file_ctime_ns column for creation time (birthtime)
    let library_columns = get_table_columns(conn, "library")?;
    if !library_columns.contains(&"file_ctime_ns".to_string()) {
        info!("Adding file_ctime_ns column to library table");
        conn.execute("ALTER TABLE library ADD COLUMN file_ctime_ns INTEGER", [])?;
        info!("file_ctime_ns column added");
    }

    // Migration: Create deduplicated_tracks table for cross-directory dedup
    if !table_exists(conn, "deduplicated_tracks")? {
        info!("Creating deduplicated_tracks table");
        conn.execute(
            "CREATE TABLE deduplicated_tracks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                kept_track_id INTEGER NOT NULL REFERENCES library(id),
                suppressed_filepath TEXT NOT NULL,
                suppressed_content_hash TEXT,
                suppressed_ctime_ns INTEGER,
                suppressed_mtime_ns INTEGER,
                deduplicated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
            )",
            [],
        )?;
        info!("deduplicated_tracks table created");
    }

    // Migration: Create library_revision table for cache invalidation
    if !table_exists(conn, "library_revision")? {
        info!("Creating library_revision table");
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS library_revision (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                revision INTEGER NOT NULL DEFAULT 0
            );
            INSERT OR IGNORE INTO library_revision (id, revision) VALUES (1, 0);",
        )?;
        info!("library_revision table created");
    }

    // Migration: Add indexes on deduplicated_tracks
    if !index_exists(conn, "idx_dedup_kept_track")? {
        info!("Creating kept_track_id index on deduplicated_tracks");
        conn.execute(
            "CREATE INDEX idx_dedup_kept_track ON deduplicated_tracks(kept_track_id)",
            [],
        )?;
        info!("kept_track_id index created");
    }

    if !index_exists(conn, "idx_dedup_content_hash")? {
        info!("Creating content_hash index on deduplicated_tracks");
        conn.execute(
            "CREATE INDEX idx_dedup_content_hash ON deduplicated_tracks(suppressed_content_hash)",
            [],
        )?;
        info!("content_hash index created");
    }

    Ok(())
}

/// Get column names for a table
fn get_table_columns(conn: &Connection, table: &str) -> DbResult<Vec<String>> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({})", table))?;
    let columns: Vec<String> = stmt
        .query_map([], |row| row.get::<_, String>(1))?
        .filter_map(|r| r.ok())
        .collect();
    Ok(columns)
}

/// Check if an index exists
fn index_exists(conn: &Connection, index_name: &str) -> DbResult<bool> {
    let count: i32 = conn.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name=?",
        [index_name],
        |row| row.get(0),
    )?;
    Ok(count > 0)
}

/// Check if a table exists
fn table_exists(conn: &Connection, table_name: &str) -> DbResult<bool> {
    let count: i32 = conn.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?",
        [table_name],
        |row| row.get(0),
    )?;
    Ok(count > 0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_create_all_tables() {
        let conn = Connection::open_in_memory().unwrap();
        create_tables(&conn).expect("Failed to create tables");

        // Verify all 10 tables exist
        let mut stmt = conn
            .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
            .unwrap();
        let tables: Vec<String> = stmt
            .query_map([], |row| row.get(0))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();

        assert_eq!(tables.len(), 14);
        assert!(tables.contains(&"library".to_string()));
        assert!(tables.contains(&"queue".to_string()));
        assert!(tables.contains(&"queue_state".to_string()));
        assert!(tables.contains(&"playlists".to_string()));
        assert!(tables.contains(&"playlist_items".to_string()));
        assert!(tables.contains(&"favorites".to_string()));
        assert!(tables.contains(&"settings".to_string()));
        assert!(tables.contains(&"scrobble_queue".to_string()));
        assert!(tables.contains(&"watched_folders".to_string()));
        assert!(tables.contains(&"lyrics_cache".to_string()));
        assert!(tables.contains(&"lastfm_loved_tracks".to_string()));
        assert!(tables.contains(&"removed_tracks".to_string()));
        assert!(tables.contains(&"play_history".to_string()));
        assert!(tables.contains(&"library_revision".to_string()));
    }

    #[test]
    fn test_migrations_idempotent() {
        let conn = Connection::open_in_memory().unwrap();
        create_tables(&conn).expect("Failed to create tables");

        // Run migrations twice - should not fail
        run_migrations(&conn).expect("First migration failed");
        run_migrations(&conn).expect("Second migration failed");

        // Verify columns exist
        let columns = get_table_columns(&conn, "library").unwrap();
        assert!(columns.contains(&"file_size".to_string()));
        assert!(columns.contains(&"file_mtime_ns".to_string()));
        assert!(columns.contains(&"missing".to_string()));
        assert!(columns.contains(&"last_seen_at".to_string()));
        assert!(columns.contains(&"file_inode".to_string()));
        assert!(columns.contains(&"content_hash".to_string()));
        // Metadata columns
        assert!(columns.contains(&"disc_number".to_string()));
        assert!(columns.contains(&"disc_total".to_string()));
        assert!(columns.contains(&"genre".to_string()));
        // Cross-directory dedup columns
        assert!(columns.contains(&"file_ctime_ns".to_string()));
    }

    #[test]
    fn test_deduplicated_tracks_table_created() {
        let conn = Connection::open_in_memory().unwrap();
        create_tables(&conn).expect("Failed to create tables");
        run_migrations(&conn).expect("Migrations failed");

        assert!(table_exists(&conn, "deduplicated_tracks").unwrap());

        // Verify indexes exist
        assert!(index_exists(&conn, "idx_dedup_kept_track").unwrap());
        assert!(index_exists(&conn, "idx_dedup_content_hash").unwrap());

        // Verify table schema has expected columns
        let columns = get_table_columns(&conn, "deduplicated_tracks").unwrap();
        assert!(columns.contains(&"id".to_string()));
        assert!(columns.contains(&"kept_track_id".to_string()));
        assert!(columns.contains(&"suppressed_filepath".to_string()));
        assert!(columns.contains(&"suppressed_content_hash".to_string()));
        assert!(columns.contains(&"suppressed_ctime_ns".to_string()));
        assert!(columns.contains(&"suppressed_mtime_ns".to_string()));
        assert!(columns.contains(&"deduplicated_at".to_string()));
    }
}
