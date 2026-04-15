---
id: TASK-330
title: Fix library stats bar to use backend totals instead of loaded-page counts
status: Done
assignee: []
created_date: '2026-04-13 17:55'
updated_date: '2026-04-15 02:45'
labels:
  - bug
  - frontend
  - pagination
dependencies: []
references:
  - app/frontend/js/components/player-controls.js
  - app/frontend/js/stores/library.js
  - crates/mt-tauri/src/library/commands.rs
  - crates/mt-tauri/src/db/models.rs
documentation:
  - docs/tauri-architecture.md
priority: high
ordinal: 2500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

The status bar at the bottom-right of the library view (e.g. "1000 files 6.9 GB 2d 21h 38m") shows stats computed from **only the currently loaded tracks**, not the full library. As the user scrolls and more pages load via cursor-based pagination, the numbers increment — reaching the correct total only after every page has been fetched.

## Root Cause

Commit `cb6876d` ("perf(library): paginate track loading with sparse page map and on-demand fetching") introduced cursor-based pagination for the library. The `libraryStats` getter in `player-controls.js:314-322` was not updated — it still iterates `this.library.tracks` (which only contains loaded pages) to sum file count, size, and duration.

```js
// player-controls.js:314-322 — the broken code
get libraryStats() {
  const tracks = this.library.tracks;        // only loaded pages!
  const count = tracks.length;
  const totalBytes = tracks.reduce((sum, t) => sum + (t.file_size || 0), 0);
  const totalSeconds = tracks.reduce((sum, t) => sum + (t.duration || 0), 0);
  ...
}
```

## Available Backend Data

The backend already provides authoritative totals:

1. **`library_get_section` response** includes `total_tracks` (i64) and `total_duration` (f64) — already stored in the frontend as `store.totalTracks` and `store.totalDuration` (library.js:54-55).
2. **`library_get_stats` command** returns `LibraryStats { total_tracks, total_duration, total_size, total_artists, total_albums }` — provides `total_size` (bytes) which is NOT currently used by the frontend.

## Fix

1. Update `libraryStats` getter to use `this.library.totalTracks` and `this.library.totalDuration` instead of reducing over `this.library.tracks`.
2. For file size: either add `total_size` to the `LibrarySectionResponse` so it comes with the first page load, or call `library_get_stats` once on section load and store `totalFileSize` in the library store.
3. Update existing Vitest tests for stats calculation.

## Key Files

| File | Lines | Role |
|------|-------|------|
| `app/frontend/js/components/player-controls.js` | 314-322 | **Stats getter (bug location)** |
| `app/frontend/js/stores/library.js` | 54-55 | Stores `totalTracks`, `totalDuration` from backend |
| `app/frontend/js/utils/library-operations.js` | 299-300 | Sets `store.totalTracks` from section response |
| `crates/mt-tauri/src/library/commands.rs` | 122-130 | `LibrarySectionResponse` struct |
| `crates/mt-tauri/src/library/commands.rs` | 428 | `library_get_stats` command |
| `crates/mt-tauri/src/db/models.rs` | 191-197 | `LibraryStats` struct (has `total_size`) |
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Stats bar shows correct total track count immediately on first page load (matching `total_tracks` from backend)
- [x] #2 Stats bar shows correct total duration immediately on first page load (matching `total_duration` from backend)
- [x] #3 Stats bar shows correct total file size immediately on first page load (matching `total_size` from backend)
- [x] #4 Stats do not change as user scrolls and additional pages load
- [x] #5 Stats update correctly when switching between library sections (all, liked, recently added, etc.)
- [x] #6 Vitest tests cover the updated libraryStats getter with mocked store totals
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Summary

Fixed library stats bar to use backend totals (`totalTracks`, `totalDuration`, `totalFileSize`) instead of computing from loaded tracks array.

### Backend (Rust)
- Added `total_size: i64` to `LibraryCount` and `LibrarySectionResponse` structs
- Updated `get_filtered_count()` SQL to include `SUM(file_size)`
- Updated all 5 stats functions (`get_favorites_stats`, `get_top_25_stats`, `get_recently_played_stats`, `get_recently_added_stats`, `get_playlist_stats`) to return `(i64, f64, i64)` (count, duration, size)
- Updated all 6 section handler functions in `commands.rs` to wire `total_size` through
- Updated all 7 Rust tests for new 3-tuple return types

### Frontend
- Created `app/frontend/js/utils/library-stats.js` with `computeLibraryStats()` pure function
- Replaced `libraryStats` getter in `player-controls.js` to use `computeLibraryStats(totalTracks, totalDuration, totalFileSize)` instead of iterating tracks
- Added `totalFileSize` to library store, all cache operations, all section data paths, and all reset blocks in `library-operations.js`
- Removed dead `formatDurationLong` method and unused `formatBytes` import from player-controls

### Tests
- Created 7 new tests in `library-stats.test.js` (including property-based tests with fast-check)
- Added `totalFileSize` assertions to existing `library-section.test.js` tests
- All 478 Vitest tests pass
- Rust compiles clean (cargo check, clippy, fmt)
<!-- SECTION:FINAL_SUMMARY:END -->
