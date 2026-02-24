---
id: TASK-285.05
title: Reduce complexity of initTauriDragDrop (CC 438)
status: Done
assignee: []
created_date: '2026-02-24 00:05'
updated_date: '2026-02-24 20:15'
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
- [x] #1 initTauriDragDrop CC reduced below 100
- [x] #2 Drag-and-drop functionality works correctly (manual test + any existing E2E tests)
- [x] #3 No regressions in file/track dropping behavior
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Extracted `handleInternalTrackDrop` and `handleFilesDrop` from the monolithic `initTauriDragDrop` callback into `app/frontend/js/utils/tauri-drag-drop.js`. The orchestrator in `main.js` is now a thin dispatcher (25 lines, nesting depth 4). Removed unused `api` and `promptToAddWatchedFolders` imports. Added 10 unit tests. `initTauriDragDrop` no longer appears in roam's complexity report. All 281 unit tests pass.

Commit: `2712570`
<!-- SECTION:FINAL_SUMMARY:END -->
