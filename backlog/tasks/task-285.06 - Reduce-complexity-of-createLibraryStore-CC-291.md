---
id: TASK-285.06
title: Reduce complexity of createLibraryStore (CC 291)
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
  - app/frontend/js/stores/library.js
parent_task_id: TASK-285
priority: medium
ordinal: 7000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The `createLibraryStore` function in `app/frontend/js/stores/library.js` has a cognitive complexity of 291 — the third highest in the codebase.

**Location:** `app/frontend/js/stores/library.js` (churn 6.9k, 43 commits, coupled to 55 files)

Run `roam context createLibraryStore --task refactor` to understand its role. It's a key abstraction (high PageRank, fan-out 18). Use `roam preflight createLibraryStore` before making changes.

**Approach:** Extract distinct responsibilities (sorting, filtering, pagination, selection, search) into composable sub-stores or utility modules. The Alpine.js store pattern supports composition.

**Context:** This is part of the roam health improvement initiative (TASK-285). Current health score is 53/100.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 createLibraryStore CC reduced below 100
- [ ] #2 All existing library-related tests pass
- [ ] #3 No regressions in library store behavior (sorting, filtering, search, etc.)
<!-- AC:END -->
