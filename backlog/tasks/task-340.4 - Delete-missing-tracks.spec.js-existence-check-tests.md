---
id: TASK-340.4
title: Delete missing-tracks.spec.js existence-check tests
status: Done
assignee: []
created_date: '2026-04-30 19:29'
updated_date: '2026-05-01 00:06'
labels:
  - testing
  - e2e
dependencies: []
parent_task_id: TASK-340
priority: low
ordinal: 10500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Four tests in `missing-tracks.spec.js` assert only that store methods exist (`typeof store.method === 'function'`). These have no place in Playwright — they are contract checks that belong in Vitest or are implied by the store's own tests.

**Delete**:
- `missing-tracks.spec.js:256` "should have UI store with missingTrackPopover methods"
- `missing-tracks.spec.js:408` "should have library store with missing track support"
- `missing-tracks.spec.js:416` "should have UI store with missingTrackModal property"
- `missing-tracks.spec.js:424` "should have closeMissingTrackModal method on UI store"

Rely on existing Vitest store tests to enforce these contracts.

Critical file:
- `app/frontend/tests/missing-tracks.spec.js`
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 4 existence-check tests deleted
- [x] #2 Remaining missing-tracks tests (popover, modal, playback interception) still green
- [x] #3 task test:e2e green
<!-- AC:END -->
