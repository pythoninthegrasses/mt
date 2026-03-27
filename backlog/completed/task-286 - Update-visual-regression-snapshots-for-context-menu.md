---
id: TASK-286
title: Update visual regression snapshots for context menu
status: Done
assignee: []
created_date: '2026-02-24 17:54'
updated_date: '2026-02-24 18:07'
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
- [x] #1 All 3 visual regression screenshots updated to match current UI
- [x] #2 visual-regression.spec.js passes with 0 failures
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Regenerated 3 stale visual regression snapshots using `npx playwright test visual-regression --grep "..." --update-snapshots`:\n- `context-menu-track-webkit-darwin.png` (227x294 -> 227x331, reflects "Add to Liked Songs" menu item)\n- `settings-panel-general-webkit-darwin.png` (reflects watched folders moved to Library panel)\n- `settings-panel-library-webkit-darwin.png` (reflects watched folders addition)\n\nFull suite: 38/38 passed.
<!-- SECTION:FINAL_SUMMARY:END -->
