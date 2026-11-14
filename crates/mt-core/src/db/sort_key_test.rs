//! Tests for the persisted `artist_sort_key` column and the indexed
//! prefix-lookup path behind the `indexed_prefix_lookup` flag (TASK-350.2).

#[cfg(test)]
mod tests {
    use crate::db::schema::{ARTIST_SORT_KEY_IGNORE_WORDS, create_tables, run_migrations};
    use crate::db::{
        Database, LibrarySortColumn, SortOrder, TrackMetadata, library::LibraryQuery,
        register_custom_functions,
    };
    use rusqlite::Connection;
    use std::time::Instant;

    /// Default ignore-words list, mirrored from `app/frontend/js/constants.js`
    /// (`DEFAULT_SORT_IGNORE_WORDS`). This is the one configuration the
    /// persisted key is derived from.
    const DEFAULT_IGNORE_WORDS: &str =
        "the, a, an, la, le, les, los, las, el, die, der, das, il, lo, gli, ...";

    /// `indexed_prefix_lookup_enabled` caches its result in a process-global
    /// static, and several tests mutate the `settings` row or
    /// `MT_INDEXED_PREFIX_LOOKUP` behind it — acquiring this at the top of
    /// every test in this module serializes them so one test's flag mutation
    /// can't leak into another running concurrently.
    static TEST_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    fn test_lock() -> std::sync::MutexGuard<'static, ()> {
        TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn setup_test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        register_custom_functions(&conn).unwrap();
        create_tables(&conn).unwrap();
        run_migrations(&conn).unwrap();
        conn
    }

    fn artist_query(ignore_words: Option<&str>) -> LibraryQuery {
        LibraryQuery {
            sort_by: LibrarySortColumn::Artist,
            sort_order: SortOrder::Asc,
            ignore_words: ignore_words.map(String::from),
            ..Default::default()
        }
    }

    fn add(conn: &Connection, filepath: &str, artist: &str, album_artist: Option<&str>) -> i64 {
        crate::db::library::add_track(
            conn,
            filepath,
            &TrackMetadata {
                title: Some(format!("Track {filepath}")),
                artist: Some(artist.to_string()),
                album_artist: album_artist.map(String::from),
                ..Default::default()
            },
        )
        .unwrap()
    }

    /// Seed library for prefix-jump assertions. Sorted ascending by
    /// COALESCE(NULLIF(album_artist,''), artist) with the default ignore words
    /// applied. "Men I Trust" has album_artist "Arcade Fire", which wins the
    /// COALESCE, so it ties with the standalone Arcade Fire row under the
    /// same key and shares offsets 0-1 with it:
    ///   0-1 {Arcade Fire, Men I Trust (…)} / 2 BadReligion / 3 The Beatles
    ///   4 Led Zeppelin / 5 Menomena / 6 Therapy? / 7 Xom
    ///   8 The Zolas / 9 ZZ Top
    fn insert_sample_library(conn: &Connection) {
        let rows = [
            ("/the-beatles.mp3", "The Beatles", None),
            ("/zz-top.mp3", "ZZ Top", None),
            ("/arcade-fire.mp3", "Arcade Fire", None),
            ("/zolas.mp3", "The Zolas", None),
            ("/led-zeppelin.mp3", "Led Zeppelin", None),
            ("/menomena.mp3", "Menomena", Some("Menomena")),
            (
                "/men-i-trust.mp3",
                "Men I Trust (feat. Arcade Fire)",
                Some("Arcade Fire"),
            ),
            ("/xom.mp3", "Xom", None),
            ("/badreligion.mp3", "BadReligion", None),
            ("/therapy.mp3", "Therapy?", None),
        ];
        for (path, artist, album_artist) in rows {
            add(conn, path, artist, album_artist);
        }
    }

    fn expected_offsets() -> Vec<(&'static str, &'static str, i64)> {
        vec![
            ("a", "Arcade Fire", 0),
            ("b", "BadReligion", 2),
            ("beatl", "The Beatles", 3),
            ("l", "Led Zeppelin", 4),
            ("me", "Menomena", 5),
            ("men", "Menomena", 5),
            // "the" is itself an ignore word, so `raw_fallback_could_diverge`
            // forces the legacy path here even when the indexed path is
            // available: it matches raw "The Beatles" (which starts with
            // "the") rather than the stripped key "therapy?", landing on
            // The Beatles' own page position (3), not Therapy?'s (6).
            ("the", "The Beatles", 3),
            ("x", "Xom", 7),
            ("z", "The Zolas", 8),
            ("zz", "ZZ Top", 9),
        ]
    }

    fn assert_matches_page_scan(
        conn: &Connection,
        query: &LibraryQuery,
        prefix: &str,
        offset: i64,
    ) {
        // Ground truth: the row the paginated list view actually serves at that
        // offset must start with the prefix, and the previous row must not.
        let mut page = query.clone();
        page.limit = 1;
        page.offset = offset;
        let served = crate::db::library::get_all_tracks(conn, &page).unwrap();
        assert_eq!(
            served.items.len(),
            1,
            "no row served at offset {offset} for prefix {prefix:?}"
        );
        let artist = served.items[0].artist.clone().unwrap_or_default();
        let key = crate::db::artist_sort_key(Some(&artist), None, Some(DEFAULT_IGNORE_WORDS))
            .unwrap_or_default();
        // A prefix that is itself an ignore word (e.g. "the") is served via
        // the legacy path's raw-OR-stripped match, so the served row may
        // match on its raw name rather than its stripped key.
        let raw = artist.to_lowercase();
        assert!(
            key.starts_with(prefix) || raw.starts_with(prefix),
            "row at offset {offset} for prefix {prefix:?} is {artist:?} (key {key:?})"
        );
    }

    // ── AC #1: indexed prefix lookup returns correct offsets ────────────────

    #[test]
    fn test_indexed_prefix_lookup_offsets_match_sample_library() {
        let _guard = test_lock();
        let conn = setup_test_db();
        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('feature.indexed_prefix_lookup', 'true')",
            [],
        )
        .unwrap();
        insert_sample_library(&conn);

        let query = artist_query(Some(DEFAULT_IGNORE_WORDS));
        for (prefix, artist, expected) in expected_offsets() {
            let offset = crate::db::library::find_sort_offset(&conn, &query, prefix).unwrap();
            assert_eq!(
                offset,
                Some(expected),
                "prefix {prefix:?} should resolve to {artist:?}"
            );
            assert_matches_page_scan(&conn, &query, prefix, expected);
        }
    }

    #[test]
    fn test_indexed_prefix_lookup_no_match_returns_none() {
        let _guard = test_lock();
        let conn = setup_test_db();
        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('feature.indexed_prefix_lookup', 'true')",
            [],
        )
        .unwrap();
        insert_sample_library(&conn);

        let query = artist_query(Some(DEFAULT_IGNORE_WORDS));
        assert_eq!(
            crate::db::library::find_sort_offset(&conn, &query, "qqq").unwrap(),
            None
        );
        assert_eq!(
            crate::db::library::find_sort_offset(&conn, &query, "zq").unwrap(),
            None
        );
        // "z" matches Zolas/ZZ Top, but neither starts with the more specific "ze".
        assert_eq!(
            crate::db::library::find_sort_offset(&conn, &query, "ze").unwrap(),
            None
        );
    }

    // ── AC #2: migration adds the column and backfills existing rows ────────

    #[test]
    fn test_migration_adds_column_and_backfills() {
        let _guard = test_lock();
        let conn = Connection::open_in_memory().unwrap();
        register_custom_functions(&conn).unwrap();
        create_tables(&conn).unwrap();

        // Pre-migration library table (no artist_sort_key) with existing rows.
        conn.execute(
            "CREATE TABLE legacy_library (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                filepath TEXT NOT NULL,
                title TEXT,
                artist TEXT,
                album TEXT,
                album_artist TEXT
            )",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO legacy_library (filepath, artist, album_artist) VALUES
                ('/a.mp3', 'The Beatles', NULL),
                ('/b.mp3', 'Men I Trust (feat. Arcade Fire)', 'Arcade Fire'),
                ('/c.mp3', 'ZZ Top', ''),
                ('/d.mp3', NULL, NULL)",
            [],
        )
        .unwrap();
        conn.execute("DROP TABLE library", []).unwrap();
        conn.execute("ALTER TABLE legacy_library RENAME TO library", [])
            .unwrap();

        run_migrations(&conn).unwrap();

        let columns: Vec<String> = conn
            .prepare("SELECT name FROM pragma_table_info('library')")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();
        assert!(
            columns.contains(&"artist_sort_key".to_string()),
            "migration must add artist_sort_key, got {columns:?}"
        );

        // No row lost, and every non-null sort source got a backfilled key.
        let (rows, keyed): (i64, i64) = conn
            .query_row(
                "SELECT COUNT(*), COUNT(artist_sort_key) FROM library",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(rows, 4, "backfill must not lose rows");
        assert_eq!(keyed, 3, "the null-artist row has no key to derive");

        let keys: Vec<Option<String>> = conn
            .prepare("SELECT artist_sort_key FROM library ORDER BY filepath")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();
        assert_eq!(keys[0], Some("beatles".to_string())); // The Beatles
        assert_eq!(keys[1], Some("arcade fire".to_string())); // album_artist wins
        assert_eq!(keys[2], Some("zz top".to_string())); // empty album_artist falls through
        assert_eq!(keys[3], None);

        // Idempotent: a second run rewrites the same keys.
        run_migrations(&conn).unwrap();
        let keys2: Vec<Option<String>> = conn
            .prepare("SELECT artist_sort_key FROM library ORDER BY filepath")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();
        assert_eq!(keys, keys2);
    }

    #[test]
    fn test_migration_creates_covering_index() {
        let _guard = test_lock();
        let conn = setup_test_db();
        let exists: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name='idx_library_artist_sort_key'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(exists, 1, "covering index (artist_sort_key, id) missing");
    }

    // ── AC #3: write paths populate the key ─────────────────────────────────

    #[test]
    fn test_add_track_populates_key() {
        let _guard = test_lock();
        let conn = setup_test_db();
        let id = add(&conn, "/the-beatles.mp3", "The Beatles", None);
        let key: Option<String> = conn
            .query_row(
                "SELECT artist_sort_key FROM library WHERE id = ?",
                [id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(key.as_deref(), Some("beatles"));
    }

    #[test]
    fn test_update_track_metadata_refreshes_key() {
        let _guard = test_lock();
        let conn = setup_test_db();
        let id = add(&conn, "/a.mp3", "The Beatles", None);

        crate::db::library::update_track_metadata(
            &conn,
            id,
            &TrackMetadata {
                artist: Some("Not An Article Band".to_string()),
                ..Default::default()
            },
        )
        .unwrap();
        let key: Option<String> = conn
            .query_row(
                "SELECT artist_sort_key FROM library WHERE id = ?",
                [id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(key.as_deref(), Some("not an article band"));

        // Album artist takes precedence for the artist sort key.
        crate::db::library::update_track_metadata(
            &conn,
            id,
            &TrackMetadata {
                artist: Some("Silence".to_string()),
                album_artist: Some("The Soundtracks".to_string()),
                ..Default::default()
            },
        )
        .unwrap();
        let key: Option<String> = conn
            .query_row(
                "SELECT artist_sort_key FROM library WHERE id = ?",
                [id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(key.as_deref(), Some("soundtracks"));
    }

    #[test]
    fn test_bulk_scan_and_rescan_paths_populate_key() {
        let _guard = test_lock();
        let conn = setup_test_db();

        // Scan path: bulk insert.
        let added = vec![
            (
                "/scan-a.mp3".to_string(),
                TrackMetadata {
                    artist: Some("The Lumineers".to_string()),
                    ..Default::default()
                },
            ),
            (
                "/scan-b.mp3".to_string(),
                TrackMetadata {
                    artist: Some("Fleet Foxes".to_string()),
                    album_artist: Some("The Foxes".to_string()),
                    ..Default::default()
                },
            ),
        ];
        crate::db::library::add_tracks_bulk(&conn, &added).unwrap();
        assert_keyed(&conn, "/scan-a.mp3", "lumineers");
        assert_keyed(&conn, "/scan-b.mp3", "foxes");

        // Rescan path: bulk update of the same filepaths with new metadata.
        let updated = vec![(
            "/scan-a.mp3".to_string(),
            TrackMetadata {
                artist: Some("Aurora".to_string()),
                ..Default::default()
            },
        )];
        crate::db::library::update_tracks_bulk(&conn, &updated).unwrap();
        assert_keyed(&conn, "/scan-a.mp3", "aurora");
    }

    fn assert_keyed(conn: &Connection, filepath: &str, expected: &str) {
        let key: Option<String> = conn
            .query_row(
                "SELECT artist_sort_key FROM library WHERE filepath = ?",
                [filepath],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            key.as_deref(),
            Some(expected),
            "unexpected artist_sort_key for {filepath}"
        );
    }

    #[test]
    fn test_plex_insert_path_populates_key() {
        let _guard = test_lock();
        let conn = setup_test_db();
        conn.execute(
            "INSERT INTO library (filepath, title, artist, album, source, missing)
             VALUES ('plex://1', 'Remote', 'The Remote Ones', 'Album', 'plex', 0)",
            [],
        )
        .unwrap();
        assert_keyed(&conn, "plex://1", "remote ones");

        // A write that never touches artist/album_artist leaves the key intact.
        conn.execute(
            "UPDATE library SET play_count = play_count + 1 WHERE filepath = 'plex://1'",
            [],
        )
        .unwrap();
        assert_keyed(&conn, "plex://1", "remote ones");
    }

    // ── AC #4 / #5: new path uses the index and no window function ──────────

    #[test]
    fn test_indexed_query_plan_uses_covering_index() {
        let _guard = test_lock();
        let conn = setup_test_db();
        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('feature.indexed_prefix_lookup', 'true')",
            [],
        )
        .unwrap();
        insert_sample_library(&conn);

        let query = artist_query(Some(DEFAULT_IGNORE_WORDS));
        let (sql, params) = crate::db::library::sort_offset_sql(&conn, &query, "z")
            .expect("indexed path expected for the default ignore-words list");
        assert!(
            !sql.contains("ROW_NUMBER"),
            "indexed path must not rank the whole library: {sql}"
        );

        let param_refs: Vec<&dyn rusqlite::ToSql> = params.iter().map(|p| p.as_ref()).collect();
        let mut stmt = conn.prepare(&format!("EXPLAIN QUERY PLAN {sql}")).unwrap();
        let plan: Vec<String> = stmt
            .query_map(param_refs.as_slice(), |row| row.get::<_, String>(3))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();
        let plan_text = plan.join("\n");
        assert!(
            plan_text.contains("idx_library_artist_sort_key"),
            "expected the covering index in the plan, got {plan_text}"
        );
    }

    #[test]
    fn test_no_window_function_in_sql_while_flag_enabled() {
        let _guard = test_lock();
        let conn = setup_test_db();
        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('feature.indexed_prefix_lookup', 'true')",
            [],
        )
        .unwrap();

        // The flag must be re-read without rebuilding the pool.

        insert_sample_library(&conn);
        let query = artist_query(Some(DEFAULT_IGNORE_WORDS));
        let offset = crate::db::library::find_sort_offset(&conn, &query, "men").unwrap();
        assert_eq!(offset, Some(5));

        let (sql, _) = crate::db::library::sort_offset_sql(&conn, &query, "men").unwrap();
        assert!(!sql.contains("ROW_NUMBER"), "got {sql}");
    }

    // ── AC #6: ignore-words and album_artist semantics preserved ────────────

    #[test]
    fn test_ignore_words_semantics_match_the_legacy_path() {
        let _guard = test_lock();
        let conn = setup_test_db();
        insert_sample_library(&conn);

        // With ignore words, "the beatles" strips to "beatles", sorting after
        // the tied Arcade Fire / Men I Trust pair and BadReligion.
        let with_words = crate::db::library::find_sort_offset(
            &conn,
            &artist_query(Some(DEFAULT_IGNORE_WORDS)),
            "beatl",
        )
        .unwrap();
        assert_eq!(with_words, Some(3));

        // Without ignore words, raw "The Beatles" does not start with "beatl".
        let without_words =
            crate::db::library::find_sort_offset(&conn, &artist_query(None), "beatl").unwrap();
        assert_eq!(
            without_words, None,
            "unstripped text still starts with \"the\""
        );

        // Unstripped, "The Beatles" and "The Zolas" sort under t, after the
        // Arcade Fire pair, BadReligion, and Led Zeppelin/Menomena.
        let the = crate::db::library::find_sort_offset(&conn, &artist_query(None), "the").unwrap();
        assert_eq!(
            the,
            Some(5),
            "The Beatles is the first \"the\"-prefixed row"
        );
    }

    #[test]
    fn test_custom_ignore_words_fall_back_to_legacy_path() {
        let _guard = test_lock();
        let conn = setup_test_db();
        insert_sample_library(&conn);

        // A list that does not match what the persisted key was built with
        // cannot be served from the index — the legacy path must take over.
        let custom = artist_query(Some("the"));
        assert!(
            crate::db::library::sort_offset_sql(&conn, &custom, "la")
                .unwrap()
                .0
                .contains("ROW_NUMBER"),
            "a non-default ignore-words list must use the ROW_NUMBER path"
        );

        // "la" matches nothing here either way.
        assert_eq!(
            crate::db::library::find_sort_offset(&conn, &custom, "la").unwrap(),
            None
        );

        // And a list that only strips "the" still resolves "l" to Led Zeppelin.
        let custom = artist_query(Some("the"));
        assert_eq!(
            crate::db::library::find_sort_offset(&conn, &custom, "led").unwrap(),
            Some(4)
        );
    }

    #[test]
    fn test_album_artist_fallback_semantics() {
        let _guard = test_lock();
        let conn = setup_test_db();
        insert_sample_library(&conn);

        let query = artist_query(Some(DEFAULT_IGNORE_WORDS));

        // "men" must land on Menomena, not the Men I Trust row filed under
        // its album artist (Arcade Fire).
        assert_eq!(
            crate::db::library::find_sort_offset(&conn, &query, "men").unwrap(),
            Some(5)
        );

        // Empty album_artist falls through to artist rather than sorting as "".
        // Kiasmos sorts between The Beatles (3) and Led Zeppelin (was 4, now 5).
        add(&conn, "/empty-aa.mp3", "Kiasmos", Some(""));
        let query = artist_query(Some(DEFAULT_IGNORE_WORDS));
        let offset = crate::db::library::find_sort_offset(&conn, &query, "ki").unwrap();
        assert_eq!(offset, Some(4), "Kiasmos sorts under k");
    }

    #[test]
    fn test_prefix_metacharacters_are_literal() {
        let _guard = test_lock();
        let conn = setup_test_db();
        insert_sample_library(&conn);
        let query = artist_query(Some(DEFAULT_IGNORE_WORDS));
        assert_eq!(
            crate::db::library::find_sort_offset(&conn, &query, "%").unwrap(),
            None
        );
        assert_eq!(
            crate::db::library::find_sort_offset(&conn, &query, "_").unwrap(),
            None
        );
    }

    #[test]
    fn test_non_artist_sort_columns_stay_on_the_legacy_path() {
        let _guard = test_lock();
        let conn = setup_test_db();
        insert_sample_library(&conn);

        let query = LibraryQuery {
            sort_by: LibrarySortColumn::Title,
            sort_order: SortOrder::Asc,
            ignore_words: Some(DEFAULT_IGNORE_WORDS.to_string()),
            ..Default::default()
        };
        assert!(
            crate::db::library::sort_offset_sql(&conn, &query, "t")
                .unwrap()
                .0
                .contains("ROW_NUMBER")
        );
        // Non-artist sort columns still match against the artist column, not
        // the sort column itself. Titles are "Track /<filepath>", so ordering
        // by title puts "/led-zeppelin.mp3" at position 2; its artist "Led
        // Zeppelin" is the only one matching prefix "led".
        assert_eq!(
            crate::db::library::find_sort_offset(&conn, &query, "led").unwrap(),
            Some(2)
        );
    }

    // ── AC #8: the flag restores the ROW_NUMBER path ────────────────────────

    #[test]
    fn test_flag_disabled_restores_row_number_path() {
        let _guard = test_lock();
        let conn = setup_test_db();
        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('feature.indexed_prefix_lookup', 'false')",
            [],
        )
        .unwrap();

        insert_sample_library(&conn);
        let query = artist_query(Some(DEFAULT_IGNORE_WORDS));

        let (sql, _) = crate::db::library::sort_offset_sql(&conn, &query, "men").unwrap();
        assert!(
            sql.contains("ROW_NUMBER"),
            "flag off must restore the window-function query: {sql}"
        );

        // And it still resolves the same offsets.
        for (prefix, artist, expected) in expected_offsets() {
            assert_eq!(
                crate::db::library::find_sort_offset(&conn, &query, prefix).unwrap(),
                Some(expected),
                "legacy path: prefix {prefix:?} should resolve to {artist:?}"
            );
        }

        // Re-enabling at runtime switches back to the indexed seek.
        conn.execute(
            "UPDATE settings SET value = 'true' WHERE key = 'feature.indexed_prefix_lookup'",
            [],
        )
        .unwrap();
        let (sql, _) = crate::db::library::sort_offset_sql(&conn, &query, "men").unwrap();
        assert!(!sql.contains("ROW_NUMBER"), "got {sql}");
    }

    #[test]
    fn test_flag_defaults_off_and_reads_env_override() {
        let _guard = test_lock();
        let conn = setup_test_db();
        let (sql, _) = crate::db::library::sort_offset_sql(
            &conn,
            &artist_query(Some(DEFAULT_IGNORE_WORDS)),
            "z",
        )
        .unwrap();
        assert!(
            sql.contains("ROW_NUMBER"),
            "default must stay on the legacy path: {sql}"
        );

        unsafe { std::env::set_var("MT_INDEXED_PREFIX_LOOKUP", "1") };
        let (sql, _) = crate::db::library::sort_offset_sql(
            &conn,
            &artist_query(Some(DEFAULT_IGNORE_WORDS)),
            "z",
        )
        .unwrap();
        unsafe { std::env::remove_var("MT_INDEXED_PREFIX_LOOKUP") };
        assert!(
            !sql.contains("ROW_NUMBER"),
            "MT_INDEXED_PREFIX_LOOKUP=1 should enable the indexed path: {sql}"
        );
    }

    #[test]
    fn test_indexed_path_requires_the_migration_to_have_run() {
        let _guard = test_lock();
        let conn = Connection::open_in_memory().unwrap();
        register_custom_functions(&conn).unwrap();
        create_tables(&conn).unwrap();
        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('feature.indexed_prefix_lookup', 'true')",
            [],
        )
        .unwrap();

        // Flag on but the column missing (migration not applied to this
        // connection): fall back instead of erroring.
        let query = artist_query(Some(DEFAULT_IGNORE_WORDS));
        let (sql, _) = crate::db::library::sort_offset_sql(&conn, &query, "a").unwrap();
        assert!(sql.contains("ROW_NUMBER"), "got {sql}");
    }

    // ── AC #7: perf harness ─────────────────────────────────────────────────

    const PERF_ROWS: usize = 40_000;
    const PERF_SAMPLES: usize = 200;
    const PERF_P95_BUDGET_MS: f64 = 100.0;

    fn insert_synthetic_library(db: &Database, rows: usize) {
        let conn = db.conn().unwrap();
        conn.execute_batch("BEGIN").unwrap();
        {
            let mut stmt = conn
                .prepare_cached(
                    "INSERT INTO library
                     (filepath, title, artist, album, album_artist, date, genre, duration,
                      file_size, missing)
                     VALUES (?1, ?2, ?3, ?4, ?5, '2024', 'Rock', 200.0, 5000000, 0)",
                )
                .unwrap();
            for i in 0..rows {
                // Spread artists over the alphabet, with a chunk of articles so
                // the ignore-words path is exercised too.
                let name = match i % 7 {
                    0 => format!("The {} Artist {:05}", ignore_word_stub(), i),
                    1 => format!("{} Artist {:05}", alphabet_word(i), i),
                    _ => format!("{} Band {:05}", alphabet_word(i / 3), i),
                };
                stmt.execute(rusqlite::params![
                    format!("/music/{i}.mp3"),
                    format!("Title {i:05}"),
                    name.clone(),
                    format!("Album {:04}", i % 500),
                    name,
                ])
                .unwrap();
            }
        }
        conn.execute_batch("COMMIT").unwrap();
        // Keys are normally maintained by the write triggers.
        crate::db::refresh_artist_sort_keys(&conn).unwrap();
        conn.execute("ANALYZE", []).unwrap();
    }

    fn alphabet_word(i: usize) -> String {
        let a = (b'A' + ((i / 26) % 26) as u8) as char;
        let b = (b'a' + (i % 26) as u8) as char;
        format!("{a}{b}")
    }

    fn ignore_word_stub() -> &'static str {
        "The"
    }

    fn percentile(sorted: &[f64], p: f64) -> f64 {
        let idx = ((sorted.len() as f64 - 1.0) * p).round() as usize;
        sorted[idx]
    }

    #[test]
    #[ignore = "perf harness: cargo test --release -p mt-tauri sort_key -- --ignored --nocapture"]
    fn test_prefix_lookup_p95_under_100ms_on_40k_library() {
        let _guard = test_lock();
        let db = Database::new_in_memory().unwrap();
        let t0 = Instant::now();
        insert_synthetic_library(&db, PERF_ROWS);
        let count: i64 = db
            .conn()
            .unwrap()
            .query_row("SELECT COUNT(*) FROM library", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count as usize, PERF_ROWS);
        println!("seeded {PERF_ROWS} rows in {:?}", t0.elapsed());

        // Compare the indexed seek against the ROW_NUMBER path it replaces.
        for (label, enabled) in [("indexed", true), ("row_number", false)] {
            set_flag(&db, enabled);
            let mut samples: Vec<f64> = Vec::with_capacity(PERF_SAMPLES);
            let mut offsets: Vec<i64> = Vec::with_capacity(PERF_SAMPLES);
            let conn = db.conn().unwrap();

            // Warm the plan cache.
            let warm = artist_query(Some(DEFAULT_IGNORE_WORDS));
            crate::db::library::find_sort_offset(&conn, &warm, "aa").unwrap();

            for i in 0..PERF_SAMPLES {
                let prefix = alphabet_word(i);
                let q = artist_query(Some(DEFAULT_IGNORE_WORDS));
                let start = Instant::now();
                let offset = crate::db::library::find_sort_offset(&conn, &q, &prefix).unwrap();
                samples.push(start.elapsed().as_secs_f64() * 1000.0);
                offsets.push(offset.unwrap_or(-1));
            }

            samples.sort_by(|a, b| a.partial_cmp(b).unwrap());
            let p50 = percentile(&samples, 0.50);
            let p95 = percentile(&samples, 0.95);
            let max = samples[samples.len() - 1];
            println!(
                "{label:>10} prefix lookup: p50 = {p50:.3} ms, p95 = {p95:.3} ms, max = {max:.3} ms"
            );

            if enabled {
                assert!(
                    p95 < PERF_P95_BUDGET_MS,
                    "indexed prefix lookup p95 {p95:.3} ms exceeds {PERF_P95_BUDGET_MS} ms"
                );
            }

            // Both paths must agree on the offsets they return.
            if enabled {
                drop(conn);
                set_flag(&db, false);
                let conn = db.conn().unwrap();
                for (i, expected) in offsets.iter().enumerate() {
                    let prefix = alphabet_word(i);
                    let q = artist_query(Some(DEFAULT_IGNORE_WORDS));
                    let legacy = crate::db::library::find_sort_offset(&conn, &q, &prefix).unwrap();
                    if *expected == -1 {
                        assert_eq!(legacy, None, "disagreement for prefix {prefix:?}");
                    } else {
                        assert_eq!(
                            legacy,
                            Some(*expected),
                            "disagreement for prefix {prefix:?}"
                        );
                    }
                }
            }
        }
    }

    fn set_flag(db: &Database, enabled: bool) {
        let conn = db.conn().unwrap();
        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('feature.indexed_prefix_lookup', ?1)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            [if enabled { "true" } else { "false" }],
        )
        .unwrap();
        drop(conn);
    }

    #[test]
    fn test_sort_key_matches_sql_expression() {
        let conn = setup_test_db();
        for (artist, album_artist) in [
            ("The Beatles", None),
            ("  the   Shags  ", None),
            ("Therapy?", None),
            ("Astrud Gilberto", None),
            ("Men I Trust", Some("Arcade Fire")),
            ("Silence", Some("")),
            ("ELUVEITIE", None),
        ] {
            let rust = crate::db::artist_sort_key(
                Some(artist),
                album_artist,
                Some(ARTIST_SORT_KEY_IGNORE_WORDS),
            );
            // Use the production expr builder itself (not a hand-rolled
            // duplicate) so this test can't drift from what the migration
            // and triggers actually run.
            let expr = crate::db::models::artist_sort_key_sql_expr("?1", "?2");
            let sql: Option<String> = conn
                .query_row(
                    &format!("SELECT {expr}"),
                    rusqlite::params![artist, album_artist.unwrap_or("")],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(rust, sql, "divergence for {artist:?} / {album_artist:?}");
        }
    }

    #[test]
    fn test_sort_key_null_sources() {
        assert_eq!(crate::db::artist_sort_key(None, None, Some("the")), None);
        assert_eq!(
            crate::db::artist_sort_key(Some(""), Some("   "), Some("the")),
            None
        );
        // "The" alone has nothing after it to strip (no word boundary), so it
        // keeps its own key rather than becoming empty.
        assert_eq!(
            crate::db::artist_sort_key(Some("The "), Some(""), Some("the")),
            Some("the".to_string())
        );
    }
}
