---
id: TASK-334
title: Refactor library scroll behavior to preview upcoming cursor batches
status: To Do
assignee: []
created_date: '2026-04-15 03:21'
updated_date: '2026-04-29 05:12'
labels:
  - frontend
  - backend
  - library
  - scroll
  - ux
  - virtualization
dependencies: []
references:
  - /Users/lance/Desktop/mt_music_fouc_2.mp4
  - /Users/lance/Desktop/mt_blank_scroll.mp4
priority: high
ordinal: 953.125
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Improve library scrolling so destination context is visible before releasing the scrollbar and during large keyboard jumps. Implement predictive preload of upcoming cursor pages, then evict stale prefetched pages after idle timeout.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 While dragging the scrollbar, UI shows a live destination preview (artist and/or batch range) before release.
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

Source: `/Users/lance/Desktop/mt_blank_scroll.mp4` (11.4 seconds, 171 frames extracted at 15fps to `/tmp/mt_blank_scroll_frames/`)

Frame-by-frame timeline:

| Frames | Time | State |
|--------|------|-------|
| 1 | 0.00s | Tracks visible (Joyce Manor) |
| 2-19 | 0.07-1.27s | BLANK (~1.2s) |
| 19 | 1.27s | Faint placeholder dividers appear |
| 20-21 | 1.33-1.40s | Tracks visible (Big Country) |
| 22-60 | 1.47-4.00s | BLANK (~2.5s) |
| 60 | 4.00s | Faint dividers |
| 61-95 | 4.07-6.33s | BLANK |
| 96-100 | 6.40-6.67s | Tracks visible (A Sunny Day In Glasgow) |
| 101-120 | 6.73-8.00s | BLANK |
| 120-130 | 8.00-8.67s | Placeholder dividers |
| 131-140 | 8.73-9.33s | Tracks visible (Radiohead) |
| 141-150 | 9.40-10.00s | BLANK |
| 151-171 | 10.07-11.40s | Tracks visible (Super Furry Animals) |

Summary: ~60-70% of scrolling time shows a blank viewport. Tracks only flash in briefly when the IPC response arrives before the next scroll event invalidates the viewport.

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
| `_pageSize` | 500 tracks | `app/frontend/js/stores/library.js` | ~50 |
| `_rowHeight` | 34px | `app/frontend/js/mixins/virtual-scroll.js` | 8 |
| `_bufferRows` | 15 rows | `app/frontend/js/mixins/virtual-scroll.js` | 11 |
| Prefetch ahead | +1 page | `app/frontend/js/components/library-browser.js` | visibleTracks getter |
| Pagination type | LIMIT/OFFSET | `crates/mt-tauri/src/db/library.rs` | 130-149 |
| Rust-side cache | None | Every call hits SQLite | - |

**Why blank:** After the TASK-333 fix, `visibleTracks` correctly skips null/unloaded tracks (no more placeholder rows). When the scrollbar is dragged to an unloaded page, zero rows render until the IPC round-trip completes. The +1 page prefetch is insufficient for scrollbar drag, which can jump thousands of tracks in a single frame.

### Key Source Files

Frontend:
- `app/frontend/js/components/library-browser.js` — `visibleTracks` getter (~line 200-226), `startIndex`/`endIndex` getters, prefetch logic
- `app/frontend/js/stores/library.js` — `_trackPages`, `_pageSize=500`, `_fetchPage`, `_ensurePage`, `getTrackAtIndex`, `_loadAllPages`
- `app/frontend/js/mixins/virtual-scroll.js` — `_rowHeight=34`, `_bufferRows=15`, RAF-throttled `_onScroll`
- `app/frontend/js/utils/library-operations.js` — `loadLibraryData`, `loadSection`, `applySectionData`
- `app/frontend/views/library.html` — Template with `_placeholder` handling

Backend:
- `crates/mt-tauri/src/library/commands.rs` — `library_get_section` (line 141-201), `get_section_all` (line 222), `library_find_offset` (line 396-432)
- `crates/mt-tauri/src/db/library.rs` — SQL LIMIT/OFFSET query (line 130-149), COUNT query

### Approach Options

#### Option A: Stale-While-Revalidate (Recommended First)

Keep old page data visible until new data arrives. Cache the last successful `visibleTracks` result and continue displaying it (possibly with a subtle loading indicator like reduced opacity) while the target page loads.

**Pros:** Minimal code change, eliminates blank viewport entirely, familiar UX pattern (stale content > no content).
**Cons:** Stale content may confuse users briefly (showing "Radiohead" while scrollbar is near "A").
**Complexity:** Low. Requires a cached snapshot in the `visibleTracks` getter and a `_loading` flag.

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
<!-- NOTES:END -->
<!-- SECTION:NOTES:END -->
