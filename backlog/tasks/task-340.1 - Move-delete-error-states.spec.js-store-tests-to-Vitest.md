---
id: TASK-340.1
title: Move/delete error-states.spec.js store tests to Vitest
status: Done
assignee: []
created_date: '2026-04-30 19:29'
updated_date: '2026-04-30 22:19'
labels:
  - testing
  - e2e
  - vitest
dependencies: []
parent_task_id: TASK-340
priority: medium
ordinal: 7500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The majority of `error-states.spec.js` (909 LOC) contains pure store/API-client unit tests that violate the documented Playwright test boundary.

**Delete** (already covered by Vitest):
- Toast group `:218-339` (9 tests) → `__tests__/ui.store.test.js:398-472`
- Loading states `:523-562` → `ui.store.test.js:550-579`
- Modal states `:574-621` → `ui.store.test.js:474-506`
- CSS theme toast tests `:341-389` (per CLAUDE.md: "CSS details — design review, not tests")

**Move** to new `__tests__/api.errors.test.js` (pure fetch-mocked API client, no DOM):
- 404/malformed/empty body responses `:113-200`
- Playlist/queue/settings/lastfm/favorites/watched-folders error handling `:401-849`
- Concurrent requests `:851`

**Keep** only the 7-10 tests that render error UI and assert real DOM state.

Target: file shrinks from ~909 LOC to ~150-200 LOC.

Critical files:
- `app/frontend/tests/error-states.spec.js`
- `app/frontend/__tests__/ui.store.test.js` (reference existing coverage)
- `app/frontend/__tests__/api.errors.test.js` (new file)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Duplicate toast/loading/modal tests deleted from error-states.spec.js
- [x] #2 API-client-only tests extracted to __tests__/api.errors.test.js
- [x] #3 CSS theme toast tests deleted
- [x] #4 npx vitest run still green
- [x] #5 task test:e2e still green with reduced test count
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Trimmed error-states.spec.js from 909 LOC to 104 LOC (3 Network Failure Handling E2E tests kept). Created __tests__/api.errors.test.js (155 LOC, 15 tests) covering API client error handling via fetch mocking. vi.mock hoists tauriInvoke replacement so Node tests never touch window.__TAURI__. Vitest suite: 530 tests green. Playwright error-states: 3 tests green.
<!-- SECTION:FINAL_SUMMARY:END -->
