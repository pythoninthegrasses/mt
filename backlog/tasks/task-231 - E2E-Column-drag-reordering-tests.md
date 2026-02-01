---
id: task-231
title: 'E2E: Column drag reordering tests'
status: Done
assignee: []
created_date: '2026-01-28 05:40'
updated_date: '2026-01-29 21:51'
labels:
  - e2e
  - library
  - P2
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add Playwright E2E tests for library column drag-to-reorder functionality. Column visibility tests exist but not drag-to-reorder.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Drag column header to reorder
- [x] #2 New order persists in localStorage
- [x] #3 Reset to default order option works
- [x] #4 Drag feedback visual indicator shows
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Analysis

Existing coverage:
- AC#1: ✅ `should reorder columns by dragging` (line 1824)
- AC#2: ✅ `should persist column order to localStorage` (line 1931)
- AC#3: ❌ Reset test only checks widths, not order
- AC#4: ❌ No test for visual feedback during drag

Visual feedback classes:
- `.dragging-column` - box-shadow, z-index, opacity
- `.other-dragging` - opacity 0.6
- `.shift-left`/`.shift-right` - column shift animation

## Completion

Added 2 new tests:
- `should reset column order when using Reset Columns to Defaults`
- `should show visual feedback during column drag`

All 4 acceptance criteria now have test coverage.
<!-- SECTION:NOTES:END -->
