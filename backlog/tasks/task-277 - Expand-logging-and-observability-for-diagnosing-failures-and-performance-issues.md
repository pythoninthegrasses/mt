---
id: TASK-277
title: >-
  Expand logging and observability for diagnosing failures and performance
  issues
status: Done
assignee: []
created_date: '2026-02-17 16:49'
updated_date: '2026-02-17 17:55'
labels:
  - observability
  - logging
  - diagnostics
  - backend
  - frontend
dependencies: []
references:
  - crates/mt-tauri/Cargo.toml
  - crates/mt-tauri/src/lib.rs
  - crates/mt-tauri/src/audio/error.rs
  - crates/mt-tauri/src/db/mod.rs
  - crates/mt-tauri/src/watcher.rs
  - crates/mt-tauri/src/scanner/commands.rs
  - crates/mt-tauri/src/commands/audio.rs
  - crates/mt-tauri/src/library/commands.rs
  - app/frontend/js/components/settings-view.js
  - app/frontend/views/settings.html
  - app/frontend/js/events.js
documentation:
  - 'https://docs.rs/tracing/latest/tracing/'
  - 'https://docs.rs/tracing-subscriber/latest/tracing_subscriber/'
  - 'https://docs.rs/tracing-appender/latest/tracing_appender/'
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The application has no structured logging, no log persistence, and no performance instrumentation. Diagnosing critical failures and performance slowdowns is effectively impossible after the fact.

## Current State

**No logging framework**: The backend uses raw `println!`/`eprintln!` (~175 instances across the codebase). No `log`, `tracing`, or similar crate is in `Cargo.toml`. There is no log level filtering, structured fields, or target-based routing.

**No log persistence**: Backend logs go to stdout/stderr and are lost on restart. Frontend logs go to browser console and are lost on page reload. There is no log file, no rotation, and no historical data.

**Export diagnostics is a stub** (`crates/mt-tauri/src/lib.rs:113-140`): The `export_diagnostics` command called by Settings > Export Logs only writes static info — app version, build ID, platform, timestamp. It does NOT include any runtime logs, error history, or performance data. This is the feature the new work should complement.

**No performance instrumentation**: No timing spans, no metrics collection, no slow-operation detection. The scanner has an `Instant::now()` for job timing (`scanner/commands.rs:88`) but the result is never logged.

**Inconsistent error handling**: Many errors are silently swallowed with `let _ =` or `.ok()` (e.g., `lib.rs:287,351,394`). IPC command errors are converted to strings for the frontend but never logged on the backend. Database operations (`db/mod.rs`, `db/*.rs`) have zero logging.

**Sparse backend log coverage**: Database operations — zero logs. Audio engine internals — minimal. IPC command execution — errors not logged. Background tasks (Last.fm retry, loved tracks matching) — partial.

**Frontend logging**: Uses tagged prefixes like `[events]`, `[ui]`, `[settings]` in console.log/error (~276 instances). No persistence, no error reporting back to the backend.

## Goal

Introduce structured, persistent logging and basic performance instrumentation so that:
1. Runtime logs are captured to a rotating log file on disk
2. The existing "Export Logs" feature includes actual runtime logs in its output
3. Critical subsystems (audio, database, scanner, watcher, IPC commands) have meaningful log coverage
4. Slow operations and failures are diagnosable from exported logs alone
5. Frontend errors are captured and available in the diagnostic export

## Key Subsystems Needing Coverage

- **Audio engine**: Playback start/stop/error, format issues, stream failures, seek operations
- **Database**: Connection lifecycle, migration runs, query failures, constraint violations
- **Scanner/Watcher**: Scan start/complete with timing and counts, file I/O errors, missing track detection
- **IPC commands**: Command invocation with timing (at least for slow commands), error responses
- **Background tasks**: Last.fm scrobble retries, loved tracks sync, scheduled rescans
- **Frontend**: Uncaught exceptions, failed IPC calls, critical state transitions

## Technical Context

- Tauri 2 integrates well with the `tracing` crate ecosystem (`tracing` + `tracing-subscriber` + `tracing-appender`)
- `tracing` supports structured fields, span-based timing, and multiple subscribers (stdout + file + filtering)
- Replacing `println!`/`eprintln!` with `tracing` macros (`info!`, `warn!`, `error!`, `debug!`) is a gradual migration — can coexist
- Log file location should use Tauri's `app_log_dir()` for platform-appropriate paths
- `tracing-appender` provides non-blocking file writers with daily rotation
- The existing `export_diagnostics` command should be updated to bundle the log file contents with the current static diagnostics

