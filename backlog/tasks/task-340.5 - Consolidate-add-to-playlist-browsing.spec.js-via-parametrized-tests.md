---
id: TASK-340.5
title: Consolidate add-to-playlist-browsing.spec.js via parametrized tests
status: In Progress
assignee: []
created_date: '2026-04-30 19:29'
updated_date: '2026-04-30 19:30'
labels:
  - testing
  - e2e
dependencies: []
parent_task_id: TASK-340
priority: low
ordinal: 11500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
12 tests in `add-to-playlist-browsing.spec.js` repeat the same sequence — open context menu → hover "Add to Playlist" → assert submenu appears — across album view, track-in-album view, and artist view. Each test navigates to `/` and bootstraps the full page.

**Consolidate** to 3-4 parametrized tests using a `for (const variant of variants)` loop over `{view, selector, label}` tuples, using `test.describe.parallel` so variants still run in parallel. The setup (navigate, open menu) runs once per variant instead of per-assertion.

Target: reduce from 12 tests to ~4 parametrized ones covering the same matrix of behaviors.

Critical file:
- `app/frontend/tests/add-to-playlist-browsing.spec.js`
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Tests consolidated to ~4 parametrized variants
- [ ] #2 All view/interaction combinations still covered
- [ ] #3 task test:e2e green
<!-- AC:END -->
