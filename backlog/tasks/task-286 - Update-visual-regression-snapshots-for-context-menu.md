---
id: TASK-286
title: Update visual regression snapshots for context menu
status: To Do
assignee: []
created_date: '2026-02-24 17:54'
labels:
  - testing
  - visual-regression
dependencies: []
references:
  - app/frontend/tests/visual-regression.spec.js
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
3 visual regression screenshot tests fail because the stored snapshots are stale:

1. `visual-regression.spec.js:529` — context menu screenshot (227x294 expected, 227x331 actual) due to "Add to Liked Songs" menu item height
2. `visual-regression.spec.js:217` — settings general panel
3. `visual-regression.spec.js:233` — settings library panel

These failures predate the library-browser mixin refactor (TASK-285.04) but were surfaced during its test run.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 All 3 visual regression screenshots updated to match current UI
- [ ] #2 visual-regression.spec.js passes with 0 failures
<!-- AC:END -->