## Existing Error Types

- `AudioError` (`crates/mt-tauri/src/audio/error.rs:1-50`) — thiserror enum with FileOpen, UnsupportedFormat, Decode, Playback, NoTrack, Seek, Stream
- `DbError` (`crates/mt-tauri/src/db/mod.rs:31-48`) — thiserror enum with Sqlite, Pool, NotFound, Constraint, Io

These already have good structure and can be logged directly with `tracing::error!`.

## References for Implementation

- Tauri log directory: `tauri::Manager::path().app_log_dir()`
- tracing ecosystem: `tracing`, `tracing-subscriber`, `tracing-appender`
- Current export command: `crates/mt-tauri/src/lib.rs:113-140`
- Current settings UI: `app/frontend/views/settings.html:612-625`, `app/frontend/js/components/settings-view.js:213-242`
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 tracing crate integrated: tracing + tracing-subscriber + tracing-appender added to Cargo.toml and initialized at app startup
- [x] #2 Log file persistence: logs written to a rotating file in the platform app_log_dir (daily rotation, bounded retention)
- [x] #3 export_diagnostics command updated: includes the current and recent log file contents alongside existing static diagnostics
- [x] #4 Backend println!/eprintln! migrated to tracing macros (info!, warn!, error!, debug!) with appropriate levels
- [x] #5 Audio subsystem: log playback start/stop/error, format detection, stream failures, seek operations
- [x] #6 Database subsystem: log connection lifecycle, migration execution, query failures, constraint violations
- [x] #7 Scanner/Watcher subsystem: log scan start/complete with duration and track counts, file I/O errors, missing track detection, watcher start/stop
- [x] #8 IPC commands: log command invocations at debug level, log errors at error level, log slow commands (>500ms) at warn level with duration
- [x] #9 Background tasks: log Last.fm scrobble attempts/retries, loved tracks sync, scheduled rescan triggers
- [x] #10 Frontend error capture: uncaught exceptions and failed IPC calls are reported to the backend and appear in logs
- [x] #11 Log levels configurable: default to info in release builds, debug in dev; respect an environment variable override
- [x] #12 Unit tests verify tracing subscriber initializes and log files are created in the expected location
- [x] #13 Documentation: add a docs/observability.md describing the tracing setup, log file location, log levels, MT_LOG env var, export diagnostics behavior, rotation/retention policy, and frontend error capture
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Verification (manual testing with 9,809 track library)

**Log file**: `~/Library/Logs/com.mt.desktop/mt.log.2026-02-17` created on startup, daily rotation confirmed.

**Startup logging verified**:
- `INFO mt_lib: Tracing initialized log_dir=...`
- `INFO mt_lib::db: Opening database path=...`
- `INFO mt_lib::db: Running schema init and migrations`
- `DEBUG` for artwork cache, watcher manager
- `INFO` for audio engine, media keys, MCP bridge
- `INFO mt_lib: Watched folder watchers started active=0`
- `INFO mt_lib: Last.fm scrobble retry task started (5-minute interval)`
- `INFO mt_lib: Last.fm loved tracks matcher started (30-minute interval)`

**Scan logging verified** (~/Music, 9,809 tracks):
- Scan complete log with all structured fields: `duration_ms=36110 added=9809 modified=0 reconciled=0 recovered=0 unchanged=0 deleted=0 errors=34`
- `WARN mt_lib::logging: Slow IPC command command="scan_paths_to_library" duration_ms=36110`

**Frontend error capture verified**:
- `ERROR mt::frontend: Unhandled rejection: undefined is not an object (evaluating 'Alpine.store('player').stop')` with full stack trace captured from window.onunhandledrejection

**Known issue**: ANSI escape codes leak into the file layer's span context formatting (e.g. `[3mrecursive[0m`). Fix applied (per-layer EnvFilter) but not yet rebuilt. The fix changes the shared EnvFilter to independent per-layer filters so span formatting stays independent between stdout (ANSI) and file (no ANSI) layers.

**Log volume note**: A 9,809-track scan produced ~14MB of log output, mostly from lofty crate DEBUG messages. For production use, recommend `MT_LOG=info,lofty=warn` or switching default level to `info` regardless of build profile.
<!-- SECTION:NOTES:END -->
