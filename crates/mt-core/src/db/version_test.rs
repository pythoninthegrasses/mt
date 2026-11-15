use super::*;
use crate::db::{Database, configure_connection};
use std::process::Command;
use std::sync::{Arc, Barrier, mpsc};
use std::time::Duration;

fn connection(path: &std::path::Path) -> Connection {
    let conn = Connection::open(path).unwrap();
    configure_connection(&conn).unwrap();
    conn
}

fn version(conn: &Connection) -> i32 {
    schema_version(conn).unwrap()
}

/// Populated pre-migration schema, not an empty DB relabelled as legacy.
fn legacy(conn: &Connection) {
    schema::create_tables(conn).unwrap();
    conn.execute_batch(
        "INSERT INTO library(id, filepath, title, artist, album, album_artist,
                             play_count, last_played)
         VALUES (42, '/music/keep.flac', 'Keep', 'The Artist', 'Album', 'The Artist',
                 7, '2026-01-01 12:00:00');
         INSERT INTO favorites(track_id) VALUES (42);
         INSERT INTO playlists(id, name, position) VALUES (8, 'Keep list', 3);
         INSERT INTO playlist_items(playlist_id, track_id, position) VALUES (8, 42, 0);
         INSERT INTO queue(filepath) VALUES ('/music/keep.flac');
         INSERT INTO settings(key, value) VALUES ('volume', '0.75');
         ALTER TABLE library DROP COLUMN file_size;
         ALTER TABLE library DROP COLUMN file_mtime_ns;",
    )
    .unwrap();
}

fn assert_preserved(conn: &Connection) {
    let track: (i64, String, i64) = conn
        .query_row("SELECT id, filepath, play_count FROM library", [], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?))
        })
        .unwrap();
    assert_eq!(track, (42, "/music/keep.flac".into(), 7));
    let joined: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM playlist_items pi
             JOIN favorites f ON f.track_id = pi.track_id
             JOIN playlists p ON p.id = pi.playlist_id
             JOIN library l ON l.id = pi.track_id
             JOIN queue q ON q.filepath = l.filepath
             WHERE p.name = 'Keep list' AND p.position = 3",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(joined, 1);
    assert_eq!(
        conn.query_row("SELECT value FROM settings WHERE key = 'volume'", [], |r| {
            r.get::<_, String>(0)
        })
        .unwrap(),
        "0.75"
    );
    assert_eq!(version(conn), SCHEMA_VERSION);
    check_schema_version(conn).unwrap();
    assert_eq!(
        conn.query_row("SELECT artist_sort_key FROM library WHERE id=42", [], |r| {
            r.get::<_, String>(0)
        })
        .unwrap(),
        "artist"
    );
}

#[test]
fn fresh_database_and_every_pool_connection_are_versioned() {
    let dir = tempfile::tempdir().unwrap();
    let db = Database::new(dir.path().join("fresh.db")).unwrap();
    let connections: Vec<_> = (0..4).map(|_| db.conn().unwrap()).collect();
    for conn in connections {
        assert_eq!(version(&conn), SCHEMA_VERSION);
    }
    let memory = Database::new_in_memory().unwrap();
    assert_eq!(version(&memory.conn().unwrap()), SCHEMA_VERSION);
    // Keep the cross-language constant honest without requiring a desktop build.
    assert!(
        include_str!("../../../../zig-core/src/sqlite.zig").contains(&format!(
            "pub const schema_version: i64 = {SCHEMA_VERSION};"
        ))
    );
    assert!(
        include_str!("../../../../scripts/agent.py")
            .contains(&format!("if schema_version != {SCHEMA_VERSION}:"))
    );
}

#[test]
fn populated_legacy_upgrade_and_repeat_startup_preserve_data() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("legacy.db");
    let conn = connection(&path);
    legacy(&conn);
    drop(conn);
    for _ in 0..2 {
        let db = Database::new(&path).unwrap();
        assert_preserved(&db.conn().unwrap());
    }
}

#[test]
fn existing_complete_unversioned_schema_is_adopted_without_replaying_backfill() {
    let conn = Connection::open_in_memory().unwrap();
    legacy(&conn);
    schema::run_migrations(&conn).unwrap();
    conn.execute("UPDATE library SET artist_sort_key = 'sentinel'", [])
        .unwrap();
    initialize(&conn).unwrap();
    assert_eq!(version(&conn), SCHEMA_VERSION);
    assert_eq!(
        conn.query_row("SELECT artist_sort_key FROM library", [], |r| {
            r.get::<_, String>(0)
        })
        .unwrap(),
        "sentinel"
    );
}

#[test]
fn current_startup_performs_no_schema_or_data_changes() {
    let conn = Connection::open_in_memory().unwrap();
    initialize(&conn).unwrap();
    let changes = conn.total_changes();
    let cookie: i32 = conn
        .query_row("PRAGMA schema_version", [], |r| r.get(0))
        .unwrap();
    initialize(&conn).unwrap();
    assert_eq!(conn.total_changes(), changes);
    assert_eq!(
        conn.query_row("PRAGMA schema_version", [], |r| r.get::<_, i32>(0))
            .unwrap(),
        cookie
    );
}

#[test]
fn incompatible_versions_are_rejected_by_migrator_and_non_migrators() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("incompatible.db");
    let conn = connection(&path);
    for found in [-1, 0, SCHEMA_VERSION + 1] {
        conn.pragma_update(None, "user_version", found).unwrap();
        assert!(matches!(
            check_schema_version(&conn),
            Err(DbError::SchemaVersion { found: actual, .. }) if actual == found
        ));
        if found != 0 {
            assert!(matches!(
                Database::new(&path),
                Err(DbError::SchemaVersion { found: actual, .. }) if actual == found
            ));
            assert_eq!(version(&conn), found);
            assert_eq!(
                conn.query_row("SELECT COUNT(*) FROM sqlite_master", [], |r| r
                    .get::<_, i64>(0))
                    .unwrap(),
                0
            );
        }
    }
}

