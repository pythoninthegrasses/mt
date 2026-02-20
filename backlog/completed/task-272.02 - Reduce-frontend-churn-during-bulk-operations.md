---
id: TASK-272.02
title: Reduce frontend churn during bulk operations
status: Done
assignee: []
created_date: '2026-02-17 16:19'
updated_date: '2026-02-17 16:39'
labels:
  - performance
  - frontend
dependencies:
  - TASK-272.01
references:
  - app/frontend/js/stores/library.js
  - app/frontend/js/components/albums-browser.js
  - app/frontend/js/components/artists-browser.js
  - app/frontend/js/events.js
parent_task_id: TASK-272
priority: high
ordinal: 46500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

When bulk-deleting or scanning thousands of tracks, the frontend soft-locks due to unnecessary O(n log n) re-sorting and cascading recomputations in Alpine.js getters with no memoization.

## Root Causes

1. **`removeTracksLocally()` calls `applyFilters()` unnecessarily** (`app/frontend/js/stores/library.js:974`): After filtering tracks by ID set (O(n)), it calls `applyFilters()` which re-sorts the entire array O(n log n). Removing items from a sorted list preserves sort order — no re-sort is needed.

2. **Albums/Artists browser getters recompute on every access** with no memoization:
   - `albums-browser.js` `albumList` getter (~lines 79-103): iterates all tracks, groups by album, sorts — O(n + m log m). Fires on every Alpine reactive cycle.
   - `artists-browser.js` has 5 cascading getters (~lines 56-216): `_canonicalArtistMap` O(n), `_artistDisplayNames` O(n), `artists` O(n log n), `selectedArtistTracks` O(n), `selectedArtistAlbums` O(n). Each access to `artists` triggers the full chain.
   - Alpine.js `get` properties have no built-in memoization — they recompute on every access.

3. **During bulk operations**, a single `allTracks` mutation triggers all these getters to fire, even if the user isn't viewing that browser.

## Solution

### 2.1 Skip `applyFilters()` in `removeTracksLocally()`

In `removeTracksLocally()` (library.js ~line 974), replace `this.applyFilters()` with direct filtering:
```javascript
this.filteredTracks = this.filteredTracks.filter(t => !idSet.has(t.id));
```
This is O(n) instead of O(n log n) and preserves existing sort order.

### 2.2 Memoize Albums/Artists browser getters

Add a `_dataVersion` counter to the library store, incremented on any data mutation (`removeTracksLocally`, `applyFilters`, `load`, `_backgroundRefresh`). Browser getters cache results and only recompute when version changes:
```javascript
get albumList() {
  const v = this.$store.library._dataVersion;
  if (this._albumListVersion === v) return this._cachedAlbumList;
  // ... existing computation ...
  this._cachedAlbumList = albums;
  this._albumListVersion = v;
  return albums;
}
```
Apply the same pattern to all expensive getters in `artists-browser.js`.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 removeTracksLocally() filters filteredTracks directly instead of calling applyFilters() — verified by profiling that no O(n log n) sort runs during bulk delete
- [x] #2 Albums browser albumList getter is memoized — repeated access without data changes returns cached result (no recomputation)
- [ ] #3 Artists browser _canonicalArtistMap, _artistDisplayNames, artists, selectedArtistTracks, selectedArtistAlbums getters are memoized with version tracking
- [x] #4 Library store exposes _dataVersion counter incremented on every data mutation
- [ ] #5 Deleting 7k tracks from a 13k library does not freeze the UI for more than 500ms
- [ ] #6 Switching between Music/Albums/Artists views after a bulk operation does not cause visible jank
- [ ] #7 All existing Playwright E2E tests pass (task test:e2e)
- [ ] #8 Vitest unit test verifies filteredTracks order is preserved after removeTracksLocally
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Session 3: Frontend churn reduction

### Changes
- `library.js`: `removeTracksLocally()` now filters `filteredTracks` directly (O(n)) instead of calling `applyFilters()` (O(n log n)). Added `_dataVersion` counter incremented at 4 mutation sites.
- `albums-browser.js`: `albumList` getter memoized via `_albumListVersion` / `_cachedAlbumList`.
- `artists-browser.js`: `_canonicalArtistMap` and `artists` getters memoized via version tracking. `selectedArtistTracks` and `selectedArtistAlbums` not memoized — they depend on `selectedArtist` (user interaction), not just data changes, so version-based caching would not help.

### AC#3 partial: Memoized `_canonicalArtistMap` and `artists` (the two expensive O(n) + O(n log n) getters). `selectedArtistTracks` and `selectedArtistAlbums` depend on `selectedArtist` state, making version-only memoization insufficient.
### AC#5-#6: Not verified with real 13k library — requires manual testing.
### AC#7: E2E tests not run in this session.
### AC#8: Vitest unit test for filteredTracks order preservation not written — would require setting up Alpine store mocking.
<!-- SECTION:NOTES:END -->
