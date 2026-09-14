//! Fixture-driven Rust/Zig parity check for the shadow-diff harness
//! (TASK-355.5 AC#1, #2, #4, #5).
//!
//! Unlike the harness's own unit tests, this drives the *real* sidecar binary
//! against the *real* fixture database, so what it proves is the two
//! implementations agreeing over a socket — not two Rust functions agreeing in
//! memory.
//!
//! The fixture is `tests/fixtures/mt_fixture.db`: the real schema and
//! migrations via `Database::new`, loaded with the `library` rows of the
//! repo-root `mt_20260127.sql` dump (301 rows of a real music library). It is
//! generated here when absent rather than skipped, so the CI job that runs this
//! needn't know about `task zig:fixture`. The repo-root `mt.db` is a symlink to
//! a developer's live library and is `.gitignore`d, so it is the manual
//! verification fixture and can never be what CI asserts on.
//!
//! The sidecar binary is resolved through the same staging convention Tauri's
//! `externalBin` uses (`crates/mt-tauri/binaries/mt-zig-core-<triple>`),
//! falling back to a plain `zig build` output.

use crate::db::fixture_gen;
use crate::db::library::LibraryQuery;
use crate::library::commands::LibraryResponse;
use crate::shadow_diff;
use crate::sidecar::SidecarState;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};

struct Sidecar {
    child: Child,
    dir: PathBuf,
}

