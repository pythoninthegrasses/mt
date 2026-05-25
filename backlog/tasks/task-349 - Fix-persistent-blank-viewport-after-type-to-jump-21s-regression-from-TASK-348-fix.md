---
id: TASK-349
title: >-
  Fix persistent blank viewport after type-to-jump (21s regression from TASK-348
  fix)
status: Done
assignee: []
created_date: '2026-05-25 06:25'
updated_date: '2026-05-25 10:46'
labels:
  - bug
  - library
  - type-to-jump
  - regression
dependencies: []
references:
  - app/frontend/js/mixins/type-to-jump.js
  - app/frontend/js/components/library-browser.js
  - app/frontend/js/mixins/virtual-scroll.js
  - app/frontend/__tests__/library-browser.swr.test.js
priority: high
ordinal: 93.75
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Bug

Recorded at 00:08 on 2026-05-25, 37 minutes after commit 4bf54fa landed (TASK-348). The viewport goes completely blank — not shimmer, not stale rows, but zero row elements — immediately after a navigation event and stays blank for ~21 seconds until the user re-triggers a jump.

## Evidence (frames from /tmp/mt_fouc_frames/)

| Frame | Time | State |
|---|---|---|
| 1–33 | 0–3.3s | Normal: Men I Trust + Menomena tracks visible, "Tailwip Revisited" selected |
| 34 | 3.4s | **Instant blank** — no rows at all, no shimmer, no dividers |
| 34–243 | 3.4–24.3s | Completely blank for 21s |
| 244–249 | 24.4–24.9s | Shimmer rows appear (user re-triggered a jump) |

## Root cause hypothesis

The `visibleTracks` getter has four branches:

1. Real rows from loaded page data (result.length > 0) → return result
2. `_isJumping === true` → return placeholder shimmer
3. SWR snapshot if range overlaps viewport → return stale rows
4. Fallback placeholders (startIndex..end)

The blank means branch 4 is returning an **empty array**, which only happens when `startIndex === end`. That requires either `totalTracks === 0` or `startIndex >= totalTracks`.

The 4bf54fa fix added a synchronous `_scrollTop` mirror after `scrollToOffset`. If `scrollToOffset` fires and sets `_scrollTop` to a value beyond `totalTracks * rowHeight` (e.g. a stale totalTracks count during a refetch), `startIndex` would exceed `totalTracks` → `end = Math.min(startIndex + visibleCount, totalTracks) = totalTracks` → if `startIndex >= totalTracks` then `end <= startIndex` → empty loop.

Secondary hypothesis: `_isJumping` is cleared via `$nextTick` before Alpine re-renders with the new `_scrollTop`, leaving a window where branch 2 is inactive, branch 3 is range-gated out, and branch 4 computes to empty.

## Files to read first

- `app/frontend/js/mixins/type-to-jump.js` — `_jumpViaBackend` (lines ~136–185): the `_isJumping` lifecycle
- `app/frontend/js/components/library-browser.js` — `visibleTracks` getter (lines ~340–397): all four branches
- `app/frontend/js/mixins/virtual-scroll.js` — `scrollToOffset` and `_scrollTop` sync
- `app/frontend/__tests__/library-browser.swr.test.js` — existing coverage to avoid breaking

## Reproduction steps

1. Open the library sorted by Artist (ascending)
2. Scroll so a mid-alphabet artist is visible
3. Click a track to select it
4. Type a letter that jumps to a far-away artist (large globalIndex delta)
5. Observe whether the viewport shows shimmer or goes blank

## Debugging steps for the agent

Add temporary `console.log` calls inside `visibleTracks` to record which branch fires and the values of `startIndex`, `end`, `totalTracks`, `_isJumping`, and `result.length`. Reproduce the blank, then read the console to identify which branch returned empty and why.

Key question: is `startIndex >= totalTracks` at the moment of the blank, or is branch 4 somehow producing an empty array another way?

## Fix direction

Once the branch is identified, the fix should ensure `_isJumping` stays `true` (keeping branch 2 active as shimmer) until the fetched page actually overlaps `[startIndex, end)`. A `$nextTick` deferral is not sufficient for distant jumps where the fetch latency exceeds one Alpine tick.

One approach: instead of clearing `_isJumping` in `$nextTick`, clear it only inside `visibleTracks` itself when `result.length > 0` — i.e., make the shimmer branch self-extinguishing once real data is available.

## Acceptance criteria

- Type-to-jump to a distant artist never produces a blank viewport (zero rows) post-4bf54fa
- The viewport shows shimmer rows immediately on jump and transitions to real rows when the page loads
- No regression on the shimmer → real-rows transition timing tested in library-browser.swr.test.js
- Task-348 Playwright coverage still passes
<!-- SECTION:DESCRIPTION:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Three-part fix for the 21s blank viewport regression. (1) shimmer branch in visibleTracks now uses raw _scrollTop-based bounds instead of totalTracks, so placeholder rows render even when totalTracks=0. (2) $nextTick clear in _jumpViaBackend is guarded to skip when library.loading && totalTracks===0. (3) visibleTracks self-extinguishes _isJumping once real rows arrive, providing a clean-up path independent of the $nextTick timing. Six new tests in library-browser.swr.test.js cover all three cases. Commit: 7ea9c95.

Follow-up fix after the second FOUC recording (mt_fouc_2.mp4): the 7ea9c95 shimmer-branch fix populated visibleTracks correctly, but the row container in views/library.html was still gated by x-show="library.totalTracks > 0" and the totalContentHeight/offsetY getters still multiplied by totalTracks=0 — collapsing the container to height:0 with offset 0 during the loadLibraryData reload window. Updated the gate to `library.totalTracks > 0 || _isJumping`, and added zero-total+jumping fallbacks to totalContentHeight (uses raw scroll row + visible rows + buffer) and offsetY (anchors to shimmerStart row). 8 new vitest cases in library-browser.swr.test.js cover height/offset non-zero, anchoring, and the normal-path passthrough when totalTracks > 0. All 29 SWR tests pass; pre-existing unrelated failures in albums-browser/go-to-album unchanged.
<!-- SECTION:FINAL_SUMMARY:END -->
