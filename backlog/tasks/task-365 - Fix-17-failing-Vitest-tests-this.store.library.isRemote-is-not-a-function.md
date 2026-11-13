---
id: TASK-365
title: 'Fix 17 failing Vitest tests: this.$store.library.isRemote is not a function'
status: To Do
assignee: []
created_date: '2026-11-13T19:06:00Z'
labels:
  - ci
  - frontend
  - tests
dependencies: []
references:
  - 'https://github.com/pythoninthegrasses/mt/actions/runs/43487738027'
  - app/frontend/js/stores/library.js
priority: medium
type: bug
ordinal: 68500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Vitest Unit Tests fails with 17 failures, all `TypeError: this.$store.library.isRemote is not a function`. Previously noted as pre-existing in TASK-355.1/355.2 notes (context-menu-favorites, go-to-album, go-to-artist, library.store test files). Likely introduced with the Plex/remote library work (TASK-342): the library store gained isRemote() but the test stubs/mocks of the store do not provide it. Seen on runs 38488090690 and 43487738027.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Root cause identified: stale mocks in the tests vs a real store regression
- [ ] #2 All 17 failing Vitest tests pass with `cd app/frontend && npx vitest run`
- [ ] #3 Vitest Unit Tests CI job is green
- [ ] #4 No store logic tests are duplicated into Playwright (Vitest remains authoritative per Test Boundaries)
<!-- AC:END -->