impl Sidecar {
    /// Spawn the sidecar against `db_path` and wait for its runtime file, which
    /// the sidecar writes only after binding its listen socket — so the file's
    /// existence is exactly "ready to serve".
    fn start(db_path: &Path, sabotage: bool) -> Self {
        let dir = std::env::temp_dir().join(format!(
            "mt-shadow-diff-{}-{}",
            std::process::id(),
            if sabotage { "sabotage" } else { "clean" }
        ));
        std::fs::create_dir_all(&dir).expect("create runtime dir");
        let _ = std::fs::remove_file(dir.join(crate::sidecar::RUNTIME_FILE_NAME));

        let binary = sidecar_binary();
        if sabotage && !sidecar_supports_sabotage(&binary) {
            panic!(
                "{} predates the --sabotage flag; rebuild it with `task zig:build`",
                binary.display()
            );
        }

        let mut command = Command::new(&binary);
        command
            .arg("--db")
            .arg(db_path)
            .arg("--runtime-dir")
            .arg(&dir)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        if sabotage {
            command.arg("--sabotage");
        }

        let mut child = command
            .spawn()
            .unwrap_or_else(|e| panic!("spawn sidecar: {e}"));

        for _ in 0..500 {
            if dir.join(crate::sidecar::RUNTIME_FILE_NAME).exists() {
                return Self { child, dir };
            }
            // A sidecar that failed to open the db exits rather than serving;
            // report that instead of timing out with a misleading message.
            if let Ok(Some(status)) = child.try_wait() {
                panic!(
                    "sidecar exited immediately with {status} (binary {:?}, db {db_path:?})",
                    sidecar_binary()
                );
            }
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        panic!("sidecar runtime file never appeared in {dir:?}");
    }

    fn state(&self) -> SidecarState {
        let endpoint =
            shadow_diff::endpoint_from_runtime_dir(&self.dir).expect("read sidecar runtime file");
        SidecarState::for_test(endpoint)
    }
}

impl Drop for Sidecar {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

/// Candidate sidecar binaries: the path Tauri's `externalBin` resolves
/// (`task zig:stage TARGET=<host triple>`) and a plain `task zig:build` output.
/// The newest one wins.
///
/// Newest, not first-found, because the sabotage test needs a binary built
/// *after* the `--sabotage` flag existed. A stale staged binary from before
/// that flag parses its arguments strictly — `unrecognized argument` and exit 1
/// — so it would surface here as an unrelated-looking spawn failure. Requiring
/// `--sabotage` support makes that case report itself as what it is.
fn sidecar_binary() -> PathBuf {
    let host = host_triple();
    let name = format!("mt-zig-core{host}");
    let staged = fixture_gen::repo_root()
        .join("crates/mt-tauri/binaries")
        .join(&name);
    let built = fixture_gen::repo_root().join("zig-core/zig-out/bin/mt-zig-core");

    let candidates = [staged.as_path(), built.as_path()]
        .into_iter()
        .filter(|p| p.exists())
        .max_by_key(|p| p.metadata().and_then(|m| m.modified()).ok())
        .unwrap_or_else(|| {
            panic!(
                "no sidecar binary at {} or {} — run `task zig:stage TARGET={host}`",
                staged.display(),
                built.display()
            )
        })
        .to_path_buf();
    candidates
}

/// Does this sidecar binary understand `--sabotage`? Checked by running it with
/// an invalid db path and reading which error it prints: a build without the
/// flag reports `unrecognized argument`, one with it gets as far as the db open.
fn sidecar_supports_sabotage(binary: &Path) -> bool {
    let output = Command::new(binary)
        .args([
            "--db",
            "/nonexistent/mt.db",
            "--runtime-dir",
            "/tmp",
            "--sabotage",
        ])
        .stdin(Stdio::null())
        .stderr(Stdio::piped())
        .output();
    match output {
        Ok(output) => {
            let stderr = String::from_utf8_lossy(&output.stderr);
            !stderr.contains("unrecognized argument")
        }
        Err(_) => false,
    }
}

/// Rust host triple — what `task zig:stage TARGET=` takes and what Tauri
/// appends to `externalBin`. Derived rather than read from cargo to stay
/// correct under `--target`.
fn host_triple() -> String {
    use std::env::consts::{ARCH, OS};
    match (OS, ARCH) {
        ("macos", "aarch64") => "aarch64-apple-darwin".to_string(),
        ("macos", "x86_64") => "x86_64-apple-darwin".to_string(),
        ("linux", "x86_64") => "x86_64-unknown-linux-gnu".to_string(),
        ("linux", "aarch64") => "aarch64-unknown-linux-gnu".to_string(),
        ("windows", "x86_64") => "x86_64-pc-windows-msvc".to_string(),
        (os, arch) => panic!("unmapped host triple for {os}/{arch}"),
    }
}

/// Serializes generation across this binary's test threads: both parity tests
/// want the same on-disk fixture, and two concurrent `generate_mt_fixture()`
/// calls both delete-then-insert into it, which fails with a UNIQUE violation
/// on `library.id` when the second reads a half-populated table.
static FIXTURE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// The fixture, generated from `mt_20260127.sql` if `task zig:fixture` hasn't
/// run on this checkout yet.
fn fixture() -> PathBuf {
    let path = fixture_gen::fixture_path();
    if !path.exists() {
        let _guard = FIXTURE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        // Re-check: another test may have generated it while this one waited.
        if !path.exists() {
            fixture_gen::generate_mt_fixture();
        }
    }
    assert!(
        path.exists(),
        "fixture {} still absent after generation",
        path.display()
    );
    path
}

/// Every query shape `library_get_all` can be called with — which is also
/// exactly the set of shapes the Zig port claims to reproduce.
fn query_matrix() -> Vec<(&'static str, LibraryQuery)> {
    let sorted = |sort_by: &str, order: crate::db::SortOrder| LibraryQuery {
        sort_by: sort_by.parse().unwrap(),
        sort_order: order,
        limit: 100,
        ..Default::default()
    };
    use crate::db::SortOrder;
    vec![
        ("default", LibraryQuery::default()),
        ("title_asc", sorted("title", SortOrder::Asc)),
        ("title_desc", sorted("title", SortOrder::Desc)),
        ("artist_asc", sorted("artist", SortOrder::Asc)),
        ("artist_desc", sorted("artist", SortOrder::Desc)),
        ("album_asc", sorted("album", SortOrder::Asc)),
        ("added_date_desc", sorted("added_date", SortOrder::Desc)),
        ("year", sorted("year", SortOrder::Desc)),
        ("date", sorted("date", SortOrder::Asc)),
        ("duration", sorted("duration", SortOrder::Desc)),
        ("play_count", sorted("play_count", SortOrder::Desc)),
        ("last_played", sorted("last_played", SortOrder::Asc)),
        ("genre", sorted("genre", SortOrder::Asc)),
        ("disc_number", sorted("disc_number", SortOrder::Asc)),
        ("track_number", sorted("track_number", SortOrder::Desc)),
        ("track_total", sorted("track_total", SortOrder::Desc)),
        // ignore_words drives strip_sort_prefix(), the UDF each side registers
        // independently — the highest-value case in the matrix.
        (
            "title_asc_ignore_words",
            LibraryQuery {
                sort_by: "title".parse().unwrap(),
                sort_order: SortOrder::Asc,
                ignore_words: Some("the,a,an".into()),
                limit: 100,
                ..Default::default()
            },
        ),
        (
            "artist_asc_ignore_words",
            LibraryQuery {
                sort_by: "artist".parse().unwrap(),
                sort_order: SortOrder::Asc,
                ignore_words: Some("the".into()),
                limit: 100,
                ..Default::default()
            },
        ),
        (
            "search",
            LibraryQuery {
                search: Some("the".into()),
                limit: 100,
                ..Default::default()
            },
        ),
        // Every character the query-string encoder has to agree about.
        (
            "search_special_chars",
            LibraryQuery {
                search: Some("A&B + C%D 'E'".into()),
                limit: 100,
                ..Default::default()
            },
        ),
        (
            "artist_filter",
            LibraryQuery {
                artist: Some("Radiohead".into()),
                limit: 100,
                ..Default::default()
            },
        ),
        (
            "album_filter",
            LibraryQuery {
                album: Some("OK Computer".into()),
                limit: 100,
                ..Default::default()
            },
        ),
        // Pagination: a window in the middle, past the end, wider than the
        // library, and empty.
        (
            "page_2",
            LibraryQuery {
                limit: 50,
                offset: 50,
                ..Default::default()
            },
        ),
        (
            "page_past_end",
            LibraryQuery {
                limit: 50,
                offset: 10_000,
                ..Default::default()
            },
        ),
        (
            "limit_larger_than_library",
            LibraryQuery {
                limit: 5_000,
                ..Default::default()
            },
        ),
        (
            "limit_zero",
            LibraryQuery {
                limit: 0,
                ..Default::default()
            },
        ),
    ]
}

fn rust_response(db: &crate::db::Database, query: &LibraryQuery, name: &str) -> LibraryResponse {
    let result = crate::db::library::get_all_tracks(&db.conn().unwrap(), query)
        .unwrap_or_else(|e| panic!("{name}: Rust query failed: {e}"));
    LibraryResponse {
        tracks: result.items,
        total: result.total,
        limit: query.limit,
        offset: query.offset,
    }
}

/// AC#1, #2, #4: every query shape agrees, byte for byte, on a real library.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn fixture_library_get_all_matches_between_rust_and_zig() {
    let db_path = fixture();
    let db = crate::db::Database::new(&db_path).expect("open fixture db");
    let sidecar = Sidecar::start(&db_path, false);
    let state = sidecar.state();

