//! Transitional schema contract. Rust is the sole migrator until TASK-393.26.

use rusqlite::{Connection, Transaction, TransactionBehavior};

use super::{DbError, DbResult, schema};

/// Version 1 is the complete pre-Zig-write schema, including artist sort keys.
/// Version 0 means unversioned (possibly populated), never "safe to reset".
pub const SCHEMA_VERSION: i32 = 1;

/// Refuse incompatible databases without changing them. Non-migrators use this.
pub fn check_schema_version(conn: &Connection) -> DbResult<()> {
    let found = schema_version(conn)?;
    if found != SCHEMA_VERSION {
        return Err(DbError::SchemaVersion {
            found,
            expected: SCHEMA_VERSION,
        });
    }
    Ok(())
}

fn schema_version(conn: &Connection) -> DbResult<i32> {
    Ok(conn.query_row("PRAGMA user_version", [], |row| row.get(0))?)
}

/// Initialize or adopt a legacy database atomically, checking the version again
/// under the writer lock. A second process must wait, then observe the commit.
/// Dropping the transaction rolls back DDL, backfills and user_version together.
pub(crate) fn initialize(conn: &Connection) -> DbResult<()> {
    let tx = Transaction::new_unchecked(conn, TransactionBehavior::Immediate)?;
    match schema_version(&tx)? {
        SCHEMA_VERSION => {}
        0 => {
            validate_legacy_or_empty(&tx)?;
            schema::create_tables(&tx)?;
            schema::run_migrations(&tx)?;
            tx.pragma_update(None, "user_version", SCHEMA_VERSION)?;
        }
        found => {
            return Err(DbError::SchemaVersion {
                found,
                expected: SCHEMA_VERSION,
            });
        }
    }
    tx.commit()?;
    Ok(())
}

fn validate_legacy_or_empty(conn: &Connection) -> DbResult<()> {
    let tables: i64 = conn.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'",
        [],
        |row| row.get(0),
    )?;
    if tables == 0 {
        return Ok(());
    }
    // These predate all supported incremental upgrades. Do not adopt an
    // unrelated/partial database just because SQLite defaults its version to 0.
    conn.prepare("SELECT id, filepath, artist, album, album_artist, play_count, last_played FROM library LIMIT 0")
        .map_err(|e| DbError::LegacySchema(e.to_string()))?;
    conn.prepare("SELECT key, value FROM settings LIMIT 0")
        .map_err(|e| DbError::LegacySchema(e.to_string()))?;
    Ok(())
}

#[cfg(test)]
#[path = "version_test.rs"]
mod tests;
