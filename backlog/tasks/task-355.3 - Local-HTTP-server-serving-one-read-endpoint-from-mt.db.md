---
id: TASK-355.3
title: Local HTTP server serving one read endpoint from mt.db
status: Done
assignee: []
created_date: '2026-09-11 00:39'
labels: []
dependencies:
  - TASK-355.2
parent_task_id: TASK-355
type: task
ordinal: 60500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The Zig sidecar needs a transport the frontend can reach directly. HTTP on loopback is chosen over stdio specifically because the frontend must be able to call the sidecar without going back through Rust -- if the transport were stdio-only, every one of the ~100 commands that could otherwise move to the sidecar would remain a permanent Rust proxy, defeating the purpose of the migration. app/frontend/js/api/shared.js already has a dormant HTTP client shape (API_BASE constant, request() helper, ApiError class) built for exactly this. Security note: binding to 127.0.0.1 (not 0.0.0.0) does not trigger the macOS firewall prompt, but loopback alone is not a security boundary -- any local process can still connect -- so a bearer token is required.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The Zig server binds 127.0.0.1 on an ephemeral (OS-assigned) port, never a hardcoded port
- [x] #2 The chosen port and a randomly generated bearer token are written to a file in the app data directory with 0600 permissions
- [x] #3 Requests without a valid bearer token are rejected
- [x] #4 One real library read endpoint returns correct data queried from an actual mt.db file
- [x] #5 JSON responses are streamed to the response writer rather than materialized as an in-memory tree first
- [x] #6 Tests cover: successful auth, rejected auth (missing and invalid token), and a malformed request
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Fixture generator (`crates/mt-tauri/src/db/fixture_gen.rs`, an `#[ignore]`d test run via `task zig:fixture` as `cargo test -p mt-tauri --lib db::fixture_gen::tests::generate_mt_fixture -- --ignored --exact --nocapture`) builds `tests/fixtures/mt_fixture.db` through the real `Database::new`/`init()` schema path, then loads `library` rows out of `mt_20260127.sql`'s dump (dropping the retired `lastfm_loved` column), so `artist_sort_key` is backfilled by the real trigger rather than hand-seeded.

`zig-core/src/sqlite.zig` gained int64/double/bind-int/NULL accessors on top of the TASK-355.2 binding. `zig-core/src/library.zig` is the WHERE/ORDER BY/JSON-field port of `crates/mt-tauri/src/db/library.rs` + `models.rs` (AC#4) — condition order, the 13-column sort-name fallback to `AddedDate`, `ignore_words` string-interpolation with doubled `'`, and `Track` declaration-order JSON keys all copied verbatim rather than "improved," per TASK-355.5's verbatim-SQL requirement. Two parity hazards are carried over deliberately, not fixed: no `id` ORDER BY tiebreaker, and per-field row-dropping matching Rust's strict `FromSql`.

`zig-core/src/server.zig` + `runtime_file.zig`: single-threaded accept loop on an OS-assigned `127.0.0.1` port (AC#1); 32-byte token + port written to `<runtime-dir>/sidecar.json` at 0600, regenerated every startup (AC#2); bearer-token check via `std.crypto.timing_safe.eql` on a fixed-size array, 401 `{"detail":"unauthorized"}` on missing/wrong token (AC#3); response streamed row-by-row through `std.json.Stringify` against `respondStreaming`'s writer, never materialized (AC#5). `zig-core/src/main.zig` takes `--db`/`--runtime-dir` as CLI args rather than resolving Tauri's `app_data_dir()` itself, leaving that to TASK-355.4.

Tests (AC#6): pure-function tests over the query/sort builders, plus socket tests spawning the accept loop on a thread and asserting on valid-token/missing-token/wrong-token/malformed-request-head outcomes; an AC#4 endpoint test opens the real fixture db and cross-checks `total` against a direct `SELECT COUNT(*)`.

Verification: `task zig:fixture && task zig:lint && task zig:test && task zig:build` all clean. Manual end-to-end spot-check ahead of TASK-355.5: ran `mt` under a headless-Wayland (sway) session via `tauri-mcp`, called the real `library_get_all` IPC command against a 301-row fixture swapped into the live app's `mt.db`, and diffed its JSON against the Zig sidecar's `/api/library?limit=100&offset=0` response over the same rows — `total`/`limit`/`offset`/row count/`id` set/row order matched exactly. The one apparent divergence (81 rows' `file_mtime_ns` differing in low-order digits) was traced to the MCP bridge evaluating the IPC result inside the webview's JS context, coercing the nanosecond `i64` through a float64 `Number` before capture — confirmed by comparing against the raw SQLite column value, which matches the Zig response, not the captured "Rust" one. Not a Rust/Zig serialization bug. Live `mt.db` was backed up (main + `-wal`/`-shm`) before the fixture swap and restored afterward.
<!-- SECTION:NOTES:END -->
