---
id: TASK-272
title: Bulk track removal is too slow (sequential single-track IPC calls)
status: In Progress
assignee: []
created_date: '2026-02-16 21:05'
updated_date: '2026-02-17 17:54'
labels:
  - performance
  - ux
dependencies:
  - TASK-272.01
  - TASK-272.02
  - TASK-272.03
priority: high
ordinal: 375
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

Removing all tracks from the music library takes 10-15 seconds for just 239 tracks. This is untenable for large libraries and makes the UX feel broken.

## Root Cause

The removal path is sequential single-track deletions over IPC:

1. **Frontend** (`app/frontend/js/components/library-browser.js:1565-1595`): `removeSelected()` loops through tracks with `for...of` + `await`, calling `this.library.remove(track.id)` one at a time.
2. **Store** (`app/frontend/js/stores/library.js:900`): `remove(trackId)` calls `api.library.deleteTrack(trackId)` — single track per IPC roundtrip.
3. **API** (`app/frontend/js/api.js:182-194`): `deleteTrack(id)` invokes the Tauri command `library_delete_track` with a single `trackId`.
4. **Backend command** (`crates/mt-tauri/src/library/commands.rs:135-152`): `library_delete_track` calls `library::delete_track(&conn, track_id)` for one track, then emits an event per deletion.
5. **Database** (`crates/mt-tauri/src/db/library.rs:362-402`): `delete_track()` runs 3 separate DELETE queries (favorites, playlist_items, library) per track with no explicit transaction.

For 239 tracks this produces:
- 239 Tauri IPC roundtrips (~20ms each = ~4.8s minimum)
- 717 individual SQL statements (3 per track), each auto-committed
- 239 event emissions

A `delete_tracks_bulk()` function already exists in the database layer (`db/library.rs`) that batches all three DELETEs, but no Tauri command exposes it to the frontend.

## Solution Direction

- Expose a bulk delete Tauri command (e.g. `library_delete_tracks`) that accepts a `Vec<i64>` of track IDs
- Wrap the bulk delete in a single SQLite transaction
- Emit a single `library_updated` event with all deleted IDs
- Update the frontend to call the bulk command instead of looping
- Update the frontend store to remove all tracks from local state in one pass
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Removing 239 tracks completes in under 1 second
- [x] #2 A bulk delete Tauri command exists that accepts multiple track IDs
- [x] #3 Bulk deletion is wrapped in a single SQLite transaction
- [x] #4 Only one library_updated event is emitted per bulk operation (not per track)
- [x] #5 Frontend calls the bulk command instead of looping single deletes
- [x] #6 Unit tests exist for the bulk delete Tauri command covering: empty list, valid IDs, mixed valid/invalid IDs, and referential cleanup (favorites, playlist_items)
- [x] #7 Existing single-track delete_track() and its behavior are not broken
- [x] #8 E2E test verifies removing multiple tracks from the library browser completes without error

- [ ] #9 Deleting all tracks from a 13k+ library completes in under 2 seconds without UI freeze
- [ ] #10 Scanning/adding 13k+ files does not freeze the UI (debounced library refreshes)
- [ ] #11 App startup with 13k+ tracks in the library is responsive within 3 seconds
- [ ] #12 Loading library views (Music, Liked Songs, Recently Played, Recently Added, Top 25) with 13k+ tracks does not freeze
- [ ] #13 Empty library state message is centered in the viewport across all views
- [ ] #14 Watched folder auto-removal after delete-all updates the Settings UI without requiring manual removal
- [ ] #15 No duplicate tracks inserted when scanner runs (UNIQUE constraint or INSERT OR IGNORE on filepath)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementation Summary

### Backend
- **DB layer** (`crates/mt-tauri/src/db/library.rs`): Added `delete_tracks_by_ids()` that accepts `&[i64]` and wraps all three DELETEs (favorites, playlist_items, library) in a single SQLite transaction via `unchecked_transaction()`.
- **Tauri command** (`crates/mt-tauri/src/library/commands.rs`): Added `library_delete_tracks` command accepting `Vec<i64>`, calling the bulk DB function, emitting a single `LibraryUpdatedEvent::deleted(track_ids)` event.
- **Registration** (`crates/mt-tauri/src/lib.rs`): Registered the new command in both the import and `generate_handler` macro.

