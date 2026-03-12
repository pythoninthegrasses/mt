---
id: TASK-285.07
title: 'Address debt hotspot: views/library.html (score 1005)'
status: Done
assignee: []
created_date: '2026-02-24 00:05'
updated_date: '2026-02-24 21:08'
labels:
  - tech-debt
  - code-health
dependencies: []
references:
  - app/frontend/views/library.html
  - app/frontend/js/components/library-browser.js
parent_task_id: TASK-285
priority: medium
ordinal: 8000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Roam identified `app/frontend/views/library.html` as the #2 debt hotspot (score 1005, complexity 23.8, churn 4.2k). High template complexity in HTML views typically indicates too much logic embedded in the template layer.

**Location:** `app/frontend/views/library.html`

Run `roam file app/frontend/views/library.html` to see the file skeleton. Examine Alpine.js directives for complex inline expressions that should be extracted to the component JS.

**Approach:** Move complex Alpine.js expressions and inline logic from the template into `library-browser.js` component methods. Keep templates declarative with simple bindings.

**Context:** This is part of the roam health improvement initiative (TASK-285). Closely related to the createLibraryBrowser complexity task.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Template complexity reduced (roam reports lower complexity for this file)
- [x] #2 Inline Alpine.js expressions extracted to named methods
- [x] #3 Library view renders and functions correctly
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Extracted 12 complex inline Alpine.js expressions from library.html into named methods in library-browser.js:

- `getColumnPaddingClass()` - replaces nested ternary used in 2 places
- `getColumnHeaderClasses()` - replaces 10-element class array
- `getColumnHeaderStyle()` - replaces inline style ternary
- `handleColumnHeaderMousedown()` - replaces inline guard condition
- `handleColumnHeaderClick()` - replaces inline guard condition
- `getTrackRowStyle()` - replaces inline style concatenation with ternary
- `getTrackRowClasses()` - replaces 6-element class array with complex conditions
- `getTrackCellClasses()` - replaces 3-element class array with nested ternary
- `getIndexDisplay()` - replaces inline ternary for playlist/library index
- `handleContextMenuItemClick()` - replaces inline multi-branch click handler
- `handleSubmenuMouseenter()` / `handleSubmenuMouseleave()` - replaces inline timeout management
- `getSubmenuStyle()` - replaces complex inline style expression

Results: library.html cognitive_load 8.3 -> 7.9, line count 415 -> 396. library-browser.js cognitive_load 66 -> 66.5 (marginal increase from simple delegating methods). All unit tests pass.
<!-- SECTION:FINAL_SUMMARY:END -->
