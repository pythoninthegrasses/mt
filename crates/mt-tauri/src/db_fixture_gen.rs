//! Generates `tests/fixtures/mt_fixture.db`, a real database (real schema,
//! real triggers) loaded with the `library` rows from the repo-root
//! `mt_20260127.sql` dump. TASK-355.3 AC#4 and TASK-355.5 AC#4 share this
//! artifact as their "actual mt.db file" fixture for the Zig sidecar.
//!
//! `mt_20260127.sql` alone cannot build a database: it contains exactly one
//! `CREATE TABLE` (`favorites`), and its `library` INSERT's column list is
//! missing several current-schema columns and carries a `lastfm_loved`
//! column no longer in `Track`. So the schema comes from the real
//! `Database::new` (which runs `schema::create_tables` +
//! `schema::run_migrations`), and only the dump's row data is loaded,
//! dropping `lastfm_loved`.
//!
//! Ignored by default so a plain `cargo test` doesn't write to disk; run
//! explicitly via `task zig:fixture`.

use crate::db::Database;
use std::path::PathBuf;

/// Repo root, resolved from `CARGO_MANIFEST_DIR`.
#[allow(dead_code)]
pub(crate) fn repo_root() -> PathBuf {
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR is set");
    PathBuf::from(manifest_dir)
        .parent()
        .expect("crates/ dir")
        .parent()
        .expect("repo root")
        .to_path_buf()
}

/// The fixture path, resolved through the same helper the generator writes
/// to, so the shadow-diff harness (which builds the fixture itself when it's
/// absent) cannot disagree with it about where it lives.
#[cfg(test)]
pub(crate) fn fixture_path() -> PathBuf {
    repo_root().join("tests/fixtures/mt_fixture.db")
}

/// Slices out the full `INSERT INTO "library" (...) VALUES ...;`
/// statement — everything from its start up to (but not including) the
/// next top-level `INSERT INTO` statement, or end of file. Letting
/// SQLite parse the VALUES tuples (rather than hand-parsing quoted SQL
/// text ourselves) is what makes this robust to any escaping in the
/// dump's string literals.
fn extract_library_insert(dump: &str) -> &str {
    let marker = "INSERT INTO \"library\"";
    let start = dump.find(marker).expect("dump has a library INSERT");
    let rest = &dump[start..];
    let end = rest
        .match_indices("\nINSERT INTO ")
        .map(|(i, _)| i)
        .next()
        .unwrap_or(rest.len());
    rest[..end].trim_end()
}

/// Build `tests/fixtures/mt_fixture.db`. Module-scoped and `pub(crate)` so the
/// shadow-diff harness can generate the fixture on demand instead of failing
/// when a CI job runs it before `task zig:fixture`.
#[allow(dead_code)]
pub(crate) fn generate_mt_fixture() {
    let root = repo_root();

    let dump_path = root.join("mt_20260127.sql");
    let dump = std::fs::read_to_string(&dump_path)
        .unwrap_or_else(|e| panic!("reading {}: {}", dump_path.display(), e));
    let library_insert = extract_library_insert(&dump);

    let fixture_dir = root.join("tests/fixtures");
    std::fs::create_dir_all(&fixture_dir).expect("create tests/fixtures");
    let fixture_path = fixture_dir.join("mt_fixture.db");
    for suffix in ["", "-wal", "-shm", "-journal"] {
        let _ = std::fs::remove_file(format!("{}{suffix}", fixture_path.display()));
    }

    // Real schema + migrations + triggers (artist_sort_key included),
    // not a hand-copied CREATE TABLE.
    let db = Database::new(&fixture_path).expect("create fixture db with real schema");
    let conn = db.conn().expect("get connection");

    conn.execute_batch(
        "CREATE TABLE library_dump_staging (
            id INTEGER, filepath TEXT, title TEXT, artist TEXT, album TEXT,
            album_artist TEXT, track_number TEXT, track_total TEXT, date TEXT,
            duration REAL, file_size INTEGER, added_date TEXT, last_played TEXT,
            play_count INTEGER, file_mtime_ns INTEGER, lastfm_loved INTEGER,
            missing INTEGER, last_seen_at INTEGER, file_inode INTEGER, content_hash TEXT
        )",
    )
    .expect("create staging table");

    let staged_insert = library_insert.replacen(
        "INSERT INTO \"library\"",
        "INSERT INTO library_dump_staging",
        1,
    );
    conn.execute_batch(&staged_insert)
        .expect("load dump rows into staging table");

    // lastfm_loved is dropped here — it has no home in the current Track
    // shape. Every other dump column maps straight across; columns the
    // dump doesn't have (disc_number, disc_total, genre, file_ctime_ns,
    // source, remote_id, artist_sort_key) take their schema default/NULL
    // and, for artist_sort_key, the real backfill trigger.
    conn.execute_batch(
        "INSERT INTO library (
            id, filepath, title, artist, album, album_artist, track_number,
            track_total, date, duration, file_size, added_date, last_played,
            play_count, file_mtime_ns, missing, last_seen_at, file_inode, content_hash
        )
        SELECT
            id, filepath, title, artist, album, album_artist, track_number,
            track_total, date, duration, file_size, added_date, last_played,
            play_count, file_mtime_ns, missing, last_seen_at, file_inode, content_hash
        FROM library_dump_staging;
        DROP TABLE library_dump_staging;",
    )
    .expect("copy staged rows into the real library table");

    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM library", [], |r| r.get(0))
        .expect("count library rows");
    assert!(count > 0, "fixture generation produced zero library rows");
    println!(
        "generated {} with {count} library rows",
        fixture_path.display()
    );
}

#[cfg(test)]
pub(crate) mod tests {
    use super::generate_mt_fixture;

    #[test]
    #[ignore = "writes tests/fixtures/mt_fixture.db; run via `task zig:fixture`"]
    fn generate_mt_fixture_test() {
        generate_mt_fixture();
    }
}