#[test]
fn pool_checkout_rechecks_compatibility() {
    let db = Database::new_in_memory().unwrap();
    db.conn()
        .unwrap()
        .pragma_update(None, "user_version", SCHEMA_VERSION + 1)
        .unwrap();
    assert!(matches!(db.conn(), Err(DbError::SchemaVersion { .. })));
}

#[test]
fn unrelated_unversioned_database_is_not_adopted() {
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch("CREATE TABLE unrelated(value TEXT); INSERT INTO unrelated VALUES ('keep')")
        .unwrap();
    assert!(matches!(initialize(&conn), Err(DbError::LegacySchema(_))));
    assert_eq!(version(&conn), 0);
    assert_eq!(
        conn.query_row("SELECT value FROM unrelated", [], |r| r.get::<_, String>(0))
            .unwrap(),
        "keep"
    );
}

fn schema_dump(conn: &Connection) -> Vec<(String, Option<String>)> {
    conn.prepare("SELECT name, sql FROM sqlite_master ORDER BY name")
        .unwrap()
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap()
}

#[test]
fn late_failure_rolls_back_ddl_backfill_and_version_and_can_retry() {
    let conn = Connection::open_in_memory().unwrap();
    legacy(&conn);
    conn.execute_batch(
        "CREATE TRIGGER fail_upgrade BEFORE INSERT ON settings
         WHEN NEW.key = 'migration.artist_sort_key_whitespace_v1'
         BEGIN SELECT RAISE(ABORT, 'injected late failure'); END;",
    )
    .unwrap();
    let before = schema_dump(&conn);
    assert!(initialize(&conn).is_err());
    assert_eq!(version(&conn), 0);
    assert!(check_schema_version(&conn).is_err());
    assert_eq!(schema_dump(&conn), before);
    assert_eq!(
        conn.query_row("SELECT play_count FROM library WHERE id=42", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        7
    );
    conn.execute_batch("DROP TRIGGER fail_upgrade").unwrap();
    initialize(&conn).unwrap();
    assert_preserved(&conn);
}

#[test]
fn concurrent_startups_serialize_migration_and_preserve_data() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("concurrent.db");
    legacy(&connection(&path));
    let barrier = Arc::new(Barrier::new(4));
    let threads: Vec<_> = (0..4)
        .map(|_| {
            let path = path.clone();
            let barrier = barrier.clone();
            std::thread::spawn(move || {
                barrier.wait();
                let db = Database::new(path).unwrap();
                assert_preserved(&db.conn().unwrap());
            })
        })
        .collect();
    for thread in threads {
        thread.join().unwrap();
    }
}

#[test]
fn reader_refuses_uncommitted_upgrade_and_waiting_migrator_rechecks_version() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("locked.db");
    let conn = connection(&path);
    conn.execute_batch("PRAGMA journal_mode=WAL").unwrap();
    legacy(&conn);
    let tx = Transaction::new_unchecked(&conn, TransactionBehavior::Immediate).unwrap();
    schema::run_migrations(&tx).unwrap();
    tx.pragma_update(None, "user_version", SCHEMA_VERSION)
        .unwrap();
    let reader =
        Connection::open_with_flags(&path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
    assert_eq!(version(&reader), 0);
    assert!(check_schema_version(&reader).is_err());
    let (started_tx, started_rx) = mpsc::channel();
    let (done_tx, done_rx) = mpsc::channel();
    let worker = std::thread::spawn(move || {
        let conn = connection(&path);
        started_tx.send(()).unwrap();
        let changes = conn.total_changes();
        initialize(&conn).unwrap();
        // A waiting migrator must skip the already-committed migration.
        assert_eq!(conn.total_changes(), changes);
        done_tx.send(()).unwrap();
    });
    started_rx.recv().unwrap();
    assert!(done_rx.recv_timeout(Duration::from_millis(100)).is_err());
    tx.commit().unwrap();
    done_rx.recv_timeout(Duration::from_secs(5)).unwrap();
    worker.join().unwrap();
    check_schema_version(&reader).unwrap();
}

#[test]
fn interrupted_upgrade_recovers_without_publishing_version() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("interrupted.db");
    legacy(&connection(&path));
    let status = Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "db::version::tests::crash_upgrade_child",
            "--ignored",
            "--nocapture",
        ])
        .env("MT_SCHEMA_CRASH_TEST_DB", &path)
        .status()
        .unwrap();
    assert!(status.success());
    let conn = connection(&path);
    assert_eq!(version(&conn), 0);
    assert!(!schema_dump(&conn).iter().any(|(n, _)| n == "crash_probe"));
    initialize(&conn).unwrap();
    assert_preserved(&conn);
}

#[test]
#[ignore = "subprocess helper; exits without transaction destructors"]
fn crash_upgrade_child() {
    let path = std::env::var_os("MT_SCHEMA_CRASH_TEST_DB").expect("parent supplies temp DB");
    let conn = connection(std::path::Path::new(&path));
    let tx = Transaction::new_unchecked(&conn, TransactionBehavior::Immediate).unwrap();
    schema::run_migrations(&tx).unwrap();
    tx.execute_batch("CREATE TABLE crash_probe(value TEXT)")
        .unwrap();
    tx.pragma_update(None, "user_version", SCHEMA_VERSION)
        .unwrap();
    // No Drop/rollback: exercise SQLite's actual journal recovery on reopen.
    std::process::exit(0);
}
