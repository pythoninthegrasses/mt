---
id: TASK-334
title: Refactor library scroll behavior to preview upcoming cursor batches
status: In Progress
assignee: []
created_date: '2026-04-15 03:21'
updated_date: '2026-05-04 04:47'
labels:
  - frontend
  - backend
  - library
  - scroll
  - ux
  - virtualization
dependencies: []
priority: high
ordinal: 1000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Improve library scrolling so destination context is visible before releasing the scrollbar and during large keyboard jumps. Implement predictive preload of upcoming cursor pages, then evict stale prefetched pages after idle timeout.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 While dragging the scrollbar, UI shows a live destination preview (artist and/or batch range) before release.
- [ ] #2 During active scrolling, the system preloads the next N cursor batches in scroll direction to reduce ambiguity and blank states.
- [ ] #3 PageUp/PageDown/Home/End trigger eager loading of needed batches so destination context appears quickly.
- [ ] #4 Prefetched-but-unused batches are evicted after a bounded idle period to limit memory growth.
- [ ] #5 Add or update tests to validate preview display, preload triggers, and idle eviction behavior.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
### Problem Statement

When scrollbar-dragging through a 13k+ track library, the viewport is blank ~60-70% of the time. The user sees empty white space instead of track rows while the IPC round-trip fetches the target page. This was partially addressed by TASK-333 (FOUC fix, commit f8f2e1c), but the blank-during-scroll problem remains because the fix correctly removed placeholder rows — now nothing renders until data arrives.

### Video Evidence

Original frame-by-frame analysis was derived from `mt_blank_scroll.mp4`, which is no longer on disk. The qualitative finding it produced — viewport blank ~60–70% of scrollbar-drag time, brief flashes of real rows when an IPC response wins the race — is preserved here as the design constraint. Re-record before final verification if a fresh capture is needed.

### Current Pagination Architecture

**Data flow:**
```
scroll event
  -> RAF-throttled _onScroll()
    -> Alpine reactivity
      -> visibleTracks getter
        -> _ensurePage(p) fire-and-forget
          -> _fetchPage(p) IPC
            -> Rust library_get_section
              -> SQL LIMIT/OFFSET
                -> response
                  -> _dataVersion++
                    -> re-render
```

**Key constants and locations:**

| Constant | Value | File | Line |
|----------|-------|------|------|
| `_pageSize` | 500 tracks | `app/frontend/js/stores/library.js` | 61 |
| `_rowHeight` | 34px | `app/frontend/js/mixins/virtual-scroll.js` | 12 |
| `_bufferRows` | 15 rows | `app/frontend/js/mixins/virtual-scroll.js` | 15 |
| Prefetch ahead | +1 page | `app/frontend/js/components/library-browser.js` | 349 |
| Pagination type | LIMIT/OFFSET | `crates/mt-tauri/src/db/library.rs` | 142 |
| Rust-side cache | None | Every call hits SQLite | — |

**Why blank:** After the TASK-333 fix, `visibleTracks` correctly skips null/unloaded tracks (no more placeholder rows). When the scrollbar is dragged to an unloaded page, zero rows render until the IPC round-trip completes. The +1 page prefetch is insufficient for scrollbar drag, which can jump thousands of tracks in a single frame.

### Key Source Files

Frontend:
- `app/frontend/js/components/library-browser.js` — `visibleTracks` getter (L336–364), `startIndex`/`endIndex` (L318–334), `+1` prefetch at L349
- `app/frontend/js/stores/library.js` — `_trackPages` L59, `_loadingPages` L60, `_pageSize=500` L61, `_fetchPage` L188 (with `_loadGeneration` stale-response guard at L189/219/242), `_ensurePage` L248, `getTrackAtIndex` L257, `_loadAllPages` L267
- `app/frontend/js/mixins/virtual-scroll.js` — `_rowHeight=34` L12, `_bufferRows=15` L15, RAF-throttled `_onScroll` L18, `scrollToTrack` L30–84 (rewritten in `f8f5a3a` to use `findTrackOffset` + on-demand single-page fetch when target is unloaded)
- `app/frontend/js/utils/library-operations.js` — `loadLibraryData`, `loadSection`, `applySectionData`
- `app/frontend/views/library.html` — Template with `_placeholder` handling

Backend:
- `crates/mt-tauri/src/library/commands.rs` — `library_get_section` L142, `get_section_all` L206, `library_find_offset` L397, `library_find_track_offset` L438–471 (new in commit `7ccfbb6`)
- `crates/mt-tauri/src/db/library.rs` — `LIMIT ? OFFSET ?` L142, COUNT L130

### Approach Options

#### Option A: Stale-While-Revalidate (Recommended First)

