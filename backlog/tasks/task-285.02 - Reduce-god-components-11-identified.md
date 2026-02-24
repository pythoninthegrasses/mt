---
id: TASK-285.02
title: Reduce god components (11 identified)
status: To Do
assignee: []
created_date: '2026-02-24 00:05'
labels:
  - tech-debt
  - code-health
dependencies: []
parent_task_id: TASK-285
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Roam health analysis found 11 god components (symbols with degree > 20). God components are tightly coupled to many other symbols, making them fragile and hard to change safely.

Run `roam health` to list all god components with their degree and category. Use `roam context <name>` and `roam impact <name>` to understand each component's role before refactoring. Consider extracting responsibilities into smaller, focused modules.

**Context:** This is part of the roam health improvement initiative (TASK-285). Current health score is 53/100.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 God component count reduced to 5 or fewer
- [ ] #2 No god component has degree > 30
- [ ] #3 Existing tests still pass after refactoring
<!-- AC:END -->
