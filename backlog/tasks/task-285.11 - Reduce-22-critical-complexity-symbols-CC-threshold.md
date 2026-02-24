---
id: TASK-285.11
title: Reduce 22 critical-complexity symbols (CC > threshold)
status: In Progress
assignee: []
created_date: '2026-02-24 00:05'
updated_date: '2026-02-24 20:13'
labels:
  - tech-debt
  - code-health
  - complexity
dependencies: []
parent_task_id: TASK-285
priority: low
ordinal: 12000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Roam complexity analysis found 22 symbols at critical complexity and 22 at high complexity (44 total flagged). The top 3 are tracked as separate tasks (createLibraryBrowser CC 610, initTauriDragDrop CC 438, createLibraryStore CC 291). This task covers the remaining 19 critical-complexity symbols.

Run `roam complexity` to get the full list. Use `roam complexity --threshold 50` to see all symbols above CC 50. For each, use `roam preflight <name>` before refactoring.

**Approach:** Work through the list by descending CC score. Extract helper functions, simplify control flow, and reduce nesting. Average CC across the codebase is 8.3 — aim to bring critical symbols below 50.

**Context:** This is part of the roam health improvement initiative (TASK-285).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 No symbols with CC > 300 remain (top 3 handled by dedicated tasks)
- [ ] #2 Critical-complexity count reduced from 22 to under 10
- [ ] #3 All tests pass after each refactoring batch
<!-- AC:END -->
