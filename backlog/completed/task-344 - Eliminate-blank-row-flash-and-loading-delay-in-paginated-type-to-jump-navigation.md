---
id: TASK-344
title: >-
  Eliminate blank-row flash and loading delay in paginated type-to-jump
  navigation
status: Done
assignee: []
created_date: '2026-05-24 17:18'
updated_date: '2026-05-24 17:56'
labels:
  - library
  - performance
  - ux
dependencies: []
references:
  - app/frontend/js/mixins/type-to-jump.js
  - app/frontend/js/components/library-browser.js
  - app/frontend/js/stores/library.js
priority: medium
ordinal: 500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
After the debounce fix (8b084b7), slow-typed multi-char prefixes now land correctly, but the jump experience for artists not already in loaded pages is still poor UX:

1. **Flash-of-blank / home-then-land**: Typing "men" (for Menomena or Men I Trust) scrolls immediately to the backend-resolved offset via scrollToOffset(), which shows empty placeholder rows for several seconds before the target page loads. To the user it looks like: library jumps to row 0 or a blank region → blank/shimmer for 2-5s → artist finally appears. The "going home" appearance is the virtual scroll container snapping to the placeholder region before page data arrives.

2. **Sparse placeholder rows during pagination**: Any mid-library jump via _jumpViaBackend results in a viewport full of empty/shimmer rows while the page fetches, with no visual indication that the jump is actually in progress or that content is coming.

These are distinct from the now-fixed debounce bug: the navigation resolves to the *correct* artist, but the experience getting there is jarring.

Root cause areas to investigate:
- `_jumpViaBackend` in `app/frontend/js/mixins/type-to-jump.js` calls `scrollToOffset(offset)` before the target page is in `_trackPages`. The virtual scroll renders placeholder rows immediately.
- `_ensurePage` is called from `visibleTracks` getter on each render pass, so the fetch is triggered reactively, but there is no way for the user to see that a load is pending specifically for the jump target (vs. general scrolling).
- The `library_find_offset` backend call itself may have meaningful latency on large libraries (~40k tracks).

Potential directions (pick the best combination after investigation):
- **Optimistic prefetch**: kick off `_ensurePage(pageIndex)` for the target page immediately in `_jumpViaBackend`, before calling `scrollToOffset`, so the fetch is in-flight (or complete) before the view renders the new position.
- **Defer scroll until page arrives**: instead of scrolling to the offset immediately, wait for the target page to load (poll `getTrackAtIndex(offset)` with a short tick, or hook into `_dataVersion`/`_loadGeneration` change), then scroll. This removes the blank-region flash at the cost of a brief perceived delay before the view moves.
- **Targeted loading indicator**: show a minimal "jumping to…" badge or cursor change while `_jumpViaBackend` is in flight, so the user knows the gesture was registered even if the view hasn't moved yet.
- **Page preload on debounce start**: when the first character is typed and it hits `_jumpViaBackend`, proactively fetch the probable page so that by the time the full prefix resolves the data is already cached.

The fix should not regress the now-correct multi-char prefix resolution or the cancellation behavior (_jumpGen).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Typing a multi-char prefix that resolves via the backend (artist not in page 0) shows no blank-row flash — the view either stays put until data is ready or transitions smoothly to the target row
- [x] #2 No visible "home" (row 0) snap during a mid-library jump
- [x] #3 The loading state is perceptible to the user: some indicator (shimmer, cursor, badge) communicates that navigation is in progress
- [x] #4 Jumping to an artist within 2 seconds of the final keystroke on a warm library (~40k tracks, pages already partially loaded)
- [x] #5 Regression: "dum" still lands on Dum Dum Girls; _jumpGen cancellation still works; debounce timeout unchanged
<!-- AC:END -->
