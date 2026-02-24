---
id: TASK-285.09
title: 'Address debt hotspot: library.spec.js (score 815)'
status: In Progress
assignee: []
created_date: '2026-02-24 00:05'
updated_date: '2026-02-24 20:13'
labels:
  - tech-debt
  - code-health
  - testing
dependencies: []
references:
  - app/frontend/tests/library.spec.js
parent_task_id: TASK-285
priority: low
ordinal: 10000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Roam identified `app/frontend/tests/library.spec.js` as the #4 debt hotspot (score 815, complexity 4.0, churn 20.3k). High churn in a test file suggests the tests are tightly coupled to implementation details, requiring changes whenever the code changes.

**Location:** `app/frontend/tests/library.spec.js`

**Approach:** Refactor tests to be more behavior-oriented (test user-visible outcomes, not implementation details). Extract shared test helpers and fixtures. Consider splitting into focused test files per feature area (search, sort, filter, etc.).

**Context:** This is part of the roam health improvement initiative (TASK-285). Should be done after or alongside the createLibraryBrowser complexity reduction.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Test file split into focused test modules or significantly simplified
- [ ] #2 Tests verify behavior rather than implementation details
- [ ] #3 All tests pass and coverage is maintained or improved
<!-- AC:END -->
