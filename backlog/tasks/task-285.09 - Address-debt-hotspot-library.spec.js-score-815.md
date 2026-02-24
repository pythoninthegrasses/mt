---
id: TASK-285.09
title: 'Address debt hotspot: library.spec.js (score 815)'
status: Done
assignee: []
created_date: '2026-02-24 00:05'
updated_date: '2026-02-24 21:49'
labels:
  - tech-debt
  - code-health
  - testing
dependencies: []
references:
  - app/frontend/tests/library.spec.js
parent_task_id: TASK-285
priority: low
ordinal: 10000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Roam identified `app/frontend/tests/library.spec.js` as the #4 debt hotspot (score 815, complexity 4.0, churn 20.3k). High churn in a test file suggests the tests are tightly coupled to implementation details, requiring changes whenever the code changes.

**Location:** `app/frontend/tests/library.spec.js`

**Approach:** Refactor tests to be more behavior-oriented (test user-visible outcomes, not implementation details). Extract shared test helpers and fixtures. Consider splitting into focused test files per feature area (search, sort, filter, etc.).

**Context:** This is part of the roam health improvement initiative (TASK-285). Should be done after or alongside the createLibraryBrowser complexity reduction.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Test file split into focused test modules or significantly simplified
- [x] #2 Tests verify behavior rather than implementation details
- [x] #3 All tests pass and coverage is maintained or improved
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Split `library.spec.js` (4563 lines, 19 describe blocks) into 12 focused spec files plus a shared column-settings fixture. All 174 tests pass (160 unique test cases, some parameterized across view modes). Test count verified to match the original exactly.\n\n**New files:**\n- `tests/fixtures/column-settings.js` - shared localStorage helpers\n- `tests/library-browser.spec.js` - Library Browser, Playlist Position Column, Section Navigation, Responsive Layout\n- `tests/library-search.spec.js` - Search Functionality, Search Result Ranking\n- `tests/library-track-interaction.spec.js` - Sorting, Track Selection\n- `tests/library-context-menu.spec.js` - Context Menu, Context Menu Actions\n- `tests/library-column-resize.spec.js` - Column resize, auto-fit, no-scroll, layout\n- `tests/library-column-visibility.spec.js` - Header context menu, visibility, reorder, persist\n- `tests/library-column-padding.spec.js` - Column Padding Consistency (task-135)\n- `tests/library-playlist-features.spec.js` - Playlist Feature Parity (task-150), Playlist Load Regression (task-179)\n- `tests/library-metadata-editing.spec.js` - Metadata Editing (task-149), Metadata Editor Navigation (task-166)\n- `tests/library-metadata-persistence.spec.js` - Metadata Edits Persistence (task-226)\n- `tests/library-view-modes.spec.js` - Library View Mode Parity (task-227)\n- `tests/library-type-to-jump.spec.js` - Type-to-Jump Artist Navigation (task-255)\n\n**Deleted:** `tests/library.spec.js`
<!-- SECTION:FINAL_SUMMARY:END -->
