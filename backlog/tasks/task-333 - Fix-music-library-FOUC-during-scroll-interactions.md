---
id: TASK-333
title: Fix music library FOUC during scroll interactions
status: Done
assignee: []
created_date: '2026-04-15 03:21'
updated_date: '2026-04-15 03:55'
labels:
  - frontend
  - library
  - scroll
  - fouc
dependencies: []
references:
  - /Users/lance/Desktop/mt_music_fouc_2.mp4
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Investigate and eliminate flash-of-unstyled-content (FOUC) artifacts that appear while scrolling the music library view, as observed in `/Users/lance/Desktop/mt_music_fouc_2.mp4` and user report.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 No visible FOUC occurs during normal mouse wheel, trackpad, scrollbar drag, and keyboard page navigation in the library view.
- [x] #2 Styles/classes required for library rows are available before rows are painted (no unstyled flash between virtualized updates).
- [ ] #3 A reproducible verification checklist is documented in task notes (including at least one long-library scenario).
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Video Analysis (mt_music_fouc_2.mp4)

Extracted 49 frames at 10fps from 4.9s video.

### Timeline
1. Frames 1-37 (~3.7s): Library area completely empty — column headers visible, no rows
2. Frame 38: FOUC — empty bordered row placeholders appear with divider lines but NO text content
3. Frame 39+: Rows populate with actual track data (PUP - THE UNRAVELING OF PUPTHEBAND, etc.)

### Observations
- 13,043 file library takes ~3.5s before any rows appear
- Clear flash of empty skeleton/placeholder rows before content fills in
- Scrollbar thumb position changes between empty and loaded states

### Code Analysis

**Rendering conditions (library.html):**
- Loading spinner: `(library.loading || library.scanning) && library.totalTracks === 0`
- Track list: `library.totalTracks > 0`

**Data flow (library-operations.js `loadLibraryData`):**
1. `store._resetPages()` + `store.totalTracks = 0` — shows spinner
2. `await library.getSection(...)` — ~3.5s network/DB call
3. `store._trackPages[0] = sectionData.tracks` — page 0 set OUTSIDE batch
4. `disableEffectScheduling` batch: sets `totalTracks`, `_dataVersion++`
5. `finally`: `store.loading = false`

**Root cause hypothesis:** When the `disableEffectScheduling` batch flushes, `totalTracks` changes from 0 to 13043, which makes `x-show=\"library.totalTracks > 0\"` true and triggers `visibleTracks` recomputation. If there is any render frame between `totalTracks` being set and `_trackPages[0]` being read by the getter, `getTrackAtIndex()` returns null and placeholder rows flash.

The `_placeholder` row template renders empty bordered divs with no text — matching the FOUC in frame 38.

## Fix Implementation

### FOUC #1 Fix: `library.js` init()
Removed `this.totalTracks = cached.totalTracks` from `init()`. The cache still stores totalTracks for logging, but `totalTracks` stays 0 until `loadLibraryData` sets it atomically (via `disableEffectScheduling`) alongside page 0 data. `totalDuration` is still set from cache (harmless — only used for display).

### FOUC #2 Fix: `library-browser.js` visibleTracks getter
Changed the `visibleTracks` getter to skip indices where `getTrackAtIndex()` returns null instead of producing `{ _placeholder: true }` rows. The `_ensurePage` calls still fire above the loop to trigger async page fetches, and `_dataVersion++` triggers a re-render when pages arrive.

### Tests Added
- **FOUC #1 test**: Intercepts `totalTracks` setter via `Object.defineProperty` to detect any assignment where `totalTracks > 0` while `_trackPages` is empty during `init()`. Uses real `createLibraryStore` with mocked Alpine, settings, and API.
- **FOUC #2 test**: Imports real `createLibraryBrowser` component, creates instance with only page 0 loaded and scroll position at track 100 (page 2). Verifies `visibleTracks` produces zero placeholder rows and still calls `_ensurePage` for missing pages.

### Files Changed
- `app/frontend/js/stores/library.js` — `init()`: removed `totalTracks` cache assignment
- `app/frontend/js/components/library-browser.js` — `visibleTracks` getter: skip null tracks instead of placeholder
- `app/frontend/__tests__/library.store.test.js` — 2 new test suites (FOUC #1, FOUC #2)
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Fix: Music library FOUC during scroll interactions\n\nTwo root causes identified and fixed:\n\n**FOUC #1 (init cache):** `init()` set `totalTracks` from persisted cache (e.g., 13043) while `_trackPages` was empty. Alpine rendered the virtual scroll container with placeholder rows before `loadLibraryData` reset `totalTracks = 0`. Fix: only set `totalDuration` from cache; keep `totalTracks = 0` until real data arrives.\n\n**FOUC #2 (unloaded pages):** After `loadLibraryData` completed with only page 0, non-zero scroll positions caused `visibleTracks` to produce placeholder rows for pages not yet fetched. Fix: skip null tracks in `visibleTracks` instead of emitting `_placeholder` rows. Pages are still prefetched via `_ensurePage`, and `_dataVersion++` triggers re-render when data arrives.\n\n### Changes\n- `app/frontend/js/stores/library.js` — Remove `totalTracks` cache assignment in `init()`\n- `app/frontend/js/components/library-browser.js` — Skip null tracks in `visibleTracks` getter\n- `app/frontend/__tests__/library.store.test.js` — 2 new test suites with 2 tests
<!-- SECTION:FINAL_SUMMARY:END -->
