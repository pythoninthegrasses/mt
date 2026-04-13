---
id: TASK-313
title: Alpine.js batch updates for library store mutations
status: Done
assignee: []
created_date: '2026-04-12 06:55'
updated_date: '2026-04-13 17:48'
labels:
  - performance
  - frontend
dependencies: []
references:
  - app/frontend/js/utils/library-operations.js
  - app/frontend/js/stores/library.js
documentation:
  - 'https://alpinejs.dev/globals/alpine-data'
priority: high
ordinal: 6000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The library store triggers 5-6 sequential reactive property assignments during load and track removal, causing Alpine.js computed getters (visibleTracks, totalContentHeight, startIndex, endIndex, offsetY) to re-evaluate multiple times per operation instead of once.

## Problem

In `app/frontend/js/utils/library-operations.js`, `loadLibraryData()` (lines 194-206) assigns to `store.tracks`, `store.totalTracks`, `store.totalDuration`, `store.allTracks`, `store._dataVersion`, then calls `store.applyFilters()` which replaces `store.filteredTracks`. Each assignment triggers Alpine reactivity.

Similarly, `removeTracksLocallyOp()` (lines 432-441) does 3 `.filter()` calls assigning to `allTracks`, `tracks`, and `filteredTracks`, plus a `.reduce()` for `totalDuration`.

## Approach

1. Wrap mutation sequences in `Alpine.disableEffectScheduling(callback)` (available since Alpine ~3.10, project uses 3.14.8) so all property changes flush as a single reactive update.
2. If `disableEffectScheduling` is not exposed in 3.14.8, use `Alpine.deferMutations()` / `Alpine.flushMutations()` as the fallback pattern.
3. Inline `applyFilters()` into the batch blocks rather than calling it as a separate method — it just does `this.filteredTracks = [...this.tracks]` (library.js:321-323).
4. Delete unused computed getters `tracksByArtist` (library.js:418-428) and `tracksByAlbum` (library.js:430-440) — grep confirms zero references outside the store definition. These are O(n) getters that fire on every `filteredTracks` change for no benefit.

## Key Files

- `app/frontend/js/utils/library-operations.js` — `loadLibraryData()` (lines 194-206), `removeTracksLocallyOp()` (lines 432-441), `applySectionData()` (lines 20-26), `backgroundRefreshLibrary()` (lines 246-256)
- `app/frontend/js/stores/library.js` — `applyFilters()` (line 321-323), dead getters (lines 418-440)
- `app/frontend/package.json` — verify Alpine version is 3.14.8

## Verification

- Run `window._perfLibLoad` in devtools before/after to compare timing breakdown (already instrumented at library-operations.js:209-216)
- Chrome DevTools Performance tab: record during library load, section switch, and bulk track removal — confirm computed getter evaluations drop from ~5-6x to 1x per operation
- Run existing tests: `cd app/frontend && npx vitest run` and `task test:e2e`
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 loadLibraryData() mutations are batched into a single Alpine reactive flush
- [x] #2 removeTracksLocallyOp() mutations are batched into a single Alpine reactive flush
- [x] #3 applySectionData() and backgroundRefreshLibrary() mutations are batched into a single Alpine reactive flush
- [x] #4 Unused computed getters tracksByArtist and tracksByAlbum are removed from library.js
- [x] #5 All existing Vitest and Playwright E2E tests pass
- [x] #6 No visual regressions in library browser, queue, or now-playing views
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Changes

### `app/frontend/js/utils/library-operations.js`
- **`applySectionData()`**: Wrapped 5 reactive assignments in `window.Alpine.disableEffectScheduling()`, inlined `applyFilters()` as `store.filteredTracks = [...tracks]`
- **`loadLibraryData()`**: Wrapped 7 reactive assignments (tracks, totalTracks, totalDuration, _lastLoadedSection, allTracks, _dataVersion, filteredTracks) in single batch. Moved `_updateCache` outside the batch (non-reactive)
- **`backgroundRefreshLibrary()`**: Wrapped mutations in batch for both same-section (6 assignments) and different-section (2 assignments) paths. Inlined `applyFilters()`
- **`removeTracksLocallyOp()`**: Pre-computed filtered arrays, then assigned all 6 reactive properties in a single batch. Moved `_clearCache()` outside the batch

### `app/frontend/js/stores/library.js`
- Removed unused `tracksByArtist` getter (lines 418-428) and `tracksByAlbum` getter (lines 430-440)

### `app/frontend/__tests__/library.store.test.js`
- Removed `tracksByArtist` and `tracksByAlbum` from test helper store object
- Removed 2 describe blocks (10 tests total) testing the dead getters

## API Used
`Alpine.disableEffectScheduling(callback)` — sets `shouldSchedule = false` during callback execution, preventing Alpine effect scheduling. All reactive property changes are batched and flushed as a single update when the callback returns.
<!-- SECTION:NOTES:END -->