    let mut rows_compared = 0usize;
    for (name, query) in query_matrix() {
        let response = rust_response(&db, &query, name);
        rows_compared += response.tracks.len();
        let divergences = shadow_diff::compare_library_get_all(&state, &query, &response).await;
        assert_eq!(
            divergences, 0,
            "{name}: Rust and Zig diverged on the fixture"
        );
    }

    assert!(
        rows_compared > 1_000,
        "matrix covered {rows_compared} rows — too few to be evidence of parity"
    );
}

/// AC#5: the harness must fail on a real divergence, not merely pass. The
/// sidecar's `--sabotage` flag forces one field to a constant; a harness that
/// could not detect it would report zero divergences here and this test fails.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn sabotaged_sidecar_divergence_is_caught() {
    // Init the subscriber so the divergence the harness logs is visible under
    // --nocapture — AC#5 asks for a demonstrated log, not only a return value.
    let _ = tracing_subscriber::fmt()
        .with_test_writer()
        .with_max_level(tracing::Level::INFO)
        .try_init();

    let db_path = fixture();
    let db = crate::db::Database::new(&db_path).expect("open fixture db");
    let sidecar = Sidecar::start(&db_path, true);
    let state = sidecar.state();

    let query = LibraryQuery {
        limit: 100,
        ..Default::default()
    };
    let response = rust_response(&db, &query, "sabotage");

    let divergences = shadow_diff::compare_library_get_all(&state, &query, &response).await;
    assert_eq!(
        divergences, 1,
        "the harness did not detect the sabotaged field — it cannot be trusted to prove parity"
    );
}
