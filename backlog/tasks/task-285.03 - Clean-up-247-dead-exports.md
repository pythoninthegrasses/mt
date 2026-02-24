---
id: TASK-285.03
title: Clean up 247 dead exports
status: To Do
assignee: []
created_date: '2026-02-24 00:05'
labels:
  - tech-debt
  - code-health
dependencies: []
parent_task_id: TASK-285
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Roam health analysis found 247 dead exports — symbols that are exported but never imported anywhere. Dead exports add noise, inflate bundle size, and mislead developers about public API surface.

Run `roam dead-code` (or `roam health --json` and inspect the dead_exports section) to get the full list. Remove exports that are genuinely unused. For symbols that are used externally (e.g., by tests, scripts, or runtime reflection), verify before removing.

**Approach:**
1. Get the full dead export list from roam
2. Categorize by file/module
3. Remove in batches, running tests after each batch
4. Re-run `roam health` to confirm dead export count drops

**Context:** This is part of the roam health improvement initiative (TASK-285). Current health score is 53/100.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Dead export count reduced to under 50
- [ ] #2 No runtime regressions (all tests pass)
- [ ] #3 roam health dead_exports metric reflects the cleanup
<!-- AC:END -->
