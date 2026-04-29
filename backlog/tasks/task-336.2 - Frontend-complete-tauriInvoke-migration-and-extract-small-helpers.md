---
id: TASK-336.2
title: 'Frontend: complete tauriInvoke migration and extract small helpers'
status: Done
assignee: []
created_date: '2026-04-29 04:20'
updated_date: '2026-04-29 06:15'
labels:
  - refactor
  - frontend
  - complexity
dependencies: []
references:
  - 'https://github.com/pythoninthegrass/mt/commit/4ba8be8'
parent_task_id: TASK-336
priority: medium
ordinal: 7500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Closes the leak left by PR #44's `tauriInvoke` extraction: the helper exists in `app/frontend/js/api/shared.js` but several components still call `window.__TAURI__.core.invoke(...)` directly. Also extracts two more small helpers that have multiple inline copies. Estimated ~100 LOC reduction.

**Scope:**

1. **Replace direct `window.__TAURI__.core.invoke` with `tauriInvoke`** in 14 sites:
   - `app/frontend/js/components/settings-view.js` (9 sites near lines 195, 211, 229, 296, 312, 345, 379, 427, 943)
   - `app/frontend/js/components/metadata-modal.js` (3 sites: 204, 266, 393)
   - `app/frontend/js/components/stats-view.js` (1 site: 215)
   - `app/frontend/js/utils/library-operations.js` (1 site: 489)

2. **Add `tauriConfirm(message, options)` to `app/frontend/js/api/shared.js`** wrapping `window.__TAURI__?.dialog?.confirm(...) ?? window.confirm(...)`. Replace the 5 inlined copies in:
   - `app/frontend/js/mixins/context-menu-actions.js` (~line 456)
   - `app/frontend/js/mixins/column-settings.js` (~line 218)
   - `app/frontend/js/mixins/playlist-crud.js` (~line 210)
   - `app/frontend/js/components/settings-view.js` (~lines 393, 798, 986)

3. **Move the local `formatDuration` shorthand from `app/frontend/js/components/stats-view.js:170-179`** into `app/frontend/js/utils/formatting.js` as a new export `formatDurationShorthand` (returns "3d 2h" / "45m" style). Note: the existing `formatDuration` in `formatting.js` returns `MM:SS` and is **not** a drop-in replacement — keep both.

**Files to modify:**
- `app/frontend/js/api/shared.js` (add `tauriConfirm`)
- `app/frontend/js/utils/formatting.js` (add `formatDurationShorthand`)
- `app/frontend/js/components/settings-view.js`
- `app/frontend/js/components/metadata-modal.js`
- `app/frontend/js/components/stats-view.js`
- `app/frontend/js/utils/library-operations.js`
- `app/frontend/js/mixins/context-menu-actions.js`
- `app/frontend/js/mixins/column-settings.js`
- `app/frontend/js/mixins/playlist-crud.js`
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 No remaining direct calls to window.__TAURI__.core.invoke outside app/frontend/js/api/
- [x] #2 tauriConfirm helper exists in api/shared.js and is used by all 5 previous inline confirm-dialog sites
- [x] #3 formatDurationShorthand exists in utils/formatting.js and is imported by stats-view.js; the local copy is removed
- [x] #4 deno lint and deno fmt --check pass
- [x] #5 cd app/frontend && npx vitest run passes
- [ ] #6 cd app/frontend && npx playwright test --grep '@tauri' passes (or is skipped consistently with main)
- [ ] #7 Manual smoke: open app, change settings, edit a track's metadata, view stats page, confirm a destructive action via context menu — no regressions
<!-- AC:END -->
