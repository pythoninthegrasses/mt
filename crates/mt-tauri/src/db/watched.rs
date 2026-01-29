//! Watched folders database operations.
//!
//! Operations for watched folder configuration.

use rusqlite::{params, Connection};

use crate::db::{DbResult, WatchedFolder};

/// Get all watched folders
pub fn get_watched_folders(conn: &Connection) -> DbResult<Vec<WatchedFolder>> {
    let mut stmt = conn.prepare("SELECT * FROM watched_folders ORDER BY created_at ASC")?;

    let folders: Vec<WatchedFolder> = stmt
        .query_map([], |row| {
            Ok(WatchedFolder {
                id: row.get("id")?,
                path: row.get("path")?,
                mode: row.get("mode")?,
                cadence_minutes: row.get::<_, Option<i64>>("cadence_minutes")?.unwrap_or(10),
                enabled: row.get::<_, Option<i64>>("enabled")?.unwrap_or(0) != 0,
                last_scanned_at: row.get("last_scanned_at")?,
                created_at: row.get("created_at")?,
                updated_at: row.get("updated_at")?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();

    Ok(folders)
}

/// Get a watched folder by ID
pub fn get_watched_folder(conn: &Connection, folder_id: i64) -> DbResult<Option<WatchedFolder>> {
    match conn.query_row(
        "SELECT * FROM watched_folders WHERE id = ?",
        [folder_id],
        |row| {
            Ok(WatchedFolder {
                id: row.get("id")?,
                path: row.get("path")?,
                mode: row.get("mode")?,
                cadence_minutes: row.get::<_, Option<i64>>("cadence_minutes")?.unwrap_or(10),
                enabled: row.get::<_, Option<i64>>("enabled")?.unwrap_or(0) != 0,
                last_scanned_at: row.get("last_scanned_at")?,
                created_at: row.get("created_at")?,
                updated_at: row.get("updated_at")?,
            })
        },
    ) {
        Ok(folder) => Ok(Some(folder)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

/// Add a watched folder
pub fn add_watched_folder(
    conn: &Connection,
    path: &str,
    mode: &str,
    cadence_minutes: i64,
    enabled: bool,
) -> DbResult<Option<WatchedFolder>> {
    match conn.execute(
        "INSERT INTO watched_folders (path, mode, cadence_minutes, enabled) VALUES (?, ?, ?, ?)",
        params![path, mode, cadence_minutes, if enabled { 1 } else { 0 }],
    ) {
        Ok(_) => {
            let id = conn.last_insert_rowid();
            get_watched_folder(conn, id)
        }
        Err(rusqlite::Error::SqliteFailure(err, _))
            if err.code == rusqlite::ErrorCode::ConstraintViolation =>
        {
            Ok(None) // Path already exists
        }
        Err(e) => Err(e.into()),
    }
}

/// Update a watched folder
pub fn update_watched_folder(
    conn: &Connection,
    folder_id: i64,
    mode: Option<&str>,
    cadence_minutes: Option<i64>,
    enabled: Option<bool>,
) -> DbResult<Option<WatchedFolder>> {
    let mut updates = Vec::new();
    let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

    if let Some(m) = mode {
        updates.push("mode = ?");
        params_vec.push(Box::new(m.to_string()));
    }

    if let Some(c) = cadence_minutes {
        updates.push("cadence_minutes = ?");
        params_vec.push(Box::new(c));
    }

    if let Some(e) = enabled {
        updates.push("enabled = ?");
        params_vec.push(Box::new(if e { 1i64 } else { 0i64 }));
    }

    if updates.is_empty() {
        return get_watched_folder(conn, folder_id);
    }

    updates.push("updated_at = strftime('%s','now')");
    params_vec.push(Box::new(folder_id));

    let sql = format!(
        "UPDATE watched_folders SET {} WHERE id = ?",
        updates.join(", ")
    );

    let params_refs: Vec<&dyn rusqlite::ToSql> = params_vec.iter().map(|p| p.as_ref()).collect();
    conn.execute(&sql, params_refs.as_slice())?;

    get_watched_folder(conn, folder_id)
}

/// Update the last_scanned_at timestamp for a watched folder
pub fn update_watched_folder_last_scanned(conn: &Connection, folder_id: i64) -> DbResult<bool> {
    let updated = conn.execute(
        "UPDATE watched_folders SET last_scanned_at = strftime('%s','now'), updated_at = strftime('%s','now') WHERE id = ?",
        [folder_id],
    )?;
    Ok(updated > 0)
}

/// Remove a watched folder
pub fn remove_watched_folder(conn: &Connection, folder_id: i64) -> DbResult<bool> {
    let deleted = conn.execute("DELETE FROM watched_folders WHERE id = ?", [folder_id])?;
    Ok(deleted > 0)
}

/// Get enabled watched folders only
pub fn get_enabled_watched_folders(conn: &Connection) -> DbResult<Vec<WatchedFolder>> {
    let mut stmt =
        conn.prepare("SELECT * FROM watched_folders WHERE enabled = 1 ORDER BY created_at ASC")?;

    let folders: Vec<WatchedFolder> = stmt
        .query_map([], |row| {
            Ok(WatchedFolder {
                id: row.get("id")?,
                path: row.get("path")?,
                mode: row.get("mode")?,
                cadence_minutes: row.get::<_, Option<i64>>("cadence_minutes")?.unwrap_or(10),
                enabled: true,
                last_scanned_at: row.get("last_scanned_at")?,
                created_at: row.get("created_at")?,
                updated_at: row.get("updated_at")?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();

    Ok(folders)
}

/// Get watched folder by path
pub fn get_watched_folder_by_path(conn: &Connection, path: &str) -> DbResult<Option<WatchedFolder>> {
    match conn.query_row(
        "SELECT * FROM watched_folders WHERE path = ?",
        [path],
        |row| {
            Ok(WatchedFolder {
                id: row.get("id")?,
                path: row.get("path")?,
                mode: row.get("mode")?,
                cadence_minutes: row.get::<_, Option<i64>>("cadence_minutes")?.unwrap_or(10),
                enabled: row.get::<_, Option<i64>>("enabled")?.unwrap_or(0) != 0,
                last_scanned_at: row.get("last_scanned_at")?,
                created_at: row.get("created_at")?,
                updated_at: row.get("updated_at")?,
            })
        },
    ) {
        Ok(folder) => Ok(Some(folder)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.into()),
    }
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
    fn test_add_and_get_watched_folder() {
        let conn = setup_test_db();

        let folder = add_watched_folder(&conn, "/music", "startup", 10, true)
            .unwrap()
            .unwrap();

        assert_eq!(folder.path, "/music");
        assert_eq!(folder.mode, "startup");
        assert_eq!(folder.cadence_minutes, 10);
        assert!(folder.enabled);
    }

    #[test]
    fn test_update_watched_folder() {
        let conn = setup_test_db();

        let folder = add_watched_folder(&conn, "/music", "startup", 10, true)
            .unwrap()
            .unwrap();

        let updated = update_watched_folder(&conn, folder.id, Some("manual"), Some(30), Some(false))
            .unwrap()
            .unwrap();

        assert_eq!(updated.mode, "manual");
        assert_eq!(updated.cadence_minutes, 30);
        assert!(!updated.enabled);
    }

    #[test]
    fn test_remove_watched_folder() {
        let conn = setup_test_db();

        let folder = add_watched_folder(&conn, "/music", "startup", 10, true)
            .unwrap()
            .unwrap();

        let removed = remove_watched_folder(&conn, folder.id).unwrap();
        assert!(removed);

        let folders = get_watched_folders(&conn).unwrap();
        assert!(folders.is_empty());
    }

    #[test]
    fn test_get_enabled_folders() {
        let conn = setup_test_db();

        add_watched_folder(&conn, "/music1", "startup", 10, true).unwrap();
        add_watched_folder(&conn, "/music2", "startup", 10, false).unwrap();
        add_watched_folder(&conn, "/music3", "startup", 10, true).unwrap();

        let enabled = get_enabled_watched_folders(&conn).unwrap();
        assert_eq!(enabled.len(), 2);
    }

    #[test]
    fn test_duplicate_path() {
        let conn = setup_test_db();

        add_watched_folder(&conn, "/music", "startup", 10, true).unwrap();

        // Adding same path again should return None
        let result = add_watched_folder(&conn, "/music", "startup", 10, true).unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn test_update_last_scanned() {
        let conn = setup_test_db();

        let folder = add_watched_folder(&conn, "/music", "startup", 10, true)
            .unwrap()
            .unwrap();

        assert!(folder.last_scanned_at.is_none());

        let updated = update_watched_folder_last_scanned(&conn, folder.id).unwrap();
        assert!(updated);

        let folder = get_watched_folder(&conn, folder.id).unwrap().unwrap();
        assert!(folder.last_scanned_at.is_some());
    }

    #[test]
    fn test_get_watched_folder_nonexistent() {
        let conn = setup_test_db();

        let result = get_watched_folder(&conn, 999).unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn test_get_watched_folder_by_path() {
        let conn = setup_test_db();

        add_watched_folder(&conn, "/music/library", "startup", 15, true).unwrap();

        let folder = get_watched_folder_by_path(&conn, "/music/library")
            .unwrap()
            .unwrap();
        assert_eq!(folder.path, "/music/library");
        assert_eq!(folder.cadence_minutes, 15);
    }

    #[test]
    fn test_get_watched_folder_by_path_nonexistent() {
        let conn = setup_test_db();

        let result = get_watched_folder_by_path(&conn, "/nonexistent").unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn test_update_watched_folder_no_changes() {
        let conn = setup_test_db();

        let folder = add_watched_folder(&conn, "/music", "startup", 10, true)
            .unwrap()
            .unwrap();

        // Update with no changes
        let updated = update_watched_folder(&conn, folder.id, None, None, None)
            .unwrap()
            .unwrap();

        assert_eq!(updated.mode, "startup");
        assert_eq!(updated.cadence_minutes, 10);
        assert!(updated.enabled);
    }

    #[test]
    fn test_update_watched_folder_partial() {
        let conn = setup_test_db();

        let folder = add_watched_folder(&conn, "/music", "startup", 10, true)
            .unwrap()
            .unwrap();

        // Update only mode
        let updated = update_watched_folder(&conn, folder.id, Some("manual"), None, None)
            .unwrap()
            .unwrap();

        assert_eq!(updated.mode, "manual");
        assert_eq!(updated.cadence_minutes, 10); // Unchanged
        assert!(updated.enabled); // Unchanged
    }

    #[test]
    fn test_update_watched_folder_nonexistent() {
        let conn = setup_test_db();

        let result = update_watched_folder(&conn, 999, Some("manual"), None, None).unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn test_remove_watched_folder_nonexistent() {
        let conn = setup_test_db();

        let removed = remove_watched_folder(&conn, 999).unwrap();
        assert!(!removed);
    }

    #[test]
    fn test_update_last_scanned_nonexistent() {
        let conn = setup_test_db();

        let updated = update_watched_folder_last_scanned(&conn, 999).unwrap();
        assert!(!updated);
    }

    #[test]
    fn test_get_watched_folders_multiple() {
        let conn = setup_test_db();

        add_watched_folder(&conn, "/music1", "startup", 5, true).unwrap();
        add_watched_folder(&conn, "/music2", "manual", 10, false).unwrap();
        add_watched_folder(&conn, "/music3", "watch", 15, true).unwrap();

        let folders = get_watched_folders(&conn).unwrap();
        assert_eq!(folders.len(), 3);

        // Verify each folder's data
        assert_eq!(folders[0].path, "/music1");
        assert_eq!(folders[0].mode, "startup");
        assert_eq!(folders[0].cadence_minutes, 5);
        assert!(folders[0].enabled);

        assert_eq!(folders[1].path, "/music2");
        assert_eq!(folders[1].mode, "manual");
        assert!(!folders[1].enabled);

        assert_eq!(folders[2].path, "/music3");
        assert_eq!(folders[2].mode, "watch");
        assert_eq!(folders[2].cadence_minutes, 15);
    }

    #[test]
    fn test_watched_folder_disabled_by_default() {
        let conn = setup_test_db();

        let folder = add_watched_folder(&conn, "/music", "startup", 10, false)
            .unwrap()
            .unwrap();

        assert!(!folder.enabled);
    }
}