### Frontend
- **API** (`app/frontend/js/api.js`): Added `deleteTracks(ids)` method invoking `library_delete_tracks`.
- **Store** (`app/frontend/js/stores/library.js`): Added `removeBulk(trackIds)` that calls the bulk API, updates local state in one pass using a `Set` for O(1) lookups, and removes deleted tracks from the queue.
- **Component** (`app/frontend/js/components/library-browser.js`): Updated `removeSelected()` to collect all track IDs and call `removeBulk()` in a single IPC call instead of looping.

### Tests
- 6 unit tests in `db/library.rs`: empty list, valid IDs, mixed valid/invalid, favorites cleanup, playlist_items cleanup, single delete still works.
- 1 E2E test in `library.spec.js`: verifies bulk removal of all tracks completes without error.
- Mock route added in `mock-library.js` for the bulk delete endpoint.

## Fix: Queue removal was also sequential

The initial implementation replaced the sequential library delete IPC loop but left a sequential queue removal loop in `removeBulk()`. Each `queue.remove(i)` called `api.queue.remove(index)` — one IPC roundtrip per track.

**Fix in `stores/library.js`**: Replaced the `queue.remove()` loop with:
1. Filter `queue.items` in one pass using the same `idSet` (single Alpine reactive update)
2. Filter `queue._originalOrder` to stay in sync
3. Adjust `currentIndex` based on how many items before it were removed
4. Sync to backend with `api.queue.clear()` + `api.queue.add(remainingIds)` — 2 IPC calls max

**Before**: N queue items → N IPC calls + N DOM re-renders
**After**: N queue items → 1 DOM re-render + 2 IPC calls

## Stability Fixes (from crash debugging)

While testing bulk deletion, a deterministic SIGBUS crash at `0x161746164` was discovered on startup. Root cause: the Zig FFI inventory scanner (`run_inventory_zig`) corrupts heap memory when called concurrently from multiple tokio-runtime-worker threads (triggered by overlapping watched folders).

### Fixes applied:
1. **`crates/mt-tauri/src/scanner/scan.rs`**: Switched from `run_inventory_zig` (Zig FFI) to `run_inventory` (pure Rust walkdir-based scanner). This eliminated the crash.
2. **`crates/mt-tauri/src/db/mod.rs`**: Moved PRAGMAs into `with_init` so they apply to all pool connections (not just the first). Added `busy_timeout = 5000` to prevent SQLITE_BUSY under concurrent writes.
3. **`crates/mt-tauri/src/watcher.rs`**: Added `rescan_semaphore` (tokio::sync::Semaphore) to serialize concurrent rescan operations from overlapping watched folders.

### Note: Instant track deletion from library still not functional
The UI-level instant deletion (removing tracks from the visible library list immediately on delete) is **blocked by the Zig FFI removal** (task-274). The `library_updated` event triggers a full library reload which re-invokes the Zig scanner. Once task-274 lands and the Zig FFI layer is fully removed, the instant deletion UX can be finalized.

## Session 2: Performance & UX Fixes for Large Libraries (13k+ tracks)

### Backend Changes
- **`library_delete_all` command** (`commands.rs`): Single IPC call to wipe entire library (DELETE FROM favorites, playlist_items, library)
- **`library_delete_tracks` batch command** (`commands.rs`): Accepts `Vec<i64>`, deletes by ID array in one call
- **`delete_tracks_by_ids()` and `delete_all_tracks()`** added to `db/library.rs`
- Registered both new commands in `lib.rs`

### Frontend Changes
- **`library-browser.js` `removeSelected()`**: Rewritten to use `library_delete_all` (full wipe) or `library_delete_tracks` (batch by IDs) — single IPC call instead of 13k parallel calls
- **`library.js` `removeTracksLocally()`**: Added fast path — when deleting all tracks, directly sets empty arrays instead of filtering 13k items through Alpine's reactive proxy
- **`events.js`**: Added 500ms debounce on `fetchTracks()` for `library-updated` events during scanning — prevents overlapping full library reloads that froze the WebView
- **`settings-view.js` `removeWatchedFolder()`**: Made resilient to "not found" errors — after delete-all auto-removes folders, manual X click no longer shows error toast
- **`library.html`**: Fixed empty state centering using `absolute inset-0` positioning within `min-h-full relative` track-list container (avoids breaking virtual scroll)

### Known Issues
- **Duplicate tracks**: Scanner can insert duplicates if it runs twice (no UNIQUE constraint on filepath in library table). Needs schema migration.
- **Startup performance**: 13k+ track libraries still show slow initial load
- **Virtual scroll + empty state**: CSS centering approach (`min-h-full` + `absolute inset-0`) needs confirmation

