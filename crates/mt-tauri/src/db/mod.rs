//! Database module for mt music player.
//!
//! This module provides SQLite database access with connection pooling,
//! matching the schema and functionality of the Python backend.

pub(crate) mod dedup;
pub(crate) mod favorites;
pub(crate) mod lastfm_loved;
pub(crate) mod library;
pub(crate) mod lyrics;
pub(crate) mod models;
pub(crate) mod playlists;
pub(crate) mod queue;
pub(crate) mod removed;
pub(crate) mod revision;
pub(crate) mod schema;
pub(crate) mod scrobble;
pub(crate) mod settings;
pub(crate) mod stats;
pub(crate) mod watched;

#[cfg(test)]
mod benchmarks;
#[cfg(test)]
mod compat_test;
#[cfg(test)]
mod dedup_scope_test;
#[cfg(test)]
mod fixture_gen;
#[cfg(test)]
mod sort_key_test;

use r2d2::{Pool, PooledConnection};
use r2d2_sqlite::SqliteConnectionManager;
use rusqlite::Connection;
use rusqlite::functions::FunctionFlags;
use std::path::Path;
use std::sync::Arc;
use thiserror::Error;
use tracing::{error, info};

#[cfg(test)]
pub(crate) use library::refresh_artist_sort_keys;
pub(crate) use models::*;

/// Whether the indexed `artist_sort_key` prefix-lookup path is enabled.
///
/// `MT_INDEXED_PREFIX_LOOKUP` (`1`/`true`/`TRUE`/`yes`) takes precedence over
/// the `settings` table key `feature.indexed_prefix_lookup` (`"1"`/`"true"`,
/// matching [`settings::set_setting`]'s boolean serialization); defaults to
/// off (the legacy `ROW_NUMBER()` path) when neither is set. Read fresh on
/// every call rather than cached, so a runtime settings toggle takes effect
/// on the next lookup instead of requiring a process restart — this is a
/// cheap point lookup, not a hot loop.
pub(crate) fn indexed_prefix_lookup_enabled(conn: &Connection) -> bool {
    let env_enabled = std::env::var("MT_INDEXED_PREFIX_LOOKUP")
        .map(|v| matches!(v.as_str(), "1" | "true" | "TRUE" | "yes"))
        .unwrap_or(false);
    if env_enabled {
        return true;
    }
    conn.query_row(
        "SELECT value FROM settings WHERE key = 'feature.indexed_prefix_lookup'",
        [],
        |row| row.get::<_, String>(0),
    )
    .map(|v| v == "1" || v == "true")
    .unwrap_or(false)
}

