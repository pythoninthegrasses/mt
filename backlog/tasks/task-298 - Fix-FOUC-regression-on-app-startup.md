---
id: TASK-298
title: Fix FOUC regression on app startup
status: In Progress
assignee: []
created_date: '2026-03-10 05:39'
updated_date: '2026-03-10 05:42'
labels:
  - bug
  - frontend
  - ux
  - startup
  - regression
dependencies: []
references:
  - >-
    backlog/completed/task-250 -
    Fix-startup-rendering-flash-hide-UI-scaffolding-until-ready.md
  - >-
    backlog/completed/task-254 -
    Investigate-library-loading-spinner-on-startup-and-view-switches.md
  - backlog/completed/task-256 - Fix-intermittent-sidebar-styling-on-reload.md
  - app/frontend/main.js
  - app/frontend/index.html
  - crates/mt-tauri/tauri.conf.json
documentation:
  - docs/tauri-architecture.md
priority: high
ordinal: 2000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A flash of unstyled content (FOUC) has regressed on app startup. The three-stage reveal mechanism (hidden window -> early show -> x-cloak removal after Alpine init) is not fully preventing unstyled content from being visible during launch.

## Background

This was previously fixed in task-250, task-254, and task-256. The current architecture uses:

1. `visible: false` in `tauri.conf.json` to start the window hidden
2. `body[x-cloak]` CSS rule with `visibility: hidden !important`
3. Early `window.show()` call (before Alpine) to prevent WebKit IPC throttling
4. `revealApp()` via `setTimeout(0)` after `Alpine.start()` removes `x-cloak`
5. `applyInitialTheme()` pre-applies theme classes before Alpine starts

## Related Work

- **task-250**: Original FOUC fix (hide UI scaffolding until ready)
- **task-254**: Library loading spinner flash on startup
- **task-256**: Sidebar theme flash on reload
- **Commit 1b78d94c**: `fix(startup): prevent flash of unstyled content on app launch`
- **Commit e564b540**: `fix(ui): prevent intermittent sidebar theme flash on reload`
- **Commit 2f35425d**: `feat(frontend): perf instrumentation, early window show, scan loading state`

## Key Files

- `app/frontend/index.html` (x-cloak CSS rules, body attribute)
- `app/frontend/main.js` (revealApp, applyInitialTheme, initApp)
- `crates/mt-tauri/tauri.conf.json` (visible: false)
- `crates/mt-tauri/capabilities/default.json` (core:window:allow-show)

## Investigation Areas

- Check if CSS bundle loading order has changed (Vite bundling, styles.css import)
- Verify `x-cloak` CSS rule is present in compiled output and loads before body renders
- Check if `visible: false` is still respected by Tauri on current version
- Look for race conditions between CSS loading and initial paint
- Check if any recent commits altered the initialization sequence in main.js
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 No unstyled content is visible at any point during app startup (verified via E2E test)
- [ ] #2 body[x-cloak] CSS rule loads and applies before any content is painted
- [ ] #3 x-cloak attribute is only removed after Alpine.start() completes
- [ ] #4 Theme classes are pre-applied to <html> before content becomes visible
- [ ] #5 E2E regression tests pass and prevent future FOUC regressions
<!-- AC:END -->
