---
id: TASK-285.04
title: Reduce complexity of createLibraryBrowser (CC 610)
status: To Do
assignee: []
created_date: '2026-02-24 00:05'
labels:
  - tech-debt
  - code-health
  - complexity
dependencies: []
references:
  - app/frontend/js/components/library-browser.js
  - app/frontend/views/library.html
parent_task_id: TASK-285
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The `createLibraryBrowser` function in `app/frontend/js/components/library-browser.js` has a cognitive complexity of 610 — the highest in the codebase. This makes it extremely difficult to reason about, test, and modify safely.

**Location:** `app/frontend/js/components/library-browser.js` (also the #1 debt hotspot with score 1051, churn 13k)

Run `roam context createLibraryBrowser --task refactor` to understand its callers, callees, and dependencies. Use `roam preflight createLibraryBrowser` before making changes to assess blast radius.

**Approach:** Extract cohesive groups of functionality into separate functions or sub-components. The Alpine.js component factory pattern used in this codebase makes it natural to split into smaller stores/components.

**Context:** This is part of the roam health improvement initiative (TASK-285). Current health score is 53/100.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 createLibraryBrowser CC reduced below 150
- [ ] #2 All existing library browser E2E tests pass
- [ ] #3 No functionality regressions in library browsing
<!-- AC:END -->
