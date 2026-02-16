---
id: TASK-272
title: Bulk track removal is too slow (sequential single-track IPC calls)
status: In Progress
assignee: []
created_date: '2026-02-16 21:05'
updated_date: '2026-02-16 21:10'
labels:
  - performance
  - ux
dependencies: []
references:
  - 'crates/mt-tauri/src/library/commands.rs:135-152'
  - 'crates/mt-tauri/src/db/library.rs:362-402'
  - 'app/frontend/js/components/library-browser.js:1565-1595'
  - 'app/frontend/js/stores/library.js:900'
  - 'app/frontend/js/api.js:182-194'
documentation:
  - docs/tauri-architecture.md
  - docs/testing.md
priority: high
ordinal: 41500
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
- [ ] #2 A bulk delete Tauri command exists that accepts multiple track IDs
- [ ] #3 Bulk deletion is wrapped in a single SQLite transaction
- [ ] #4 Only one library_updated event is emitted per bulk operation (not per track)
- [ ] #5 Frontend calls the bulk command instead of looping single deletes
- [ ] #6 Unit tests exist for the bulk delete Tauri command covering: empty list, valid IDs, mixed valid/invalid IDs, and referential cleanup (favorites, playlist_items)
- [ ] #7 Existing single-track delete_track() and its behavior are not broken
- [ ] #8 E2E test verifies removing multiple tracks from the library browser completes without error
<!-- AC:END -->
