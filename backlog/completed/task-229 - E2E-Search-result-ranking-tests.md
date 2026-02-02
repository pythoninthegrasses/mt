---
id: task-229
title: 'E2E: Search result ranking tests'
status: Done
assignee: []
created_date: '2026-01-28 05:40'
updated_date: '2026-01-28 21:23'
labels:
  - e2e
  - library
  - search
  - P1
dependencies: []
priority: high
ordinal: 953.125
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add Playwright E2E tests for search result ranking logic. Search tests exist but don't verify result ordering logic.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Exact title match ranks first
- [x] #2 Artist match ranks appropriately
- [x] #3 Partial matches appear after exact matches
- [x] #4 Search with multiple terms returns expected order
<!-- AC:END -->
