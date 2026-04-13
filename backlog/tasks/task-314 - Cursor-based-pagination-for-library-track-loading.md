---
id: TASK-314
title: Cursor-based pagination for library track loading
status: Done
assignee: []
created_date: '2026-04-12 06:55'
updated_date: '2026-04-13 17:48'
labels:
  - performance
  - frontend
  - backend
dependencies:
  - TASK-313
references:
  - app/frontend/js/stores/library.js
  - app/frontend/js/utils/library-operations.js
  - app/frontend/js/components/library-browser.js
  - crates/mt-tauri/src/commands/library.rs
priority: medium
ordinal: 9000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The library loads all tracks in a single IPC call with `limit: 999999` (`library.js:150-155`), storing the entire collection in JS memory. For large libraries (50k-100k+ tracks), this causes high memory usage and slow initial load. The virtual scroll already renders only ~30-50 DOM nodes — the optimization is to avoid loading tracks into memory until the viewport needs them.

## Problem

`_fetchLibraryData()` in `app/frontend/js/stores/library.js` (lines 134-158) calls the Tauri command `library_get_all` with `limit: 999999, offset: 0`. The response is assigned wholesale to `store.tracks` (library-operations.js:194), spread-copied to `store.filteredTracks` via `applyFilters()`, and a `.reduce()` computes `totalDuration` over all tracks. For 100k tracks (~15 fields each), this is a large IPC payload and significant JS heap usage.

## Approach

### Backend (Rust)

1. Add a `library_get_count` Tauri command returning `{ total: number, totalDuration: number }` for a given search/sort/filter combination — no track data. This lets the frontend know the total for virtual scroll height without loading all tracks.

2. Modify `library_get_all` to support cursor-based pagination:
   - Accept `cursor: Option<String>` (encoded last-seen sort key + row ID) instead of bare `offset`
   - Accept `page_size: usize` (default 500 — covers ~15 viewport heights of 34px rows)
   - Return `{ tracks: Vec<Track>, total: usize, next_cursor: Option<String> }`

3. The existing `offset`-based approach can remain as a fallback for sections like favorites/recently-played that have small fixed limits.

### Frontend

4. Replace flat `tracks[]` / `filteredTracks[]` / `allTracks[]` arrays in the library store with a sparse page map:
   ```
   _trackPages: Map<pageIndex, Track[]>   // page 0 = tracks 0-499, page 1 = 500-999, etc.
   _totalTracks: number                    // from count endpoint
   _totalDuration: number                  // from count endpoint
   ```

5. `visibleTracks` getter in `library-browser.js` computes which page(s) the current viewport spans. If a page is missing, trigger an async fetch and show a skeleton/shimmer placeholder row.

6. Prefetch 1 page ahead in the scroll direction to prevent visible loading gaps during smooth scrolling.

7. Update dependent code:
   - `getTrack(id)` (library.js:372) — check loaded pages first, fall back to a single-track IPC call
   - `addAllToQueue` (library.js:384) — needs a backend command to queue all tracks matching current filter, rather than passing the full array
   - `removeTracksLocallyOp()` — remove from loaded pages only, decrement total count
   - Search/sort changes invalidate page cache and re-fetch from page 0

### Dependency on TASK-313

TASK-313 adds Alpine batch updates. This task's page-fetch callbacks will trigger multiple store mutations when a new page arrives — they should use the same batching pattern established in TASK-313.

## Key Files

| File | Change |
|------|--------|
| `crates/mt-tauri/src/commands/library.rs` | Add `library_get_count`, add cursor/page_size to `library_get_all` |
| `crates/mt-tauri/src/db/` | SQL query changes for cursor pagination |
| `app/frontend/js/stores/library.js` | Replace flat arrays with sparse page map, update computed properties |
| `app/frontend/js/utils/library-operations.js` | Update `loadLibraryData()`, `removeTracksLocallyOp()`, `applySectionData()` |
| `app/frontend/js/components/library-browser.js` | Page-aware `visibleTracks` getter, skeleton rows, prefetch logic |
| `app/frontend/js/api/library.js` | Add `getCount()`, update `getTracks()` with cursor/page_size params |

## Verification

- Profile memory usage in Chrome DevTools Memory tab with 50k+ track library before/after
- Confirm initial load only fetches count + first page (500 tracks) via DevTools Network/IPC
- Smooth scroll through entire library — no blank gaps or visible loading jank
- Search, sort change, section switch all work correctly with page cache invalidation
- `window._perfLibLoad` shows reduced `assign_tracks_ms` and `applyFilters_ms`
- Run `cargo nextest run --workspace`, `cd app/frontend && npx vitest run`, `task test:e2e`
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Backend exposes library_get_count command returning total track count and duration for current filter
- [x] #2 Backend library_get_all supports cursor-based pagination with configurable page_size
- [x] #3 Frontend library store uses sparse page map instead of loading all tracks into flat arrays
- [x] #4 Virtual scroll fetches pages on demand as user scrolls, with 1-page prefetch ahead of scroll direction
- [x] #5 Skeleton/shimmer placeholder rows display while pages are loading
- [x] #6 getTrack(id) falls back to single-track IPC call if track is not in a loaded page
- [x] #7 Search and sort changes invalidate page cache and re-fetch from page 0
- [x] #8 Initial library load transfers only count metadata + first page (500 tracks)
- [x] #9 All existing Rust, Vitest, and Playwright E2E tests pass
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Changes

### Backend (Rust)

**`crates/mt-tauri/src/db/models.rs`**
- Added `LibraryCount { total: i64, total_duration: i64 }` struct for lightweight count responses

