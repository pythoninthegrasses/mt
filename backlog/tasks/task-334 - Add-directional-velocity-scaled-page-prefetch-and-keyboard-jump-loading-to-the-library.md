---
id: TASK-334
title: >-
  Add directional, velocity-scaled page prefetch and keyboard jump loading to
  the library
status: To Do
assignee: []
created_date: '2026-04-15 03:21'
updated_date: '2026-11-14T21:42:00Z'
labels:
  - frontend
  - library
  - scroll
  - ux
  - virtualization
dependencies: []
references:
  - app/frontend/js/components/library-browser.js
  - app/frontend/js/stores/library.js
  - app/frontend/js/utils/library-page-cache.js
  - app/frontend/js/utils/library-visible-rows.js
  - app/frontend/js/mixins/virtual-scroll.js
  - app/frontend/__tests__/library-browser.swr.test.js
priority: high
ordinal: 281.25
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add look-ahead to library paging so fast scrolling reaches real rows instead of the stale snapshot. The blank-state half of this task is already shipped: the SWR snapshot (library-browser.js) keeps the last good rows on screen while a page loads, and LibraryPageCache bounds per-query page buckets. What remains is prefetch quality and efficiency: the current loop requests only the visible page range plus one page after it, so upward scrolling has zero look-ahead, prefetch depth never grows for fast flicks, PageUp/PageDown/Home/End are not handled at all, and a single flick can start dozens of concurrent page IPC round-trips. Re-scoped 2026-11-14 against the current architecture. The drag destination-preview widget and backend keyset pagination are explicitly out of scope.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Scrolling never renders a blank viewport: visibleTracks keeps serving the last good SWR snapshot rows while the page for the current viewport is in flight, and this stays covered by library-browser.swr.test.js.
- [ ] #2 Prefetch covers both scroll directions: scrolling upward requests the pages behind the viewport, not only pages after it.
- [ ] #3 Prefetch depth scales with scroll velocity within an explicit bound declared as named constants, and never re-requests pages already cached or in flight.
- [ ] #4 PageUp, PageDown, Home and End scroll by a viewport (or to the ends) and eagerly load the destination pages, so the destination shows real rows without an intermediate shimmer stretch.
- [ ] #5 Concurrent page requests are bounded by an explicit in-flight limit in the library store: excess pages are queued rather than dropped, and each page still resolves through a single shared IPC round-trip.
- [ ] #6 Pages far from the viewport are evicted from the live _trackPages map into LibraryPageCache, so revisiting them is a cache hit and total retained pages stay within the configured cap.
- [ ] #7 New behavior is covered by Vitest unit tests plus a property test for the prefetch invariant, and both `cd app/frontend && npx vitest run` and `task pre-commit` are green.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Current architecture (verified 2026-11-14)

- `app/frontend/js/stores/library.js` — `_trackPages` (L71), `_loadingPages` (L72), `_pageSize: 1500` (L73), `_pageCache: new LibraryPageCache()` (L79). `_resetPages()` (L358) saves the live page map into `_pageCache` and restores the bucket for the new query key. `_fetchPage()` (L407) dedupes in-flight pages by returning the shared promise from `_loadingPages`. `_ensurePage()` (L480) is the fire-and-forget entry point; `_loadPageRange()` (L489) is the awaited one.
- `app/frontend/js/components/library-browser.js` — `_swrSnapshot`/`_swrGeneration` (L25-26). `visibleTracks` getter (L439) clears the snapshot on `_loadGeneration` change, then runs the prefetch loop (L452-464): `for (let p = firstPage; p <= lastPage + 1; p++) lib._ensurePage(p)`, with indices translated out of the row space via `rawIndexForRowIndex`. `handleKeydown` (L766) handles Cmd/Ctrl+A, Escape, Enter, Delete/Backspace and type-to-jump — no PageUp/PageDown/Home/End.
- `app/frontend/js/utils/library-page-cache.js` — LRU keyed by `queryKey({section, search, sortBy, sortOrder, ignoreWords})`; `save`/`restore` shallow-clone buckets, `_enforceCap` drops oldest buckets until total pages (not buckets) fall under `DEFAULT_MAX_PAGES = 60`.
- `app/frontend/js/utils/library-visible-rows.js` — the row/mirror the prefetch range is derived from; keep prefetch in raw index space and translate with `rawIndexForRowIndex`.
- `app/frontend/js/mixins/virtual-scroll.js` — `_rowHeight: 34`, `_bufferRows: 15`, RAF-throttled `_onScroll` (L18), `scrollToTrack` (L30). Only `_scrollTop` is mirrored; there is no previous-offset or velocity state, so nothing today knows which way the user is going.

## Approach

