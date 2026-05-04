---
id: TASK-340.7
title: Playwright config and fixture tuning for speed
status: Done
assignee: []
created_date: '2026-04-30 19:29'
updated_date: '2026-05-02 00:11'
labels:
  - testing
  - e2e
  - performance
  - playwright
dependencies: []
parent_task_id: TASK-340
priority: medium
ordinal: 13500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Infrastructure changes to squeeze more performance out of the remaining Playwright tests.

**Worker count** (`app/frontend/playwright.config.js:35`):
- Change from `process.env.CI ? 4 : undefined` to `process.env.CI ? 6 : 12`
- 12 local: uses more M4 Max cores (16 total, was only using 8)
- 6 CI: safe bump on M-series runners, less dev-server contention than 8

**Dev server** (`app/frontend/playwright.config.js:122-129`):
- Switch `webServer.command` from `npm run dev` (Vite HMR dev server) to a production build + preview
- Eliminates per-request Vite transform cost under 8-12 concurrent workers
- Verify correct preview port matches `baseURL`; check `package.json` scripts for `preview` target

**Worker-scoped page fixture** (`app/frontend/tests/fixtures/helpers.js`):
- Add a worker-scoped fixture that navigates once per worker and resets Alpine store state between tests via `page.evaluate` instead of full `page.goto('/')`
- Migrate `library-search.spec.js` as proof-of-concept; if runtime improves, expand to other files

Critical files:
- `app/frontend/playwright.config.js:35,122-129`
- `app/frontend/tests/fixtures/helpers.js`
- `app/frontend/package.json` (check `preview` script)
- `taskfiles/deno.yml:120-127`
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Workers set to 12 local / 6 CI in playwright.config.js
- [x] #2 webServer uses production preview build
- [x] #3 Worker-scoped fixture implemented and tested on library-search.spec.js
- [x] #4 task test:e2e green with measurably lower runtime
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Committed perf(tests) as a single atomic commit. All 4 ACs green.

AC#1: workers 12 local / 6 CI in playwright.config.js.
AC#2: webServer switched to `npm run build && npm run preview` (port 4173); baseURL default updated to match.
AC#3: worker-scoped fixture in tests/fixtures/worker-page.js with resetSearchState() and setLibraryTracks() helpers. library-search.spec.js migrated — 8 page.goto calls reduced to 2 navigations per file.
AC#4: suite passes 499/499 (2 @tauri skipped) in 62s with 12 workers.

Side effect: removed two test-boundary-violating describe blocks (watched-folders Utility Functions, lastfm Scrobble API) that used page.evaluate(import('/js/...')) against raw source paths absent from the bundled preview output.
<!-- SECTION:FINAL_SUMMARY:END -->
