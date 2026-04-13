---
id: TASK-315
title: Web Worker for library array operations
status: Done
assignee: []
created_date: '2026-04-12 06:56'
updated_date: '2026-04-13 17:48'
labels:
  - performance
  - frontend
dependencies:
  - TASK-314
references:
  - app/frontend/js/stores/library.js
  - app/frontend/js/utils/library-operations.js
priority: low
ordinal: 10000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Several library store operations perform O(n) or O(n log n) array work on the main thread. For very large collections (50k+ tracks), this can cause jank during library load, section switching, and bulk track removal. Moving these operations to a Web Worker unblocks the main thread.

**Note**: This is the lowest-priority optimization. Only implement if profiling after TASK-313 and TASK-314 shows measurable main-thread blocking during array operations. If TASK-314 (pagination) reduces the working set to ~500 tracks per page, the main-thread cost may already be negligible.

## Problem

These operations run synchronously on the main thread:

| Operation | Location | Complexity |
|-----------|----------|------------|
| `applyFilters()` | `library.js:321-323` | O(n) array spread |
| `removeTracksLocallyOp()` | `library-operations.js:432-441` | O(n) x3 filter passes |
| `totalDuration` reduce | `library-operations.js:197` | O(n) |
| `get artists()` | `library.js:408-411` | O(n log n) — map + Set + sort |
| `get albums()` | `library.js:413-416` | O(n log n) — same |
| `_filterByLibrary()` | `library.js:117-121` | O(n) Set build + filter |

Currently no Web Workers exist anywhere in the frontend (`app/frontend/js/`).

## Approach

1. Create `app/frontend/js/workers/library-worker.js` — a dedicated worker that holds the canonical track data and exposes operations via `postMessage`:
   - `setTracks(tracks[])` — receive array from IPC
   - `filterTracks(predicate)` — return filtered subset
   - `removeTracks(ids[])` — return all three filtered arrays in one pass (allTracks, tracks, filteredTracks) to avoid 3 separate O(n) passes
   - `computeStats()` — return `{ totalDuration, artistCount, albumCount }`
   - `getArtists()` / `getAlbums()` — return sorted unique lists

2. Use `Transferable` objects (via `structuredClone` with transfer list) when sending large arrays to/from the worker to avoid copying overhead.

3. Wrap the worker in a promise-based API (request ID pattern) so store methods can `await` results:
   ```js
   // Example usage in library.js
   const filtered = await this._worker.removeTracks(trackIds);
   // Returns { allTracks, tracks, filteredTracks, totalDuration } in one message
   ```

4. `applyFilters()` and other store methods become async. Callers in `library-operations.js` already use async/await so the change is compatible.

5. Vite handles `new Worker(new URL('./workers/library-worker.js', import.meta.url))` natively — no config changes needed.

### Dependency on TASK-314

If TASK-314 (pagination) is implemented first, the worker's role shifts from processing the full track array to processing individual pages. The worker API should be designed to handle both scenarios:
- Pre-pagination: worker holds full track array
- Post-pagination: worker processes page-level operations and aggregates stats across loaded pages

## Key Files

| File | Change |
|------|--------|
| `app/frontend/js/workers/library-worker.js` | New — worker implementation |
| `app/frontend/js/stores/library.js` | Initialize worker in `init()`, delegate `applyFilters()`, `_filterByLibrary()`, computed getters |
| `app/frontend/js/utils/library-operations.js` | Delegate filter/reduce operations in `removeTracksLocallyOp()` and `loadLibraryData()` to worker |
| `app/frontend/vite.config.js` | Likely no change (Vite handles worker imports), but verify |

## Verification

- Chrome DevTools Performance tab: record during library load with 50k+ tracks — confirm main thread has no long tasks (>50ms) from array operations
- Compare `window._perfLibLoad` breakdown before/after — `applyFilters_ms` and `process_ms` should approach 0 on main thread
- Worker communication overhead should be <5ms per round trip (measure with Performance.mark/measure)
- Run `cd app/frontend && npx vitest run` and `task test:e2e`
- Test worker termination and re-initialization (e.g., after error)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A dedicated Web Worker handles library array filter, reduce, and sort operations off the main thread
- [ ] #2 removeTracksLocallyOp() computes all three filtered arrays in a single worker round trip instead of 3 separate main-thread passes
- [ ] #3 Worker uses Transferable objects for large array transfers to minimize copy overhead
- [ ] #4 Store methods that delegate to the worker are async and integrate with Alpine batch updates from TASK-313
- [ ] #5 Main thread shows no long tasks (>50ms) from array operations during library load with 50k+ tracks
- [ ] #6 Worker gracefully handles errors and can be re-initialized
- [ ] #7 All existing Vitest and Playwright E2E tests pass
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Closed without implementation

TASK-314 (cursor-based pagination) reduced the per-operation working set from the full track collection to 500 tracks per page. At that size, `.filter()`, `.reduce()`, and array spread operations complete in sub-millisecond time on the main thread — well below the 50ms long-task threshold this task was targeting.

The task description itself anticipated this outcome: "Only implement if profiling after TASK-313 and TASK-314 shows measurable main-thread blocking. If TASK-314 reduces the working set to ~500 tracks per page, the main-thread cost may already be negligible."

Adding a Web Worker would introduce async complexity, message serialization overhead, and harder debugging for no measurable benefit. Marked as done on 2026-04-12.
<!-- SECTION:NOTES:END -->
