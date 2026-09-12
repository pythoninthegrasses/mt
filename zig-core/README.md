# zig-core

A Zig sidecar spike (TASK-355) evaluating whether `mt`'s core engine could move out of the
Rust `mt-tauri` crate. This directory currently contains a standalone binary that opens `mt.db`
read-only, serves one library-read HTTP endpoint on loopback, and reproduces the
`strip_sort_prefix` SQL function used to compute `library.artist_sort_key`, proven byte-identical
to the Rust implementation via a shared golden-fixture test.

## Building

```bash
task zig:build         # debug build
task zig:fixture        # generate tests/fixtures/mt_fixture.db from the real Rust schema
task zig:test           # unit tests, incl. std.testing.allocator leak checks
task zig:lint           # zig fmt --check
task zig:format         # zig fmt
task zig:cross-compile TARGET=aarch64-macos
task zig:cross-compile TARGET=x86_64-macos
task zig:cross-compile TARGET=x86_64-linux
task zig:cross-compile TARGET=x86_64-windows
```

## Packaging, spawning, and signing (TASK-355.4)

The sidecar ships inside the Tauri bundle via `externalBin`
(`crates/mt-tauri/tauri.conf.json`: `bundle.externalBin: ["binaries/mt-zig-core"]`).
Tauri resolves the on-disk binary by appending the *Rust* host triple to that
name, e.g. `binaries/mt-zig-core-aarch64-apple-darwin` — not a Zig target
triple, and the two naming schemes disagree (Zig's `x86_64-linux` is static
musl, filed under the Rust triple `x86_64-unknown-linux-gnu`).

```bash
task zig:stage TARGET=aarch64-apple-darwin
task zig:stage TARGET=x86_64-apple-darwin
task zig:stage TARGET=x86_64-unknown-linux-gnu
task zig:stage TARGET=x86_64-pc-windows-msvc
```

`zig:stage` builds with `-Doptimize=ReleaseSafe`, maps `TARGET` to a Zig
target through an explicit hardcoded table (`taskfiles/zig.yml`), and copies
(never strips) the result into `crates/mt-tauri/binaries/`. Stripping would
invalidate Zig's ad-hoc code signature on Apple Silicon. Because Tauri's
build script resolves `externalBin` paths eagerly, even a plain `cargo
check` on `mt-tauri` requires this binary to already be staged for the
host's Rust triple — `tauri:build`, `tauri:dev`, and `ci:build` all carry a
`zig:stage` dependency for exactly this reason.

`crates/mt-tauri/src/sidecar.rs` owns the runtime side: it spawns the
sidecar via `tauri-plugin-shell` in `.setup()`, forwards its stdout/stderr
into `tracing` under `target: "sidecar"`, polls for `sidecar.json` and
issues one authenticated health-check request, and kills the child on
`RunEvent::Exit`. A missing or unspawnable binary is logged and does not
prevent the rest of the app from starting.

On macOS, `task ci:verify-signing TARGET=<target>` (`taskfiles/ci.yml`) runs
after bundling and before notarizing: it asserts the sidecar's code
signature is valid, that it carries the hardened runtime flag, and that the
`.app`'s nested code signatures verify — so a signing problem fails in
seconds rather than after a `notarytool` round trip.

## Running

```bash
mt-zig-core --db /path/to/mt.db --runtime-dir /path/to/app-data-dir
```

`--db` is opened read-only; `--runtime-dir` is where the port/token file (see below) is written —
this sidecar does not resolve platform app-data directories itself (see "HTTP server" below for
why). Missing or unreadable `--db`/`--runtime-dir` exits non-zero with a message on stderr rather
than binding a port that cannot serve.

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

## HTTP server (TASK-355.3)

`src/server.zig` binds `127.0.0.1` on an OS-assigned port (never hardcoded) and serves one route:

```
GET /api/library?search=&artist=&album=&source_filter=&limit=&offset=&sort_by=&sort_order=&ignore_words=
```

