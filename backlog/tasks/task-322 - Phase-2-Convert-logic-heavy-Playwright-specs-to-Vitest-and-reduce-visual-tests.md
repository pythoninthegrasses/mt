---
id: TASK-322
title: >-
  Phase 2: Convert logic-heavy Playwright specs to Vitest and reduce visual
  tests
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
  - app/frontend/tests/sorting-ignore-words.spec.js
  - app/frontend/tests/keyboard-shortcuts.spec.js
  - app/frontend/tests/playback.spec.js
  - app/frontend/tests/visual-regression.spec.js
  - app/frontend/tests/startup-fouc.spec.js
  - app/frontend/__tests__/playback-regression.test.js
  - app/frontend/__tests__/shortcuts.test.js
priority: medium
ordinal: 14000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Move pure-logic Playwright tests to Vitest unit tests and trim low-value visual/CSS specs.

**Convert to Vitest:**
- `sorting-ignore-words.spec.js` (563 lines) — move sorting algorithm tests to Vitest, keep 2-3 UI integration tests
- `keyboard-shortcuts.spec.js` (420 lines) — move to Vitest, keep 1-2 integration tests

**Reduce:**
- `playback.spec.js` (644 lines) — keep only hardware-dependent tests, remove state-only tests (70% overlap with `playback-regression.test.js`)
- `visual-regression.spec.js` (539 lines) — reduce from 38 to 7-8 critical UI state snapshots
- `startup-fouc.spec.js` (440 lines) — keep 3-4 critical x-cloak timing tests

Estimated savings: ~1,500 lines of Playwright, new Vitest coverage for sorting/shortcuts.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 sorting-ignore-words logic tests exist in Vitest
- [x] #2 keyboard-shortcuts logic tests exist in Vitest
- [x] #3 playback.spec.js reduced to hardware-dependent E2E tests only
- [x] #4 visual-regression.spec.js reduced to 7-8 critical snapshots
- [x] #5 startup-fouc.spec.js reduced to 3-4 tests
- [x] #6 All Vitest and remaining Playwright tests pass
<!-- AC:END -->
