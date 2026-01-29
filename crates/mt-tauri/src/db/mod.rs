//! Database module for mt music player.
//!
//! This module provides SQLite database access with connection pooling,
//! matching the schema and functionality of the Python backend.

pub mod favorites;
pub mod library;
pub mod models;
pub mod playlists;
pub mod queue;
pub mod schema;
pub mod scrobble;
pub mod settings;
pub mod watched;

#[cfg(test)]
mod benchmarks;
#[cfg(test)]
mod compat_test;

use r2d2::{Pool, PooledConnection};
use r2d2_sqlite::SqliteConnectionManager;
use rusqlite::Connection;
use std::path::Path;
use std::sync::Arc;
use thiserror::Error;

pub use models::*;

/// Database error types
#[derive(Error, Debug)]
pub enum DbError {
    #[error("SQLite error: {0}")]
    Sqlite(#[from] rusqlite::Error),

    #[error("Connection pool error: {0}")]
    Pool(#[from] r2d2::Error),

    #[error("Record not found: {0}")]
    NotFound(String),

    #[error("Constraint violation: {0}")]
    Constraint(String),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
}

pub type DbResult<T> = Result<T, DbError>;

/// Database connection pool type alias
pub type DbPool = Pool<SqliteConnectionManager>;
pub type DbConnection = PooledConnection<SqliteConnectionManager>;

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
    pub fn new<P: AsRef<Path>>(db_path: P) -> DbResult<Self> {
        let manager = SqliteConnectionManager::file(db_path);
        let pool = Pool::builder()
            .max_size(10)
            .min_idle(Some(2))
            .build(manager)?;

        let db = Self {
            pool: Arc::new(pool),
        };

        // Initialize schema and run migrations
        db.init()?;

        Ok(db)
    }

    /// Create an in-memory database (useful for testing)
    pub fn new_in_memory() -> DbResult<Self> {
        let manager = SqliteConnectionManager::memory();
        let pool = Pool::builder().max_size(1).build(manager)?;

        let db = Self {
            pool: Arc::new(pool),
        };

        db.init()?;

        Ok(db)
    }

    /// Initialize the database schema and run migrations
    fn init(&self) -> DbResult<()> {
        let conn = self.pool.get()?;

        // Enable performance optimizations
        conn.execute_batch(
            "
            PRAGMA journal_mode = WAL;
            PRAGMA synchronous = NORMAL;
            PRAGMA foreign_keys = ON;
            PRAGMA cache_size = -64000;
            ",
        )?;

        // Create tables
        schema::create_tables(&conn)?;

        // Run migrations
        schema::run_migrations(&conn)?;

        Ok(())
    }

    /// Get a connection from the pool
    pub fn conn(&self) -> DbResult<DbConnection> {
        Ok(self.pool.get()?)
    }

    /// Execute a function with a connection, enabling foreign keys
    pub fn with_conn<F, T>(&self, f: F) -> DbResult<T>
    where
        F: FnOnce(&Connection) -> DbResult<T>,
    {
        let conn = self.conn()?;
        conn.execute("PRAGMA foreign_keys = ON", [])?;
        f(&conn)
    }

    /// Execute a function within a transaction
    pub fn transaction<F, T>(&self, f: F) -> DbResult<T>
    where
        F: FnOnce(&Connection) -> DbResult<T>,
    {
        let mut conn = self.conn()?;
        conn.execute("PRAGMA foreign_keys = ON", [])?;

        let tx = conn.transaction()?;
        let result = f(&tx)?;
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
}
