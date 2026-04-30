---
id: TASK-340.3
title: Delete settings.spec.js duplicate tests already covered by Vitest
status: In Progress
assignee: []
created_date: '2026-04-30 19:29'
updated_date: '2026-04-30 19:30'
labels:
  - testing
  - e2e
  - vitest
dependencies: []
parent_task_id: TASK-340
priority: medium
ordinal: 9500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Several test groups in `settings.spec.js` are pure store-state manipulation with no browser persistence check, and duplicate existing `__tests__/ui.store.test.js` coverage.

**Delete** (duplicates only — keep persistence-after-reload tests):
- View mode group `:340-393` (5 tests) → `ui.store.test.js:355-394`
- Sidebar width clamp `:444` → `ui.store.test.js:280-308`
- Invalid section guard `:519` → `ui.store.test.js:582-606`
- Sort-ignore defaults `:580-588` (2 tests) → `ui.store.test.js:608-622`

**Keep**:
- All persistence-after-reload tests (`:48`, `:75`, `:96`, `:114`, `:136`, `:155`) — exercise real localStorage round-trip in browser
- Theme DOM tests (`:197-292`) — assert real DOM class changes
- Settings navigation (`:495`) — real click interactions
- Log Export group (`:685-871`) — real UI flows
- Sidebar Theme Styling (`:936-1048`) — visual regression guards

Critical file:
- `app/frontend/tests/settings.spec.js`
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 ~10 duplicate tests deleted from settings.spec.js
- [ ] #2 All persistence-after-reload and DOM-interaction tests preserved
- [ ] #3 npx vitest run green
- [ ] #4 task test:e2e green
<!-- AC:END -->
