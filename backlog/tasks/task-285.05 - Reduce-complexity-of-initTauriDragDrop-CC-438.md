---
id: TASK-285.05
title: Reduce complexity of initTauriDragDrop (CC 438)
status: In Progress
assignee: []
created_date: '2026-02-24 00:05'
updated_date: '2026-02-24 20:13'
labels:
  - tech-debt
  - code-health
  - complexity
dependencies: []
references:
  - app/frontend/main.js
  - app/frontend/index.html
parent_task_id: TASK-285
priority: medium
ordinal: 6000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The `initTauriDragDrop` function in `app/frontend/main.js` has a cognitive complexity of 438 — the second highest in the codebase.

**Location:** `app/frontend/main.js` (debt score 992 for index.html which likely wires this up)

Run `roam context initTauriDragDrop --task refactor` to understand its dependencies. Use `roam preflight initTauriDragDrop` before making changes.

**Approach:** Extract drag-drop event handlers, state management, and UI feedback into separate modules. Consider a state machine pattern for drag-drop lifecycle.

**Context:** This is part of the roam health improvement initiative (TASK-285). Current health score is 53/100.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 initTauriDragDrop CC reduced below 100
- [ ] #2 Drag-and-drop functionality works correctly (manual test + any existing E2E tests)
- [ ] #3 No regressions in file/track dropping behavior
<!-- AC:END -->
