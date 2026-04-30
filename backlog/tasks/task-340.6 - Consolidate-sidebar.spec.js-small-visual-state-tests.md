---
id: TASK-340.6
title: Consolidate sidebar.spec.js small visual/state tests
status: In Progress
assignee: []
created_date: '2026-04-30 19:29'
updated_date: '2026-04-30 19:30'
labels:
  - testing
  - e2e
dependencies: []
parent_task_id: TASK-340
priority: low
ordinal: 12500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`sidebar.spec.js` has 55 tests across 1120 LOC. Many are small single-assertion visual/state checks that each pay the full `page.goto('/')` + Alpine bootstrap cost.

**Consolidate** small isolated checks into composite tests:
- "show icons", "show labels", "highlight active", "section icons" → merge into one "sidebar nav renders correctly" test with multiple assertions
- Similar small groups in Playlists Section ("show header", "show create button", "show empty state") → one composite test

**Keep as-is**:
- Multi-select and keyboard-delete tests (Playlist Multi-Select and Batch Delete group) — real complex interactions
- Drag-and-drop tests
- Collapse/expand tests with state assertions

Target: reduce sidebar.spec.js from 55 tests to ~35-40, cutting 3-5 redundant `page.goto` calls.

Critical file:
- `app/frontend/tests/sidebar.spec.js`
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Small isolated visual checks consolidated
- [ ] #2 Interaction-heavy tests (multi-select, drag, keyboard) preserved unchanged
- [ ] #3 task test:e2e green
<!-- AC:END -->