HTTP on loopback, rather than stdio, is deliberate: a stdio-only transport would make every
command that could later move to the sidecar a permanent Rust proxy, which defeats the point of
the migration. `app/frontend/js/api/shared.js` already carries a dormant HTTP client
(`API_BASE`/`request()`/`ApiError`) left over from a removed Python sidecar — this is the server
that client was shaped for. Wiring the frontend to actually call it is **TASK-355.6**, not this
task — nothing under `app/frontend/` changes here.

### Auth

Loopback is not a security boundary — any local process can connect — so every request must carry
`Authorization: Bearer <token>`. The port and a fresh 256-bit token are written as JSON to
`<runtime-dir>/sidecar.json` at `0600` on startup:

```json
{"port": 54321, "token": "..."}
```

`--runtime-dir` is a caller-supplied path rather than something this sidecar resolves itself:
Tauri's `app_data_dir()` (`crates/mt-tauri/src/lib.rs`) is the real production value, and
reimplementing that platform resolution logic in Zig would duplicate it and risk drift. TASK-355.4
(spawning) is what passes the real directory.

The token is regenerated on every startup — a leaked token stops working as soon as the sidecar
restarts — and compared with `std.crypto.timing_safe.eql` to avoid a timing side-channel on the
comparison itself (the length check ahead of it is unavoidably non-constant-time, but only leaks
the token's length). Missing or wrong token → `401` with `{"detail":"unauthorized"}`, the shape
`shared.js` already expects.

**Windows note**: `0600` is a POSIX file mode and is a no-op there — `CreateFlags.mode` is ignored
on Windows. ACL-based hardening of the runtime file on Windows is out of scope for this POC.

### Streaming (AC#5)

The response body is written directly to the connection via `std.json.Stringify` as rows are
fetched from SQLite — nothing is materialized as an in-memory tree first. This makes the response
chunked-transfer-encoded rather than `Content-Length`-framed (streaming means the total body size
isn't known up front), so a client reading the raw socket must dechunk before parsing JSON — `curl`
and `fetch()` both do this transparently.

One consequence of streaming: a SQLite failure partway through row-writing happens *after* the
`200` status line is already sent. There is no way to downgrade to a `500` mid-stream; the client
sees a truncated body. This is an accepted cost of streaming, not a bug to work around.

### Parity with the Rust command

The query builder (`src/library.zig`) is a byte-faithful port of
`crates/mt-tauri/src/db/library.rs` / `db/models.rs` — WHERE-condition order, `ORDER BY`
construction (including that `ignore_words` is string-interpolated into the SQL with `'` doubled,
not bound, matching the Rust side exactly), and JSON field order/typing all mirror the Rust source
rather than being "improved."

Two known parity hazards, deliberately not fixed here because fixing them would mean diverging
from the Rust behavior TASK-355.5 diffs against:

- **No `id` tiebreaker.** Neither implementation's `ORDER BY` breaks ties on `id`, so rows tied on
  every sort key have SQLite-defined ordering. Two independent builds (or two runs) can legitimately
  disagree on tie order.
- **Per-field row dropping.** Rust's `FromSql` is strict per column (`db/library.rs`'s
  `row_to_track`): a row with a type-mismatched column silently drops out of the result (while
  still counting toward `total`) rather than erroring the whole query. `rowIsMappable` in
  `library.zig` reproduces this per-field, including which columns are lenient
  (`file_ctime_ns`/`source`/`remote_id` use Rust's `.unwrap_or(...)` fallback instead of dropping
  the row).

`duration` (SQLite `REAL`) is written with a `.0` suffix when whole-valued (`250` → `"250.0"`), matching
what Rust's JSON serializer does for an `f64` that has no fractional part — `std.json.Stringify`'s
default float formatting omits it, so `library.zig` reformats after the fact rather than trusting
the default writer.

### CORS

Not handled in this task. The real caller (the Tauri webview, once TASK-355.6 flips the frontend)
will need it, but pinning down the exact allowed origin without a real running webview to test
against risks silently shipping a wrong value — nothing here would catch it until 355.6. None of
this task's Acceptance Criteria require it, so it's deferred rather than guessed at.
