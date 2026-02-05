---
id: task-256
title: Fix intermittent sidebar styling on reload
status: In Progress
assignee: []
created_date: '2026-02-05 15:20'
updated_date: '2026-02-05 15:21'
labels:
  - bug
  - frontend
  - theming
  - race-condition
dependencies: []
priority: medium
ordinal: 15750
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Bug:** On intermittent page reloads, the sidebar displays with incorrect styling that doesn't match the selected theme.

**Expected behavior:** Sidebar should always display with the correct theme styling (light or metro-teal) on every page load, respecting the user's saved preference.

**Actual behavior:** Sometimes on reload, the sidebar shows colors from the wrong theme. For example, when metro-teal is selected, the sidebar may show the lighter grey from the light theme instead of the correct dark background.

**Likely cause:** Race condition in theme application - the `applyThemePreset()` method in `ui.js` may be executing before the DOM is fully ready, or the theme preset data attribute isn't being applied in time for the initial CSS paint. The persisted theme preference may not be loaded before the first render.

**Files to investigate:**
- `js/stores/ui.js` - `applyThemePreset()` and `init()` methods, theme loading from settings
- `css/themes/metro-teal.css` - sidebar-specific styles
- `index.html` - initial theme class application

**Reproduction:**
1. Set theme to metro-teal (or light)
2. Reload page multiple times (Cmd+R)
3. Observe sidebar occasionally showing incorrect theme colors
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Sidebar always displays correct styling matching the selected theme on every page load
- [ ] #2 No flash of incorrect styling during page initialization
- [ ] #3 Theme application is deterministic regardless of load timing

- [ ] #4 Works correctly for both light and metro-teal themes
<!-- AC:END -->