## Session 3: Bulk Operations Performance — Eliminating Soft-Locks at 7-13k Tracks

All three subtasks (272.01, 272.02, 272.03) implemented and marked Done.

### Summary of changes

**Phase 1: Transaction wrapping + event emission** (272.01)
- `scanner/commands.rs`: All scan DB writes wrapped in `db.transaction()`. Bulk inserts chunked into 500-track transactions.
- `library/commands.rs`: `library_delete_tracks`, `library_delete_all`, `library_purge_missing` use `db.transaction()` and emit `LibraryUpdatedEvent::deleted(...)` on success.
- Removed dead `scope_fingerprints_to_paths` and `get_db_fingerprints`.

**Phase 2: Reduce frontend churn** (272.02)
- `library.js`: `removeTracksLocally()` filters `filteredTracks` directly (O(n)) instead of `applyFilters()` (O(n log n)). Added `_dataVersion` counter.
- `albums-browser.js`: `albumList` getter memoized via version tracking.
- `artists-browser.js`: `_canonicalArtistMap` and `artists` getters memoized.

**Phase 3: Scan pipeline optimization** (272.03)
- `scanner/commands.rs`: Batch reconciliation via pre-fetched HashMaps (O(1) vs per-file DB queries). SQL-scoped fingerprint queries. Precomputed hash threading to avoid redundant SHA-256.
- `db/library.rs`: New `get_fingerprints_for_paths()` for SQL-level scoping.

**Tests**: 547 passed (+4 new), 0 failed, 0 warnings. New tests: `test_bulk_delete_cleans_all_tables`, `test_get_fingerprints_for_paths`, 2 benchmark variants.

**Docs**: Updated `spacedrive-analysis-improvements.md` — fixed stale Zig FFI reference, added Status column to recommendations, updated appendix line numbers.

### Remaining unchecked ACs on parent
- #1 (239 tracks < 1s): Already done in session 1/2
- #9 (13k delete < 2s): Needs manual testing with real library
- #10 (scan 13k no freeze): Needs manual testing
- #11 (startup 13k responsive): Needs manual testing
- #12 (view loading 13k): Needs manual testing
- #13 (empty state centering): Done in session 2, needs confirmation
- #14 (watched folder auto-removal): Needs testing
- #15 (no duplicate tracks): Needs schema migration (UNIQUE constraint on filepath)

## Session 4: Observability for Performance Diagnosis

With task-277 (tracing integration) complete, all bulk operations now have structured logging and timing instrumentation.

### How to diagnose performance issues

**Log file location**: `~/Library/Logs/com.mt.desktop/mt.log.YYYY-MM-DD`

**Slow command detection**: Any IPC command exceeding 500ms is logged at WARN level:
```
WARN mt_lib::logging: Slow IPC command command="scan_paths_to_library" duration_ms=36110
```

Instrumented commands with `log_slow_command`:
- `scan_paths_to_library` — full scan with add/modified/reconciled/recovered/deleted counts
- `library_delete_tracks` — bulk delete by ID array
- `library_delete_all` — full library wipe
- `library_purge_missing` — purge missing tracks
- `lastfm_import_loved_tracks`, `lastfm_cache_loved_tracks`, `lastfm_match_loved_tracks`, `lastfm_queue_retry`

**Scan complete log** includes all counts and duration:
```
INFO mt_lib::scanner::commands: Scan complete duration_ms=36110 added=9809 modified=0 reconciled=0 recovered=0 unchanged=0 deleted=0 errors=34
```

**Override log level** with `MT_LOG` env var:
```bash
# Trace-level for scanner only
MT_LOG=mt_tauri::scanner=trace task tauri:dev

# Debug everything
MT_LOG=debug task tauri:dev
```

**Export logs**: Settings > Export Logs now bundles up to 3 days of log files (5MB cap) with the static diagnostics.

### Verification findings (9,809 track library scan)

- Scan of ~/Music (9,809 tracks): 36.1 seconds, 34 errors (unsupported formats)
- `log_slow_command` correctly flagged the scan at WARN level
- Frontend error capture working: caught queue.js store initialization race condition
- Background task logging confirmed: scrobble retry (5min) and loved tracks matcher (30min) intervals logged
- Log file grew to ~14MB during scan due to lofty crate DEBUG output; consider filtering with `MT_LOG=info,lofty=warn` for production
<!-- SECTION:NOTES:END -->
