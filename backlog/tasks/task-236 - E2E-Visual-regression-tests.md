---
id: task-236
title: 'E2E: Visual regression tests'
status: Done
assignee: []
created_date: '2026-01-28 05:40'
updated_date: '2026-01-29 22:54'
labels:
  - e2e
  - visual-regression
  - P3
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add Playwright visual regression tests using toHaveScreenshot() to prevent style regressions.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Player controls screenshot baseline in various states
- [x] #2 Library view modes (list/grid/compact) baselines
- [x] #3 Settings panels baselines
- [x] #4 Theme presets (light/dark/custom) baselines
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Implementation Summary

Created visual regression test suite using Playwright's `toHaveScreenshot()` for the mt music player application.

### Tests Created (38 total)

**Player Controls (7 tests)**
- Default state, track loaded, shuffle enabled, loop-all, loop-one, muted, all toggles active

**Library View Modes (5 tests)**
- List view, grid view, compact view, list with selection, grid with selection

**Settings Panels (8 tests)**
- General, appearance, library, shortcuts, sorting, advanced, lastfm panels, and full settings view

**Theme Presets (10 tests)**
- Light and metro-teal themes applied to: full page, player controls, sidebar, library content, settings appearance panel

**Sidebar States (4 tests)**
- Expanded, search focused, section selected, playlist list

**Queue/Now Playing/Context Menu (4 tests)**
- Queue empty, queue with tracks, now playing view, track context menu

### Configuration
- 2% pixel difference threshold for rendering variations
- 0.3 color threshold for anti-aliasing tolerance
- Screenshots stored in tests/visual-regression.spec.js-snapshots/
- Added *-snapshots/ to .gitignore
<!-- SECTION:PLAN:END -->