1. Track direction and velocity in `virtual-scroll.js`: keep the previous `_scrollTop` at each RAF tick and expose `scrollDirection` plus a delta. Do the accumulation in the mixin, not in the getter, so `visibleTracks` stays a pure read.
2. Make the prefetch range directional and velocity-scaled in `library-browser.js`: replace the fixed `lastPage + 1` with `visible ± lookAhead` where look-ahead grows with recent scroll delta, clamped by named constants (`MIN_LOOK_AHEAD_PAGES`, `MAX_LOOK_AHEAD_PAGES`). Both directions always included so a direction flip mid-flick cannot leave the destination uncovered.
3. Handle PageUp/PageDown/Home/End in `handleKeydown`: scroll by one viewport (to the ends for Home/End), then `await` the destination `_loadPageRange` so rows arrive without an intermediate shimmer stretch. Reuse the existing `scrollToTrack` behavior for the jump itself.
4. Cap concurrent page fetches in the store: a small in-flight limit in front of `_doFetchPage`, with excess pages queued rather than dropped. Preserve the existing `_loadingPages` sharing so a page still costs one IPC round-trip.
5. Evict far-from-viewport pages out of the live `_trackPages` into `_pageCache` so a long browse session does not retain every page it ever touched, while revisits stay cache hits. The existing LRU cap governs total retained pages.

## Tests

- Vitest for directional/velocity page selection, the in-flight cap, and eviction. Extract page selection into a pure helper so it is testable without Alpine.
- Property tests (fast-check) for the prefetch invariant: every page containing a visible row is always in the requested set, for arbitrary scroll positions, velocities, and hidden-remote-track mirrors.
- Keep `library-browser.swr.test.js` green; Playwright only if a genuine scroll interaction must be driven.

## Out of scope

- The drag destination-preview widget (original AC#1). The SWR snapshot is the accepted mitigation.
- Backend keyset pagination — TASK-350.3.
- Row height / virtualization tuning.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
<!-- NOTES:BEGIN -->
Investigation completed 2026-04-15. All frame analysis, architecture mapping, and approach documentation written above. Ready for implementation.

TASK-333 (commit f8f2e1c) fixed the FOUC but exposed this blank-during-scroll problem. The two issues are related but distinct: FOUC was about stale cached data rendering wrong rows on init; this task is about missing data during fast scroll navigation.

**2026-05-03**: Reconciled architecture references with current `main`. Line numbers refreshed; `mt_blank_scroll.mp4` reference removed (file no longer on disk). Drift since 2026-04-15 is non-material to the plan: only additions are `library_find_track_offset` backend command and a rewritten `scrollToTrack` for explicit jumps. Prefetch is still strictly `+1` page; no SWR / cursor / cache layer has been added. Recommended approach (A then B) stands.
<!-- NOTES:END -->

**2026-05-03**: Implemented Option A (SWR). Added `_swrSnapshot` and `_swrGeneration` to `library-browser` component. `visibleTracks` now caches the last successful render result and returns it when the current viewport page is unloaded. Snapshot clears on `_loadGeneration` change (section switch, search, sort). Tests added in `__tests__/library-browser.swr.test.js` (9 tests). AC#1 addressed by keeping stale rows visible; AC#5 partially addressed.

2026-11-14 (backlog tidy): left In Progress, but the status needs your read. Option A (SWR snapshot) is implemented — _swrSnapshot/_swrGeneration in the library-browser component, 9 tests in __tests__/library-browser.swr.test.js — while AC#5 is only partial and Option B (cursor/cache layer) is not started. Since this was written, the blank-row family was closed elsewhere: TASK-344, TASK-346, TASK-348 and TASK-349 (type-to-jump blank viewport/flash) are Done and archived, and TASK-350.1/.2 shipped. Recommend deciding whether the remaining ACs are still wanted or are now covered by that chain, then closing or re-scoping rather than leaving it open by default.

RE-SCOPED 2026-11-14. The task was written 2026-04-15 against an architecture that no longer exists: since then the SWR snapshot shipped (Option A, implemented 2026-05-03), LibraryPageCache added a 60-page LRU over per-query buckets, _fetchPage gained in-flight dedupe, and the blank-row family closed as TASK-344/346/348/349/352/355 plus TASK-350.1/.2. The original AC list was therefore mostly describing work already done elsewhere.

Kept, because it is still true: AC#2 in weakened form (prefetch exists but is fixed at +1 page and forward-only), AC#3 (PageUp/PageDown/Home/End are handled nowhere in app/frontend/js), AC#4 (the live _trackPages map for the active query is uncapped; the LRU cap only applies to buckets saved on query switch).

Dropped: the literal drag destination-preview widget of original AC#1. No such widget exists and the SWR snapshot already removes the ambiguity it was meant to fix. AC#1 now states the snapshot contract instead, which is verifiable by its existing tests.

Added: a bound on concurrent page fetches. _ensurePage calls _fetchPage with no in-flight limit, so one fast flick across a 40k+ track library can enqueue dozens of simultaneous page IPC calls.

Dropped the backend label: backend keyset pagination is TASK-350.3 and is not a dependency of this work.
<!-- SECTION:NOTES:END -->
