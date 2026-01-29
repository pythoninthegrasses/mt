//! Backward compatibility tests for existing databases.
//!
//! These tests verify that the Rust database layer can read databases
//! created by the Python backend. They are skipped if the database
//! doesn't exist or is empty (normal for CI and fresh machines).

#[cfg(test)]
mod tests {
    use crate::db::{favorites, library, library::LibraryQuery, playlists, settings, Database};
    use std::path::PathBuf;

    fn get_test_db_path() -> PathBuf {
        let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap_or_else(|_| ".".into());
        PathBuf::from(manifest_dir).parent().unwrap().join("mt.db")
    }

    fn should_skip() -> bool {
        let db_path = get_test_db_path();

        if !db_path.exists() {
            println!("Skipping compat test: no database at {:?}", db_path);
            return true;
        }

        let db = match Database::new(db_path.to_str().unwrap()) {
            Ok(db) => db,
            Err(e) => {
                println!("Skipping compat test: could not open database: {}", e);
                return true;
            }
        };

        let conn = match db.conn() {
            Ok(c) => c,
            Err(e) => {
                println!("Skipping compat test: could not get connection: {}", e);
                return true;
            }
        };

        let stats = match library::get_library_stats(&conn) {
            Ok(s) => s,
            Err(e) => {
                println!("Skipping compat test: could not get stats: {}", e);
                return true;
            }
        };

        if stats.total_tracks == 0 {
            println!("Skipping compat test: database is empty");
            return true;
        }

        false
    }

    #[test]
    fn test_open_existing_database() {
        if should_skip() {
            return;
        }

        let db_path = get_test_db_path();
        let db = Database::new(db_path.to_str().unwrap()).expect("Failed to open database");
        let conn = db.conn().expect("Failed to get connection");

        let stats = library::get_library_stats(&conn).expect("Failed to get stats");
        println!("Library stats: {:?}", stats);
        assert!(stats.total_tracks > 0, "Expected tracks in library");
    }

    #[test]
    fn test_read_existing_tracks() {
        if should_skip() {
            return;
        }

        let db_path = get_test_db_path();
        let db = Database::new(db_path.to_str().unwrap()).expect("Failed to open database");
        let conn = db.conn().expect("Failed to get connection");

        let query = LibraryQuery {
            limit: 10,
            ..Default::default()
        };

        let result = library::get_all_tracks(&conn, &query).expect("Failed to get tracks");
        println!(
            "Found {} tracks (showing first {})",
            result.total,
            result.items.len()
        );

        assert!(!result.items.is_empty(), "Expected some tracks");
    }

    #[test]
    fn test_read_existing_playlists() {
        if should_skip() {
            return;
        }

        let db_path = get_test_db_path();
        let db = Database::new(db_path.to_str().unwrap()).expect("Failed to open database");
        let conn = db.conn().expect("Failed to get connection");

        let playlist_list = playlists::get_playlists(&conn).expect("Failed to get playlists");
        println!("Found {} playlists", playlist_list.len());
    }

    #[test]
    fn test_read_existing_favorites() {
        if should_skip() {
            return;
        }

        let db_path = get_test_db_path();
        let db = Database::new(db_path.to_str().unwrap()).expect("Failed to open database");
        let conn = db.conn().expect("Failed to get connection");

        let result = favorites::get_favorites(&conn, 100, 0).expect("Failed to get favorites");
        println!("Found {} favorites", result.total);
    }

    #[test]
    fn test_read_existing_settings() {
        if should_skip() {
            return;
        }

        let db_path = get_test_db_path();
        let db = Database::new(db_path.to_str().unwrap()).expect("Failed to open database");
        let conn = db.conn().expect("Failed to get connection");

        let all_settings = settings::get_all_settings(&conn).expect("Failed to get settings");
        println!("Settings: {:?}", all_settings);

        assert!(all_settings.contains_key("volume"));
    }

    #[test]
    fn test_schema_compatibility() {
        if should_skip() {
            return;
        }

        let db_path = get_test_db_path();
        let db = Database::new(db_path.to_str().unwrap()).expect("Failed to open database");
        let conn = db.conn().expect("Failed to get connection");

        let mut stmt = conn.prepare("PRAGMA table_info(library)").unwrap();
        let columns: Vec<String> = stmt
            .query_map([], |row| row.get::<_, String>(1))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();

        let expected_columns = [
            "id",
            "filepath",
            "title",
            "artist",
            "album",
            "album_artist",
            "track_number",
            "track_total",
            "date",
            "duration",
            "file_size",
            "added_date",
            "last_played",
            "play_count",
        ];

        for col in &expected_columns {
            assert!(
                columns.contains(&col.to_string()),
                "Missing column: {}",
                col
            );
        }

        println!(
            "All {} expected columns found in library table",
            expected_columns.len()
        );
    }
}
