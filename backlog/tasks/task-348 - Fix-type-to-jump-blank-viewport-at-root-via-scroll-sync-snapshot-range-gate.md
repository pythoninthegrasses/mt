---
id: TASK-348
title: Fix type-to-jump blank viewport at root via scroll sync + snapshot range-gate
status: Done
assignee: []
created_date: '2026-05-25 04:30'
labels:
  - bug
  - library
  - type-to-jump
  - virtual-scroll
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Eliminate the recurring blank-viewport FOUC when type-to-jump crosses a large region (e.g. Menomena → !!!). Root cause: three async signals (DOM scroll, page fetch, _isJumping flag) are not synchronized, allowing visibleTracks to paint stale-region rows at off-screen translateY positions while the container has already scrolled.\n\nThree targeted fixes:\n\n1. virtual-scroll.js — mirror _scrollTop synchronously in _scrollToRowIndex after container.scrollTo(), closing the window where stale startIndex/offsetY are used before the async scroll event fires.\n\n2. library-browser.js — range-gate the SWR snapshot fallback: only return stale snapshot when its globalIndex range overlaps [startIndex, endIndex). Off-screen stale ranges return placeholders at correct positions instead.\n\n3. type-to-jump.js — defer _isJumping = false to $nextTick so the shimmer branch stays engaged through the first Alpine re-render after the page arrives.
<!-- SECTION:DESCRIPTION:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented all three root-cause fixes. Tests updated in library-browser.swr.test.js to reflect the new range-gate semantics: non-overlapping snapshot fallback now returns position-correct placeholders instead of off-screen stale rows. 15/15 tests pass, deno lint clean.
<!-- SECTION:FINAL_SUMMARY:END -->