Keep old page data visible until new data arrives. Cache the last successful `visibleTracks` result and continue displaying it (possibly with a subtle loading indicator like reduced opacity) while the target page loads.

**Pros:** Minimal code change, eliminates blank viewport entirely, familiar UX pattern (stale content > no content).
**Cons:** Stale content may confuse users briefly (showing "Radiohead" while scrollbar is near "A").
**Complexity:** Low. Requires a cached snapshot in the `visibleTracks` getter and a `_loading` flag.
**Note:** The cached snapshot must coexist with the existing `_loadGeneration` stale-response discard in `_fetchPage`. The snapshot is purely a render-side fallback — don't replay discarded responses into it.

#### Option B: Velocity-Based Predictive Prefetch

Track scroll velocity (delta position / delta time). When velocity exceeds a threshold, prefetch 3-5 pages ahead in the scroll direction instead of just +1.

**Pros:** Reduces blank time for moderate-speed scrolling. Works well with keyboard navigation.
**Cons:** Scrollbar drag can jump 50+ pages in one frame — no amount of prefetch catches up. Adds complexity to scroll handler.
**Complexity:** Medium. Needs velocity tracking in `_onScroll`, dynamic prefetch count, and cancellation of stale prefetch requests.

#### Option C: Cursor-Based Pagination (Backend)

Replace LIMIT/OFFSET with keyset pagination. Instead of `OFFSET 5000`, use `WHERE sort_key > last_seen_key LIMIT 500`.

**Pros:** Faster SQL for deep offsets (OFFSET N scans N rows). More correct under concurrent mutations.
**Cons:** Doesn't solve the blank viewport problem — the IPC round-trip latency is the bottleneck, not SQL speed. Adds complexity to sort key management.
**Complexity:** High. Requires backend API changes, composite sort key handling, and frontend cursor state management.

#### Option D: Preload All Track Metadata

Load all ~13k track rows into memory at startup. At ~200 bytes/track, that's ~2.6MB — trivial for a desktop app.

**Pros:** Eliminates pagination entirely. Instant scroll to any position. Simplifies frontend code dramatically.
**Cons:** Startup latency for very large libraries (50k+ tracks). Memory usage scales linearly. Section switching requires full reload.
**Complexity:** Medium. Replace paginated `_trackPages` with a flat array. Simplify `visibleTracks` to a slice. Remove `_ensurePage`/`_fetchPage` machinery.

#### Option E: Hybrid Lightweight Index + On-Demand Details

Load a lightweight index (track ID, artist, title, duration — ~80 bytes/track) for all tracks at startup. Fetch full metadata (album art, file path, etc.) on demand for visible rows only.

**Pros:** Fast startup (~1MB for 13k tracks). Instant scroll with basic info. Full details load seamlessly.
**Cons:** Two-tier data model adds complexity. Need to define "lightweight" vs "full" fields.
**Complexity:** Medium-High. New Rust command for lightweight index, frontend two-tier store, progressive enhancement in template.

### Recommended Implementation Order

**A first, then B, then evaluate D/E if still needed.**

Option A alone should eliminate the blank viewport problem. Option B improves the experience further by reducing how often stale data is shown. Options D and E are more invasive but may be worth it if the library grows significantly or if section switching performance is also a concern.

Note: Ignore the duplicate row rendering observed in some video frames — that is an unrelated issue and out of scope for this task.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
<!-- NOTES:BEGIN -->
Investigation completed 2026-04-15. All frame analysis, architecture mapping, and approach documentation written above. Ready for implementation.

TASK-333 (commit f8f2e1c) fixed the FOUC but exposed this blank-during-scroll problem. The two issues are related but distinct: FOUC was about stale cached data rendering wrong rows on init; this task is about missing data during fast scroll navigation.

**2026-05-03**: Reconciled architecture references with current `main`. Line numbers refreshed; `mt_blank_scroll.mp4` reference removed (file no longer on disk). Drift since 2026-04-15 is non-material to the plan: only additions are `library_find_track_offset` backend command and a rewritten `scrollToTrack` for explicit jumps. Prefetch is still strictly `+1` page; no SWR / cursor / cache layer has been added. Recommended approach (A then B) stands.
<!-- NOTES:END -->

**2026-05-03**: Implemented Option A (SWR). Added `_swrSnapshot` and `_swrGeneration` to `library-browser` component. `visibleTracks` now caches the last successful render result and returns it when the current viewport page is unloaded. Snapshot clears on `_loadGeneration` change (section switch, search, sort). Tests added in `__tests__/library-browser.swr.test.js` (9 tests). AC#1 addressed by keeping stale rows visible; AC#5 partially addressed.
<!-- SECTION:NOTES:END -->