/// Database error types
#[derive(Error, Debug)]
pub enum DbError {
    #[error("SQLite error: {0}")]
    Sqlite(#[from] rusqlite::Error),

    #[error("Connection pool error: {0}")]
    Pool(#[from] r2d2::Error),

    #[allow(dead_code)]
    #[error("Record not found: {0}")]
    NotFound(String),

    #[allow(dead_code)]
    #[error("Constraint violation: {0}")]
    Constraint(String),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
}

pub type DbResult<T> = Result<T, DbError>;

/// Database connection pool type alias
pub type DbPool = Pool<SqliteConnectionManager>;
pub type DbConnection = PooledConnection<SqliteConnectionManager>;

/// Register custom SQLite functions on a connection.
/// Called from `with_init` so every pooled connection has them available.
fn register_custom_functions(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.create_scalar_function(
        "strip_sort_prefix",
        2,
        FunctionFlags::SQLITE_UTF8 | FunctionFlags::SQLITE_DETERMINISTIC,
        |ctx| {
            let value: Option<String> = ctx.get(0)?;
            let prefixes: Option<String> = ctx.get(1)?;
            let Some(value) = value else {
                return Ok(None);
            };
            let Some(prefixes) = prefixes else {
                return Ok(Some(value));
            };
            Ok(Some(
                models::strip_sort_prefix(&value, &prefixes).to_string(),
            ))
        },
    )?;
    Ok(())
}

/// Main database interface with connection pooling
#[derive(Clone)]
pub struct Database {
    pool: Arc<DbPool>,
}

impl Database {
    /// Create a new database connection pool
    ///
    /// # Arguments
    /// * `db_path` - Path to the SQLite database file
    ///
    /// # Returns
    /// A new Database instance with initialized schema
    pub(crate) fn new<P: AsRef<Path>>(db_path: P) -> DbResult<Self> {
        info!(path = %db_path.as_ref().display(), "Opening database");
        let manager = SqliteConnectionManager::file(db_path).with_init(|conn| {
            // Per-connection PRAGMAs: applied to every new connection from the pool.
            // busy_timeout MUST be set so concurrent writers wait instead of
            // getting an immediate SQLITE_BUSY, which can corrupt SQLite
            // internal state when multiple tokio tasks write simultaneously.
            conn.execute_batch(
                "
                PRAGMA busy_timeout = 5000;
                PRAGMA synchronous = NORMAL;
                PRAGMA foreign_keys = ON;
                PRAGMA cache_size = -64000;
                ",
            )?;
            register_custom_functions(conn)
        });
        let pool = Pool::builder()
            .max_size(4)
            .min_idle(Some(1))
            .build(manager)?;

        let db = Self {
            pool: Arc::new(pool),
        };

        // Initialize schema and run migrations
        db.init()?;

        Ok(db)
    }

    /// Create an in-memory database (useful for testing)
    #[allow(dead_code)]
    pub(crate) fn new_in_memory() -> DbResult<Self> {
        let manager = SqliteConnectionManager::memory().with_init(|conn| {
            conn.execute_batch(
                "
                PRAGMA busy_timeout = 5000;
                PRAGMA synchronous = NORMAL;
                PRAGMA foreign_keys = ON;
                PRAGMA cache_size = -64000;
                ",
            )?;
            register_custom_functions(conn)
        });
        let pool = Pool::builder().max_size(1).build(manager)?;

        let db = Self {
            pool: Arc::new(pool),
        };

        db.init()?;

        Ok(db)
    }

    /// Initialize the database schema and run migrations
    fn init(&self) -> DbResult<()> {
        info!("Running schema init and migrations");
        let conn = self.pool.get()?;

        // Database-level PRAGMA (persists across connections once set)
        conn.execute_batch("PRAGMA journal_mode = WAL;")?;

        // Create tables
        schema::create_tables(&conn)?;

        // Run migrations
        schema::run_migrations(&conn)?;

        Ok(())
    }

    /// Get a connection from the pool
    pub(crate) fn conn(&self) -> DbResult<DbConnection> {
        Ok(self.pool.get()?)
    }

    /// Execute a function with a connection, enabling foreign keys
    pub(crate) fn with_conn<F, T>(&self, f: F) -> DbResult<T>
    where
        F: FnOnce(&Connection) -> DbResult<T>,
    {
        let conn = self.conn()?;
        conn.execute("PRAGMA foreign_keys = ON", [])?;
        f(&conn)
    }

    /// Execute a function within a transaction
    pub(crate) fn transaction<F, T>(&self, f: F) -> DbResult<T>
    where
        F: FnOnce(&Connection) -> DbResult<T>,
    {
        let mut conn = self.conn()?;
        conn.execute("PRAGMA foreign_keys = ON", [])?;

        let tx = conn.transaction()?;
        let result = match f(&tx) {
            Ok(val) => val,
            Err(e) => {
                error!(error = %e, "Transaction failed");
                return Err(e);
            }
        };
        tx.commit()?;

        Ok(result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_create_in_memory_database() {
        let db = Database::new_in_memory().expect("Failed to create in-memory database");
        let conn = db.conn().expect("Failed to get connection");

        // Verify tables exist
        let mut stmt = conn
            .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
            .unwrap();
        let tables: Vec<String> = stmt
            .query_map([], |row| row.get(0))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();

        assert!(tables.contains(&"library".to_string()));
        assert!(tables.contains(&"queue".to_string()));
        assert!(tables.contains(&"playlists".to_string()));
        assert!(tables.contains(&"favorites".to_string()));
        assert!(tables.contains(&"settings".to_string()));
    }

    #[test]
    fn test_pragma_settings() {
        let db = Database::new_in_memory().expect("Failed to create database");
        let conn = db.conn().expect("Failed to get connection");

        // Check WAL mode
        let journal_mode: String = conn
            .query_row("PRAGMA journal_mode", [], |row| row.get(0))
            .unwrap();
        // In-memory databases use "memory" journal mode, not WAL
        assert!(journal_mode == "wal" || journal_mode == "memory");

        // Check foreign keys enabled
        let fk_enabled: i32 = conn
            .query_row("PRAGMA foreign_keys", [], |row| row.get(0))
            .unwrap();
        assert_eq!(fk_enabled, 1);
    }

    #[test]
    fn test_strip_sort_prefix_strips_the() {
        let db = Database::new_in_memory().expect("Failed to create database");
        let conn = db.conn().expect("Failed to get connection");
        let result: String = conn
            .query_row(
                "SELECT strip_sort_prefix('The Beatles', 'the,a,an')",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(result, "Beatles");
    }

    #[test]
    fn test_strip_sort_prefix_strips_a() {
        let db = Database::new_in_memory().expect("Failed to create database");
        let conn = db.conn().expect("Failed to get connection");
        let result: String = conn
            .query_row(
                "SELECT strip_sort_prefix('A Night at the Opera', 'the,a,an')",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(result, "Night at the Opera");
    }

    #[test]
    fn test_strip_sort_prefix_case_insensitive() {
        let db = Database::new_in_memory().expect("Failed to create database");
        let conn = db.conn().expect("Failed to get connection");
        let result: String = conn
            .query_row(
                "SELECT strip_sort_prefix('THE ROLLING STONES', 'the')",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(result, "ROLLING STONES");
    }

    #[test]
    fn test_strip_sort_prefix_no_match() {
        let db = Database::new_in_memory().expect("Failed to create database");
        let conn = db.conn().expect("Failed to get connection");
        let result: String = conn
            .query_row(
                "SELECT strip_sort_prefix('Led Zeppelin', 'the,a,an')",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(result, "Led Zeppelin");
    }

    #[test]
    fn test_strip_sort_prefix_does_not_strip_partial() {
        let db = Database::new_in_memory().expect("Failed to create database");
        let conn = db.conn().expect("Failed to get connection");
        // "Therapy?" starts with "the" but not "the " (no space)
        let result: String = conn
            .query_row("SELECT strip_sort_prefix('Therapy?', 'the')", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(result, "Therapy?");
    }

    #[test]
    fn test_strip_sort_prefix_null_value() {
        let db = Database::new_in_memory().expect("Failed to create database");
        let conn = db.conn().expect("Failed to get connection");
        let result: Option<String> = conn
            .query_row("SELECT strip_sort_prefix(NULL, 'the,a,an')", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(result, None);
    }

    #[test]
    fn test_strip_sort_prefix_null_prefixes() {
        let db = Database::new_in_memory().expect("Failed to create database");
        let conn = db.conn().expect("Failed to get connection");
        let result: String = conn
            .query_row("SELECT strip_sort_prefix('The Beatles', NULL)", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(result, "The Beatles");
    }

    #[derive(serde::Deserialize)]
    struct StripSortPrefixCase {
        value: Option<String>,
        prefixes: Option<String>,
        expected: Option<String>,
        note: String,
    }

    /// Golden fixture shared with the Zig port's own test of the same UDF
    /// (`tests/fixtures/strip_sort_prefix.json`), so parity is proven by
    /// both sides reading one file rather than by a one-time hand port.
    #[test]
    fn test_strip_sort_prefix_golden_fixture() {
        let db = Database::new_in_memory().expect("Failed to create database");
        let conn = db.conn().expect("Failed to get connection");
        let fixture = std::fs::read_to_string(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../tests/fixtures/strip_sort_prefix.json"
        ))
        .expect("Failed to read strip_sort_prefix golden fixture");
        let cases: Vec<StripSortPrefixCase> =
            serde_json::from_str(&fixture).expect("Failed to parse strip_sort_prefix fixture");
        assert!(!cases.is_empty(), "golden fixture must not be empty");

        for case in cases {
            let result: Option<String> = conn
                .query_row(
                    "SELECT strip_sort_prefix(?1, ?2)",
                    rusqlite::params![case.value, case.prefixes],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(result, case.expected, "case: {}", case.note);
        }
    }
}
