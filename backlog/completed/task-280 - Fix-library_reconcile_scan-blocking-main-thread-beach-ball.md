---
id: TASK-280
title: Fix library_reconcile_scan blocking main thread (beach ball)
status: Done
assignee: []
created_date: '2026-02-20 21:28'
updated_date: '2026-02-20 22:45'
labels:
  - bug
  - performance
  - backend
  - frontend
dependencies: []
priority: high
ordinal: 500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Running Settings > Library > "Run Scan" soft-locks the app with a spinning beach ball on macOS. The `library_reconcile_scan` Tauri command at `crates/mt-tauri/src/library/commands.rs:459` is declared as a synchronous `pub fn`, which Tauri runs on the main thread. For large libraries (10k+ tracks), it sequentially stats files, computes SHA-256 hashes (128KB reads per file), and performs DB writes — all blocking the event loop.

The fix is to make the command `async`, move fingerprint/hash computation into `tokio::task::spawn_blocking` with rayon parallelization, add progress events, and add a progress bar to the frontend UI.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 library_reconcile_scan command is async (does not block main thread)
- [x] #2 Fingerprint computation uses rayon parallel iteration via spawn_blocking
- [x] #3 ReconcileProgressEvent emitted during scan with phase/current/total
- [x] #4 Frontend shows progress bar during reconcile scan
- [x] #5 UI remains responsive during scan (no beach ball)
- [x] #6 Existing E2E tests pass
- [x] #7 New E2E tests verify progress display and non-blocking behavior
- [x] #8 New Rust unit tests for ReconcileProgressEvent serialization
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Files to Modify

1. `crates/mt-tauri/src/library/commands.rs` — `fn` → `async fn`, `spawn_blocking` + rayon, progress emission
2. `crates/mt-tauri/src/events.rs` — Add `ReconcileProgressEvent`, trait method, impl, tests
3. `app/frontend/js/components/settings-view.js` — Progress state, event listener
4. `app/frontend/views/settings.html` — Progress bar template
5. `app/frontend/tests/library-settings.spec.js` — Progress + non-blocking E2E tests

## Approach

- Make `library_reconcile_scan` async, clone `db.inner()` (Arc), move fingerprint I/O into `spawn_blocking` + rayon `par_iter()`
- Keep DB writes sequential (SQLite single-writer)
- Emit `reconcile:progress` events every 100 tracks
- Frontend subscribes via `listen()`, shows progress bar, unsubscribes in `finally`

## Patterns to Reuse

- `scan_paths_to_library` (async + State pattern) — `scanner/commands.rs:83`
- Rayon par_iter with AtomicUsize — `scanner/commands.rs:205`
- spawn_blocking — `watcher.rs:389`
- EventEmitter trait — `events.rs:394`
<!-- SECTION:PLAN:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Changes

### Backend (`crates/mt-tauri/src/`)

**events.rs**
- Added `ReconcileProgressEvent` struct with `phase`, `current`, `total` fields
- Added `fingerprinting()`, `deduplicating()`, `complete()` constructors
- Added `emit_reconcile_progress()` to `EventEmitter` trait and `AppHandle` impl
- Added 6 unit tests for serialization, constructors, clone, and event name
- Added to event name consistency and clone aggregate tests

**library/commands.rs**
- Converted `library_reconcile_scan` from `pub fn` to `pub async fn`
- Wrapped all work in `tokio::task::spawn_blocking` to avoid blocking the main thread
- Fingerprint + SHA-256 computation uses `rayon::par_iter()` for parallel I/O
- Error counting uses `AtomicU32` for thread-safe accumulation
- Emits `ReconcileProgressEvent` every 100 tracks during fingerprinting phase
- Emits progress during deduplication phase
- Emits `complete` event when done
- DB writes remain sequential (SQLite single-writer constraint)

### Frontend

**js/components/settings-view.js**
- Added `progress` field to `reconcileScan` state
- `runReconcileScan()` subscribes to `reconcile:progress` via `listen()`, unsubscribes in `finally`

**views/settings.html**
- Added progress bar with phase label and `current / total` counter
- Progress bar shows during fingerprinting and deduplication phases
- Hidden when phase is `complete` or scan finishes

### Tests

**E2E (library-settings.spec.js)**
- Added `event.listen` mock to existing Tauri mock setup (fixed webkit test failures)
- Added test: progress bar displays during reconcile scan with mock progress events
- Added test: UI remains responsive during scan (can navigate to other settings sections)
- All 8 tests pass (6 existing + 2 new)

**Rust**
- 594 tests pass, 0 failures
- 0 new clippy warnings
<!-- SECTION:FINAL_SUMMARY:END -->
