# zig-core

A Zig sidecar spike (TASK-355) evaluating whether `mt`'s core engine could move out of the
Rust `mt-tauri` crate. This directory currently contains a standalone binary that opens `mt.db`
read-only and reproduces the `strip_sort_prefix` SQL function used to compute
`library.artist_sort_key`, proven byte-identical to the Rust implementation via a shared
golden-fixture test.

## Building

```bash
task zig:build         # debug build
task zig:test          # unit tests, incl. std.testing.allocator leak checks
task zig:lint          # zig fmt --check
task zig:format        # zig fmt
task zig:cross-compile TARGET=aarch64-macos
task zig:cross-compile TARGET=x86_64-macos
task zig:cross-compile TARGET=x86_64-linux
task zig:cross-compile TARGET=x86_64-windows
```

## Constraints

- **No system frameworks may be linked, on any platform.** Linking a system framework (e.g. a
  macOS `.framework`) makes the build require that platform's SDK on the build host, which
  defeats cross-compiling all four targets (`aarch64-macos`, `x86_64-macos`, `x86_64-linux`,
  `x86_64-windows`) from a single Linux CI runner via `zig cc` — the core assumption behind
  TASK-355.

  The concrete mechanism this guards against: `SQLITE_ENABLE_LOCKING_STYLE` defaults to `1` on
  Apple platforms (`vendor/sqlite3/sqlite3.c`), which pulls in Darwin-specific VFS code that
  needs `CoreFoundation`. `build.zig` defines it to `0` to keep SQLite on its portable POSIX VFS
  everywhere.

## Vendored SQLite

- **Source**: [sqlite-amalgamation-3510100.zip](https://sqlite.org/2025/sqlite-amalgamation-3510100.zip)
- **Version**: 3.51.1 — matches what `rusqlite` 0.38 / `libsqlite3-sys` 0.36 bundle in the Rust
  crate (`Cargo.lock`), satisfying the "at least matching" requirement.
- **SHA3-256** (of the downloaded zip, computed at vendoring time): `856b52ffe7383d779bb86a0ed1ddc19c41b0e5751fa14ce6312f27534e629b64`
- Only `sqlite3.c` and `sqlite3.h` are vendored, in `vendor/sqlite3/`. `shell.c` (the CLI shell)
  and `sqlite3ext.h` (runtime extension loading, which is disabled) are omitted.
- The repo is Unlicense-licensed and SQLite is public domain, so there is no license conflict.

### Compile flags

Carried from `libsqlite3-sys`' `build.rs`, minus extensions unused anywhere in
`crates/mt-tauri/src/db/`:

```text
-DSQLITE_CORE
-DSQLITE_DEFAULT_FOREIGN_KEYS=1
-DSQLITE_ENABLE_API_ARMOR
-DSQLITE_ENABLE_COLUMN_METADATA
-DSQLITE_ENABLE_STAT4
-DSQLITE_THREADSAFE=1
-DSQLITE_USE_URI
-DSQLITE_ENABLE_LOCKING_STYLE=0
-DSQLITE_OMIT_LOAD_EXTENSION
-DHAVE_USLEEP=1
-DHAVE_ISNAN
-D_POSIX_THREAD_SAFE_FUNCTIONS
```

Dropped relative to rusqlite's build, each unused by any query in `crates/mt-tauri/src/db/` and
each real compile time saved: `FTS3`/`FTS4`/`FTS5`, `RTREE`, `JSON1` (a builtin since 3.38 that
isn't queried), `SOUNDEX`, `DBSTAT_VTAB`, `MEMORY_MANAGEMENT`, and `ENABLE_LOAD_EXTENSION` (kept
explicitly *off* via `SQLITE_OMIT_LOAD_EXTENSION`).

`SQLITE_ENABLE_STAT4` is deliberately **kept** — it changes SQLite's query planner, and
TASK-355.5's shadow-diff harness compares query plans/results against the Rust build.

### Re-vendoring

1. Download `sqlite-amalgamation-<version>.zip` from <https://sqlite.org/download.html>.
2. Confirm `#define SQLITE_VERSION` in the zip's `sqlite3.h` matches the intended version.
3. Copy `sqlite3.c` and `sqlite3.h` into `vendor/sqlite3/`, overwriting the existing files.
4. Update the version, source URL, and SHA3-256 above.
5. Run `task zig:test` and `task zig:cross-compile TARGET=...` for all four targets.

## Parity with the Rust implementation

`src/strip_sort_prefix.zig` reimplements `crates/mt-tauri/src/db/models.rs::strip_sort_prefix`
(the function the SQL UDF registered in `crates/mt-tauri/src/db/mod.rs` delegates to): the
first ignore-word that prefixes `value`, followed by whitespace, is stripped, along with any
further leading whitespace. `Therapy?` is not stripped by the ignore-word `the`, since `?` is not
whitespace.

`tests/fixtures/strip_sort_prefix.json` (repo root) is the parity contract: one JSON fixture read
by both a Rust test (`db::tests::test_strip_sort_prefix_golden_fixture` and
`models::tests::test_strip_sort_prefix_matches_golden_fixture`) and a Zig test
(`strip_sort_prefix.zig`'s fixture test, plus `sqlite.zig`'s test exercising the real
`sqlite3_create_function_v2`-registered UDF through SQL). Because both sides read the same file,
parity stays proven as either implementation changes, rather than being a one-time check made at
port time.

**Known divergence**: case-insensitive matching in the Zig port is ASCII-only (`std.ascii`),
while the Rust side uses Unicode-aware `to_lowercase()`. The shipped ignore-words list
(`the`, `a`, `an` — `crates/mt-tauri/src/db/schema.rs`, mirrored in
`app/frontend/js/constants.js`) is entirely ASCII, so this is bounded: it can only produce a
different result if a user sets a custom ignore word containing a non-ASCII uppercase letter
(e.g. a Turkish dotted/dotless I, or a German ß/ẞ case pair).

### Connection setup

`sqlite.Db.openReadOnly` applies the same PRAGMA sequence, in the same order, as the Rust
connection pool's `with_init` (`crates/mt-tauri/src/db/mod.rs`):

1. Open with `SQLITE_OPEN_READONLY`.
2. `sqlite3_busy_timeout(db, 5000)`
3. `PRAGMA synchronous = NORMAL`
4. `PRAGMA foreign_keys = ON`
5. `PRAGMA cache_size = -64000`
6. Register `strip_sort_prefix`.

`PRAGMA journal_mode = WAL`, table creation, and migrations are write-path / once-per-database
concerns in the Rust crate and are deliberately not ported — this sidecar is read-only.