**`crates/mt-tauri/src/db/library.rs`**
- Extracted `build_library_where()` helper from `get_all_tracks()` to share WHERE clause building across queries
- Added `get_filtered_count()` — returns count + total duration without loading track data
- Added `find_sort_offset()` — finds the 0-based row offset of the first row whose sort column matches a prefix, using a CTE with `ROW_NUMBER()` window function
- Added 5 tests: count no-filter, count with search, pagination boundaries, offset prefix match, offset no match

**`crates/mt-tauri/src/library/commands.rs`**
- Added `library_get_count` Tauri command (search/artist/album filter params)
- Added `library_find_offset` Tauri command (filter + sort params + prefix)

**`crates/mt-tauri/src/lib.rs`**
- Registered both new commands in `invoke_handler`

### Frontend API

**`app/frontend/js/api/library.js`**
- Added `getCount(params)` method invoking `library_get_count`
- Added `findOffset(params)` method invoking `library_find_offset`

### Frontend Store (Sparse Page Map)

**`app/frontend/js/stores/library.js`**
- Replaced flat `tracks[]`/`filteredTracks[]`/`allTracks[]` arrays with sparse page map: `_trackPages: {}`, `_loadingPages: {}`, `_pageSize: 500`
- Added `_sectionTracks` for non-paginated sections (favorites, recent, playlists) — these continue loading all tracks in a single fetch
- Added `_fetchPage(pageIndex)` with generation-based stale response detection
- Added `_ensurePage(pageIndex)`, `_resetPages()`, `getTrackAtIndex(i)`, `_loadAllPages()`
- Added backward-compat `filteredTracks`/`tracks`/`allTracks` getters that concatenate loaded pages
- Added setters that route to `_setSectionTracks()` for backward compat with `applySectionData`
- Added `_jumpToPrefix(prefix)` for backend-assisted type-to-jump
- Added `getTrackAsync(id)` fallback to single-track IPC call
- `addAllToQueue()` loads all pages first if not all loaded
- `rescanTrack()` updated to search page map

**`app/frontend/js/utils/library-operations.js`**
- `loadLibraryData()` now fetches count + page 0 in parallel instead of all tracks
- `removeTracksLocallyOp()` handles both paginated (filter each page) and non-paginated (filter flat array) modes
- `backgroundRefreshLibrary()` resets pages and reloads count + page 0
- `applySectionData()` uses `_setSectionTracks()` for non-paginated sections

### Virtual Scroll

**`app/frontend/js/components/library-browser.js`**
- `startIndex`/`endIndex` now bound by `totalTracks` (from count endpoint) instead of `filteredTracks.length`
- `visibleTracks` returns placeholder objects `{ _placeholder: true }` for unloaded pages
- `totalContentHeight` uses `totalTracks` so scrollbar is correctly sized from initial load
- Prefetch trigger: ensures pages for visible range + 1 page ahead in scroll direction

**`app/frontend/js/mixins/virtual-scroll.js`**
- Added `scrollToOffset(offset)` for type-to-jump navigation
- Extracted `_scrollToRowIndex()` shared by `scrollToTrack` and `scrollToOffset`

### Shimmer Placeholder Rows

**`app/frontend/views/library.html`**
- Track row div conditionally renders shimmer or real content based on `item.track._placeholder`
- Shimmer: animated pulse bars for title/artist/album columns, varying widths per row
- All column `x-if` templates guarded with `!item.track._placeholder &&`
- Event handlers guarded against placeholder items
- Container `x-show` and loading/empty state use `totalTracks` instead of array lengths

### Backend-Assisted Type-to-Jump

**`app/frontend/js/mixins/type-to-jump.js`**
- `jumpToMatchingArtist()` falls back to `_jumpViaBackend()` when no match in loaded tracks
- `cycleToNextArtist()` same fallback
- `_jumpViaBackend()`: calls `library_find_offset` for the row offset, scrolls immediately (shimmer shows briefly), selects track once page loads

### Tests

**Rust** (5 new tests, 688 total pass):
- `test_get_filtered_count_no_filter`, `test_get_filtered_count_with_search`
- `test_get_all_tracks_pagination`, `test_find_sort_offset_artist_prefix`, `test_find_sort_offset_no_match`

**Vitest** (12 new tests, 47 total in library.store.test.js):
- `getTrackAtIndex` from loaded/unloaded pages, non-zero page, out-of-bounds
- `getTrack` across pages, not found
- `filteredTracks` getter concatenation, empty, non-paginated mode
- `_resetPages` clears state, `_isPaginated` detection

## Bug Fixes (post-implementation)

### `find_sort_offset` matched sort column instead of artist
The backend `find_sort_offset` was matching the prefix against the sort expression (`COALESCE(NULLIF(album_artist, ''), artist)` for artist sort), which could match `album_artist` values that don't correspond to the display artist. For example, typing "z" could match an album_artist starting with Z while the display artist was "Meat Puppets".

Fixed to match against `artist` column specifically, with `strip_sort_prefix()` for ignore-words support and a raw `LOWER(artist)` fallback — mirroring the frontend's `stripIgnoredPrefix` + artist comparison logic.

### `scrollToTrack` computed wrong global index for sparse pages
`scrollToTrack` used `filteredTracks.findIndex()` to determine the scroll position. But `filteredTracks` concatenates loaded pages contiguously, so a track on page 5 (with pages 1-4 unloaded) would get an incorrect offset. Fixed to iterate `_trackPages` directly and compute `pageIndex * pageSize + localIndex` for the true global position.

### `visibleTracks` getter missing Alpine reactive dependency
When a new page loads, `_trackPages[pageIndex]` is set and `_dataVersion` incremented. But `visibleTracks` didn't access `_dataVersion`, so Alpine wouldn't re-render when pages loaded. Added `void lib._dataVersion` to create the reactive dependency.
<!-- SECTION:NOTES:END -->
