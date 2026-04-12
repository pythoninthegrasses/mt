---
id: TASK-314
title: Cursor-based pagination for library track loading
status: In Progress
assignee: []
created_date: '2026-04-12 06:55'
updated_date: '2026-04-12 06:59'
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
ordinal: 2000
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
- [ ] #1 Backend exposes library_get_count command returning total track count and duration for current filter
- [ ] #2 Backend library_get_all supports cursor-based pagination with configurable page_size
- [ ] #3 Frontend library store uses sparse page map instead of loading all tracks into flat arrays
- [ ] #4 Virtual scroll fetches pages on demand as user scrolls, with 1-page prefetch ahead of scroll direction
- [ ] #5 Skeleton/shimmer placeholder rows display while pages are loading
- [ ] #6 getTrack(id) falls back to single-track IPC call if track is not in a loaded page
- [ ] #7 Search and sort changes invalidate page cache and re-fetch from page 0
- [ ] #8 Initial library load transfers only count metadata + first page (500 tracks)
- [ ] #9 All existing Rust, Vitest, and Playwright E2E tests pass
<!-- AC:END -->
