---
id: TASK-368
title: Show remote toggle does not hide remote tracks in the paginated library view
status: Done
assignee: []
created_date: '2026-11-14T03:15:00Z'
updated_date: '2026-11-14T20:24:00Z'
labels:
  - plex
  - library
  - frontend
dependencies: []
references:
  - app/frontend/js/stores/library.js
  - app/frontend/js/utils/library-operations.js
  - app/frontend/views/settings-plex.html
  - app/frontend/tests/plex.spec.js
  - app/frontend/js/utils/library-visible-rows.js
  - app/frontend/__tests__/library-visible-rows.test.js
modified_files:
  - app/frontend/js/utils/library-visible-rows.js
  - app/frontend/js/stores/library.js
  - app/frontend/js/components/library-browser.js
  - app/frontend/js/mixins/virtual-scroll.js
  - app/frontend/js/mixins/type-to-jump.js
  - app/frontend/js/utils/library-operations.js
  - app/frontend/views/library.html
  - app/frontend/__tests__/library-visible-rows.test.js
  - app/frontend/__tests__/helpers/library-row-space.js
priority: medium
ordinal: 71500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
With the library on the paginated path (`_sectionTracks === null`), turning off Show remote (Settings > Plex) sets `library.showRemote = false` and `filteredTracks` excludes remote tracks, but the rendered rows still include them. `getTrackAtIndex` reads raw `_trackPages` without applying `showRemote`; the filter in `_filterByLibrary` only runs when a non-paginated section loads. Evidence: probe spec toggled off, returned to Music, and found showRemote=false, paginated=true, filtered=0, pages=[0], row 9001 still in the DOM (16/16 runs under load). The Playwright test `plex.spec.js` "Show remote toggle hides fully-remote tracks" fails ~50% under parallel load, passing only when a section reload happens to re-filter. Decide between filtering in the render path (getTrackAtIndex, totalTracks and the page cache) and passing showRemote to the backend query, then fix and keep the existing Playwright test as the regression check.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Turning off Show remote hides remote tracks in the paginated Music view without requiring a section reload
- [x] #2 Turning Show remote back on restores them
- [x] #3 totalTracks, scroll height and selection ranges stay consistent while remote tracks are hidden
- [x] #4 app/frontend/tests/plex.spec.js 'Show remote toggle hides fully-remote tracks' passes 16/16 with --repeat-each=16 --workers=8 in webkit
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Root cause: the scroller rendered from raw index space. visibleTracks walked library.totalTracks against getTrackAtIndex(i), and getTrackAtIndex never consulted showRemote — it reads raw _trackPages. filteredTracks was the only place the filter existed, and it is not what the paginated list renders. The reported ~50% flakiness was the assertion winning a race against the transient totalTracks === 0 during a section reload, not a nondeterministic filter; it passed in isolation.

Rejected option 'pass showRemote to the backend query': pages deeper than 0 never reach Tauri. libraryApi.getTracks() has no tauriInvoke at all and always goes over HTTP to the Zig sidecar, which serves only GET /api/library (zig-core/src/server.zig). Server-side filtering would need the same SQL condition (NOT (source='plex' AND filepath LIKE 'http%')) in Rust and Zig plus shadow-diff parity — and source_filter: 'local' is not equivalent, because downloaded Plex tracks must stay visible — while TASK-369.5's ADR is open and TASK-353 is mid-flight in that code.

Chosen fix: a frontend row map. Raw indices (page arrays, _pageSize arithmetic, library_find_offset, page-cache keys, _sectionCache, reconcile totals) stay raw and untouched; _visibleRowMap records, ascending, which raw index each rendered row shows. The map is null while showRemote is true, so the default path is the identity and costs nothing, and switching the filter back on needs no refetch. Row-space logic lives in js/utils/library-visible-rows.js as pure functions so the store, its Vitest stubs and the unit tests share one implementation; stubs apply it with withRowSpace()/Object.defineProperties because spreading would evaluate the visibleTotal getter.

Scroll height and row addressing only agree once every row is accounted for, so a filtered view must see every page — the same full-materialization requirement selectAll already accepts. rebuildVisibleRows() measures the loaded pages synchronously (so the render a following _dataVersion bump triggers is already filtered, no flash of the tracks that were just hidden) and then converges on the whole library through _loadAllPages(). Concurrent callers share one run, which also stops page arrivals inside a bulk load from re-measuring page after page, and a run superseded by a toggle or a _loadGeneration change discards its measurement instead of resurrecting a stale map. Hooks: setShowRemote, _resetPages, _tryRestorePagesFromCache, _setSectionTracks, _doFetchPage, _removeFromView, _refreshPlexTrack, rescanTrack, and loadLibraryData / backgroundRefreshLibrary / removeTracksLocallyOp.

Consumers converted: startIndex/endIndex/visibleTracks/totalContentHeight/offsetY and the shimmer branch use visibleTotal + getTrackAtRowIndex; prefetch translates rows back to raw before deriving pages; handleRowClick uses _loadRowRange and selectAll awaits _rebuildVisibleRows() then iterates visibleTotal; virtual-scroll scrollToTrack/scrollToOffset and type-to-jump _jumpViaBackend translate raw → row and bail on -1 instead of scrolling to a track the filter hides. library.html render gates use visibleTotal, with a new 'Only remote tracks' empty state so a fully-remote library does not read as an empty one.

Evidence: new __tests__/library-visible-rows.test.js (29 tests: raw↔row conversion, measure/converge/supersede, loadRowRange clamp, invariants including scroll height = visibleTotal × rowHeight); full Vitest suite 672 passed / 35 files. AC #4: plex.spec.js 'Show remote toggle hides fully-remote tracks' passes 16/16 with --repeat-each=16 --workers=8 in webkit, versus 6 failed / 10 passed at baseline. Full suite task test:e2e: 509 passed / 2 skipped / 0 failed (was 508 passed / 1 failed). deno lint and deno fmt --check clean.

AC mapping: #1 and #2 are the plex.spec.js toggle test (off → the remote row is gone, on → it returns, no section reload). #3 is pinned in Vitest, per the test-boundaries rule that Vitest owns store logic: row count and scroll height in the row-space invariants, shift-click selection ranges in library-multi-select.test.js, and the library-browser.swr.test.js stub getters now mirror the production getters. Selection stores track IDs, which are space-agnostic; lastSelectedIndex and item.globalIndex are row indices, consistent with the render path.
<!-- SECTION:NOTES:END -->
