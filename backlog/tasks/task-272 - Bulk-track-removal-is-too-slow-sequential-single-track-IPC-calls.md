---
id: TASK-272
title: Bulk track removal is too slow (sequential single-track IPC calls)
status: In Progress
assignee: []
created_date: '2026-02-16 21:05'
updated_date: '2026-02-17 01:34'
labels:
  - performance
  - ux
dependencies:
  - task-274
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
<!-- SECTION:NOTES:END -->
