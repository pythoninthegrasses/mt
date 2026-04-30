---
id: TASK-340.2
title: Move lastfm.spec.js pure-logic tests to Vitest and remove sleep waits
status: Done
assignee: []
created_date: '2026-04-30 19:29'
updated_date: '2026-04-30 23:11'
labels:
  - testing
  - e2e
  - vitest
  - lastfm
dependencies: []
parent_task_id: TASK-340
priority: medium
ordinal: 8500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Two separate issues in `lastfm.spec.js`:

**Move to new `__tests__/lastfm.api.test.js`** (no DOM, pure API/logic):
- `:533` "threshold not triggered below threshold" and `:547` "triggered at threshold" — literal arithmetic checks (`0.79 >= 0.8`)
- `:559`, `:587`, `:613` — scrobble response handling (assert mock-call payload)
- Now Playing payload tests `:299`, `:345`, `:380`, `:409` — assert mock-call args, no DOM

**Fix `waitForTimeout` cargo-culting** in remaining Playwright tests:
- Replace `waitForTimeout(500)` and `waitForTimeout(1500)` patterns with `waitForSelector` / `expect.poll`
- `:1089` "loading state during import" (5.0s): replace artificial `await page.waitForTimeout(2000)` inside mock route + `waitForTimeout(2500)` after with on-demand mock resolution

Critical files:
- `app/frontend/tests/lastfm.spec.js`
- `app/frontend/__tests__/lastfm.api.test.js` (new file)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Threshold logic and scrobble response tests moved to __tests__/lastfm.api.test.js
- [x] #2 waitForTimeout patterns replaced with deterministic waits
- [x] #3 lastfm.spec.js:1089 no longer takes 5s
- [x] #4 npx vitest run green
- [x] #5 task test:e2e green with reduced count
<!-- AC:END -->
