//! Database schema definitions and migrations.
//!
//! This module contains the SQL statements for creating tables and running
//! incremental migrations, matching the Python backend exactly.

use rusqlite::Connection;

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
            date TEXT,
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
];

/// Create all database tables
pub fn create_tables(conn: &Connection) -> DbResult<()> {
    for (_, sql) in CREATE_TABLES {
        conn.execute(sql, [])?;
    }
    Ok(())
}

/// Run database migrations for schema updates
///
/// These migrations match the Python backend's migration logic exactly
/// to ensure backward compatibility with existing databases.
pub fn run_migrations(conn: &Connection) -> DbResult<()> {
    // Get current library columns
    let library_columns = get_table_columns(conn, "library")?;

    // Migration: Add file_size column to library table
    if !library_columns.contains(&"file_size".to_string()) {
        println!("[migration] Adding file_size column to library table...");
        conn.execute(
            "ALTER TABLE library ADD COLUMN file_size INTEGER DEFAULT 0",
            [],
        )?;
        println!("[migration] file_size column added successfully");
    }

    // Migration: Add position column to playlists table
    let playlist_columns = get_table_columns(conn, "playlists")?;
    if !playlist_columns.contains(&"position".to_string()) {
        println!("[migration] Adding position column to playlists table...");
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
        println!("[migration] position column added successfully");
    }

    // Migration: Add filepath index for performance
    if !index_exists(conn, "idx_library_filepath")? {
        println!("[migration] Creating filepath index on library table...");
        conn.execute("CREATE INDEX idx_library_filepath ON library(filepath)", [])?;
        println!("[migration] Filepath index created successfully");
    }

    // Migration: Add file_mtime_ns column for change detection
    let library_columns = get_table_columns(conn, "library")?;
    if !library_columns.contains(&"file_mtime_ns".to_string()) {
        println!("[migration] Adding file_mtime_ns column to library table...");
        conn.execute("ALTER TABLE library ADD COLUMN file_mtime_ns INTEGER", [])?;
        println!("[migration] file_mtime_ns column added successfully");
    }

    // Migration: Add lastfm_loved column for Last.fm integration
    if !library_columns.contains(&"lastfm_loved".to_string()) {
        println!("[migration] Adding lastfm_loved column to library table...");
        conn.execute(
            "ALTER TABLE library ADD COLUMN lastfm_loved BOOLEAN DEFAULT FALSE",
            [],
        )?;
        println!("[migration] lastfm_loved column added successfully");
    }

    // Migration: Add missing track columns for file status tracking
    if !library_columns.contains(&"missing".to_string()) {
        println!("[migration] Adding missing column to library table...");
        conn.execute(
            "ALTER TABLE library ADD COLUMN missing INTEGER DEFAULT 0",
            [],
        )?;
        println!("[migration] missing column added successfully");
    }

    if !library_columns.contains(&"last_seen_at".to_string()) {
        println!("[migration] Adding last_seen_at column to library table...");
        conn.execute("ALTER TABLE library ADD COLUMN last_seen_at INTEGER", [])?;
        println!("[migration] last_seen_at column added successfully");
    }

    // Migration: Add file_inode column for move detection (same-volume)
    let library_columns = get_table_columns(conn, "library")?;
    if !library_columns.contains(&"file_inode".to_string()) {
        println!("[migration] Adding file_inode column to library table...");
        conn.execute("ALTER TABLE library ADD COLUMN file_inode INTEGER", [])?;
        println!("[migration] file_inode column added successfully");
    }

    // Migration: Add content_hash column for move detection (cross-volume fallback)
    if !library_columns.contains(&"content_hash".to_string()) {
        println!("[migration] Adding content_hash column to library table...");
        conn.execute("ALTER TABLE library ADD COLUMN content_hash TEXT", [])?;
        println!("[migration] content_hash column added successfully");
    }

    // Migration: Add index on file_inode for fast move detection lookups
    if !index_exists(conn, "idx_library_file_inode")? {
        println!("[migration] Creating file_inode index on library table...");
        conn.execute(
            "CREATE INDEX idx_library_file_inode ON library(file_inode) WHERE file_inode IS NOT NULL",
            [],
        )?;
        println!("[migration] file_inode index created successfully");
    }

    // Migration: Add index on content_hash for move detection fallback
    if !index_exists(conn, "idx_library_content_hash")? {
        println!("[migration] Creating content_hash index on library table...");
        conn.execute(
            "CREATE INDEX idx_library_content_hash ON library(content_hash) WHERE content_hash IS NOT NULL",
            [],
        )?;
        println!("[migration] content_hash index created successfully");
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

        assert_eq!(tables.len(), 10);
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
    }
}
