---
id: TASK-346
title: Eliminate blank-row flash on cross-region type-to-jump
status: Done
assignee: []
created_date: '2026-05-24 20:09'
updated_date: '2026-05-25 03:33'
labels:
  - library
  - ux
  - type-to-jump
dependencies: []
references:
  - 'app/frontend/js/components/library-browser.js:338-376'
  - 'app/frontend/js/mixins/type-to-jump.js:142-177'
  - 'app/frontend/views/library.html:221-241'
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
After _jumpViaBackend resolves a prefix offset and calls scrollToOffset(), the virtual scroll viewport renders against a stale SWR snapshot (rows from wherever the user was before the jump) until the target page arrives. Users see content from the previous scroll region flashing briefly before the correct rows appear.

Root cause (library-browser.js:338-376 visibleTracks getter):
- SWR snapshot only resets on _loadGeneration change (section switch / search / sort), never on jump
- When the new offset's page is not yet loaded, result.length===0, triggering the snapshot fallback
- Snapshot holds the previous viewport's rows (e.g. page-0 artists), which paint into the new region

The library.html template (lines 221-241) has a full _placeholder / shimmer branch already declared but never activated — _placeholder is never set anywhere in the JS codebase.

Two candidate approaches:
1. Wire up the _placeholder branch: when visibleTracks returns [] and _isJumping is true, emit placeholder track objects with { _placeholder: true, globalIndex: i } so the shimmer rows render in the correct position.
2. Gate the SWR snapshot by index overlap: only return _swrSnapshot if the snapshot's globalIndex range overlaps the current viewport; otherwise return [] (blank rows or shimmer via CSS).

Approach 1 gives a richer UX. Approach 2 is simpler and avoids inventing new track objects.

Related: TASK-344 (previous iteration), TASK-345. These are now Done. The blank-row UX was deferred from the fix round that addressed the 'men' → O.A.R. correctness bug and the Plex sync scroll reset.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Typing a prefix that resolves via _jumpViaBackend shows no stale rows from previous viewport
- [x] #2 During the load window (_isJumping=true), the new region shows placeholder/shimmer rows or blank space — not content from another library region
- [ ] #3 Regression: 'dum' still lands on Dum Dum Girls; _jumpGen cancellation still works
<!-- AC:END -->
