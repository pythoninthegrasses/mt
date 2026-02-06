---
id: task-256
title: Fix intermittent sidebar styling on reload
status: Done
assignee: []
created_date: '2026-02-05 15:20'
updated_date: '2026-02-06 02:01'
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
- [x] #1 Sidebar always displays correct styling matching the selected theme on every page load
- [x] #2 No flash of incorrect styling during page initialization
- [x] #3 Theme application is deterministic regardless of load timing

- [x] #4 Works correctly for both light and metro-teal themes
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Root Cause

Two issues combined to cause the intermittent flash:

1. **Theme applied too late**: The theme preset was only applied to `<html>` when Alpine's ui store `init()` ran (during `Alpine.start()`). Before that point, `<html>` had no theme classes, so CSS variables resolved to default (light) values. The `data-theme-preset="metro-teal"` attribute - which activates sidebar-specific CSS overrides like `background-color: #1E1E1E` - was absent during initial rendering.

2. **Over-broad CSS transition on sidebar**: The sidebar `<aside>` had `transition-all duration-200`, which animated ALL property changes including `background-color`. When the theme was applied, the sidebar would transition from light-mode colors to metro-teal colors over 200ms, making the flash visible.

## Fix

### 1. Pre-apply theme before Alpine starts (`main.js`)
Added `applyInitialTheme()` function that reads the persisted theme preset from the settings service and applies the correct classes to `<html>` immediately after settings load, BEFORE `Alpine.start()`. This ensures CSS variables are correct from the first paint.

### 2. Narrow sidebar transition (`sidebar.html`)
Changed `transition-all` to `transition-[width]` on the sidebar `<aside>`. The sidebar only needs width transition for collapse/expand animation. This prevents background-color (and other properties) from ever transitioning during theme changes.
<!-- SECTION:NOTES:END -->
