//! Settings database operations.
//!
//! Operations for key-value settings storage.

use rusqlite::{params, Connection};
use serde_json::Value as JsonValue;
use std::collections::HashMap;

use crate::db::DbResult;

/// Default settings values
fn get_defaults() -> HashMap<&'static str, JsonValue> {
    let mut defaults = HashMap::new();
    defaults.insert("volume", JsonValue::from(75));
    defaults.insert("shuffle", JsonValue::from(false));
    defaults.insert("loop_mode", JsonValue::from("none"));
    defaults.insert("theme", JsonValue::from("dark"));
    defaults.insert("sidebar_width", JsonValue::from(250));
    defaults.insert("queue_panel_height", JsonValue::from(300));
    defaults
}

/// Get all settings as a JSON-like HashMap
pub fn get_all_settings(conn: &Connection) -> DbResult<HashMap<String, JsonValue>> {
    let mut stmt = conn.prepare("SELECT key, value FROM settings")?;

    let mut settings: HashMap<String, JsonValue> = stmt
        .query_map([], |row| {
            let key: String = row.get(0)?;
            let value: Option<String> = row.get(1)?;
            Ok((key, value))
        })?
        .filter_map(|r| r.ok())
        .map(|(key, value)| {
            let json_value = match key.as_str() {
                "volume" | "sidebar_width" | "queue_panel_height" => {
                    value
                        .and_then(|v| v.parse::<i64>().ok())
                        .map(JsonValue::from)
                        .unwrap_or(JsonValue::from(0))
                }
                "shuffle" | "loop_enabled" | "repeat_one" => {
                    let is_true = value
                        .map(|v| v == "1" || v == "true")
                        .unwrap_or(false);
                    JsonValue::from(is_true)
                }
                _ => value
                    .map(JsonValue::from)
                    .unwrap_or(JsonValue::Null),
            };
            (key, json_value)
        })
        .collect();

    // Set defaults for missing settings
    for (key, default) in get_defaults() {
        if !settings.contains_key(key) {
            settings.insert(key.to_string(), default);
        }
    }

    Ok(settings)
}

/// Get a single setting value
pub fn get_setting(conn: &Connection, key: &str) -> DbResult<Option<String>> {
    match conn.query_row(
        "SELECT value FROM settings WHERE key = ?",
        [key],
        |row| row.get(0),
    ) {
        Ok(value) => Ok(value),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

/// Set a single setting
pub fn set_setting(conn: &Connection, key: &str, value: &JsonValue) -> DbResult<()> {
    let str_value = match value {
        JsonValue::Bool(b) => if *b { "1" } else { "0" }.to_string(),
        JsonValue::Number(n) => n.to_string(),
        JsonValue::String(s) => s.clone(),
        JsonValue::Null => String::new(),
        _ => value.to_string(),
    };

    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
        params![key, str_value],
    )?;

    Ok(())
}

/// Update multiple settings at once
pub fn update_settings(
    conn: &Connection,
    settings: &HashMap<String, JsonValue>,
) -> DbResult<Vec<String>> {
    let mut updated = Vec::new();

    for (key, value) in settings {
        if !value.is_null() {
            set_setting(conn, key, value)?;
            updated.push(key.clone());
        }
    }

    Ok(updated)
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
    fn test_get_all_settings_defaults() {
        let conn = setup_test_db();

        let settings = get_all_settings(&conn).unwrap();

        // Check defaults are applied
        assert_eq!(settings.get("volume"), Some(&JsonValue::from(75)));
        assert_eq!(settings.get("shuffle"), Some(&JsonValue::from(false)));
        assert_eq!(settings.get("theme"), Some(&JsonValue::from("dark")));
    }

    #[test]
    fn test_set_and_get_setting() {
        let conn = setup_test_db();

        set_setting(&conn, "volume", &JsonValue::from(50)).unwrap();

        let value = get_setting(&conn, "volume").unwrap();
        assert_eq!(value, Some("50".to_string()));

        let settings = get_all_settings(&conn).unwrap();
        assert_eq!(settings.get("volume"), Some(&JsonValue::from(50)));
    }

    #[test]
    fn test_boolean_settings() {
        let conn = setup_test_db();

        set_setting(&conn, "shuffle", &JsonValue::from(true)).unwrap();

        let value = get_setting(&conn, "shuffle").unwrap();
        assert_eq!(value, Some("1".to_string()));

        let settings = get_all_settings(&conn).unwrap();
        assert_eq!(settings.get("shuffle"), Some(&JsonValue::from(true)));
    }

    #[test]
    fn test_update_multiple_settings() {
        let conn = setup_test_db();

        let mut new_settings = HashMap::new();
        new_settings.insert("volume".to_string(), JsonValue::from(80));
        new_settings.insert("theme".to_string(), JsonValue::from("light"));
        new_settings.insert("shuffle".to_string(), JsonValue::from(true));

        let updated = update_settings(&conn, &new_settings).unwrap();
        assert_eq!(updated.len(), 3);

        let settings = get_all_settings(&conn).unwrap();
        assert_eq!(settings.get("volume"), Some(&JsonValue::from(80)));
        assert_eq!(settings.get("theme"), Some(&JsonValue::from("light")));
        assert_eq!(settings.get("shuffle"), Some(&JsonValue::from(true)));
    }
}
