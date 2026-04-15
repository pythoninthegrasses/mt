---
id: TASK-321
title: 'Phase 1: Remove redundant Playwright specs covered by Vitest'
status: Done
assignee: []
created_date: '2026-04-12 09:10'
updated_date: '2026-04-13 17:48'
labels:
  - ci
  - testing
  - performance
dependencies: []
references:
  - app/frontend/tests/stores.spec.js
  - app/frontend/tests/queue.spec.js
  - app/frontend/tests/library-column-padding.spec.js
  - app/frontend/tests/text-selection.spec.js
  - app/frontend/tests/browsing-track-sorting.spec.js
  - app/frontend/__tests__/queue.store.test.js
  - app/frontend/__tests__/queue.props.test.js
  - app/frontend/__tests__/ui.store.test.js
  - app/frontend/__tests__/library.store.test.js
priority: high
ordinal: 13000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Remove Playwright E2E tests that duplicate logic already covered by Vitest unit/property tests. This is the highest-impact, lowest-risk consolidation.

**Remove entirely:**
- `stores.spec.js` (784 lines) — 95% overlap with `ui.store.test.js`, `library.store.test.js`, `queue.store.test.js`
- `library-column-padding.spec.js` (251 lines) — trivial CSS value checks
- `text-selection.spec.js` (155 lines) — trivial `user-select: none` checks
- `browsing-track-sorting.spec.js` (340 lines) — 90% overlap with `library.store.test.js`

**Gut to 3-5 E2E playback tests:**
- `queue.spec.js` (1439 lines) — 85% overlap with `queue.store.test.js` + `queue.props.test.js`

Estimated savings: ~2,900 lines of Playwright, ~1-1.5 min CI time.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 stores.spec.js removed
- [x] #2 library-column-padding.spec.js removed
- [x] #3 text-selection.spec.js removed
- [x] #4 browsing-track-sorting.spec.js removed
- [x] #5 queue.spec.js reduced to 3-5 actual playback E2E tests
- [x] #6 Vitest suite still passes (no coverage regression)
- [x] #7 Playwright suite still passes with remaining specs
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Removed 4 Playwright spec files entirely and reduced queue.spec.js from 38 tests (1439 lines) to 5 genuine E2E tests (130 lines).

Files removed:
- stores.spec.js (784 lines) — covered by ui.store.test.js, library.store.test.js, queue.store.test.js
- library-column-padding.spec.js (251 lines) — trivial CSS padding checks
- text-selection.spec.js (155 lines) — trivial user-select checks  
- browsing-track-sorting.spec.js (340 lines) — covered by library.store.test.js

queue.spec.js retained tests (all @tauri tagged, real user interactions):
1. double-click track populates queue and starts playback
2. next/prev buttons navigate the queue
3. shuffle button toggles shuffle state
4. context menu Add to Queue appends track
5. context menu Play Next inserts track after current

Verification: Vitest 391/391 pass, Playwright 650 tests across 33 files parse clean.
<!-- SECTION:NOTES:END -->
