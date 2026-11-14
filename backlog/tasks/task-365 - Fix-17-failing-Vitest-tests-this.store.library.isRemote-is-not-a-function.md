---
id: TASK-365
title: 'Fix 17 failing Vitest tests: this.$store.library.isRemote is not a function'
status: Done
assignee: []
created_date: '2026-11-13T19:06:00Z'
updated_date: '2026-11-14T03:16:00Z'
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
- [x] #1 Root cause identified: stale mocks in the tests vs a real store regression
- [x] #2 All 17 failing Vitest tests pass with `cd app/frontend && npx vitest run`
- [x] #3 Vitest Unit Tests CI job is green
- [x] #4 No store logic tests are duplicated into Playwright (Vitest remains authoritative per Test Boundaries)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Root cause: stale test mocks, not a store regression. The hand-built library store mocks in go-to-album, go-to-artist and context-menu-favorites lacked isRemote, which context-menu-actions and albums-browser now call (16 of 17 failures). The 17th, library.store FOUC #2, asserted pre-4bf54fa behavior; visibleTracks intentionally returns position-correct placeholders now. Fixed in 0297bc6. Verified: 643/643 locally and in CI run 43547837354.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added isRemote: () => false to the library store mocks in go-to-album, go-to-artist and context-menu-favorites, and updated the stale FOUC #2 assertion in library.store.test.js to expect position-correct placeholders. All 643 Vitest tests pass locally and the Vitest CI job is green in run 43547837354. No store logic was duplicated into Playwright.
<!-- SECTION:FINAL_SUMMARY:END -->
