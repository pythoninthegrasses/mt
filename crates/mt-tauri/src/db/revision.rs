//! Library revision counter for cache invalidation.
//!
//! Monotonic counter that increments on any library mutation (insert, delete, update).
//! The frontend compares revisions to decide whether cached data is stale.

use rusqlite::Connection;

use crate::db::DbResult;

/// Get the current library revision number.
pub(crate) fn get_revision(conn: &Connection) -> DbResult<i64> {
    let revision: i64 = conn.query_row(
        "SELECT revision FROM library_revision WHERE id = 1",
        [],
        |row| row.get(0),
    )?;
    Ok(revision)
}

/// Increment and return the new library revision number.
pub(crate) fn bump_revision(conn: &Connection) -> DbResult<i64> {
    conn.execute(
        "UPDATE library_revision SET revision = revision + 1 WHERE id = 1",
        [],
    )?;
    get_revision(conn)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema::{create_tables, run_migrations};

    fn setup_test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        create_tables(&conn).unwrap();
        run_migrations(&conn).unwrap();
        conn
    }

    #[test]
    fn test_initial_revision_is_zero() {
        let conn = setup_test_db();
        let rev = get_revision(&conn).unwrap();
        assert_eq!(rev, 0);
    }

    #[test]
    fn test_bump_revision_increments() {
        let conn = setup_test_db();
        let rev1 = bump_revision(&conn).unwrap();
        assert_eq!(rev1, 1);
        let rev2 = bump_revision(&conn).unwrap();
        assert_eq!(rev2, 2);
    }

    #[test]
    fn test_bump_revision_returns_new_value() {
        let conn = setup_test_db();
        for expected in 1..=5 {
            let rev = bump_revision(&conn).unwrap();
            assert_eq!(rev, expected);
        }
    }
}
