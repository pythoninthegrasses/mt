---
id: TASK-258
title: Style toasts to match theme accent colors
status: Done
assignee: []
created_date: '2026-02-06 07:53'
updated_date: '2026-02-07 00:54'
labels:
  - ui
  - theming
  - polish
dependencies: []
priority: low
ordinal: 2000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Toast notifications currently use a generic green background regardless of the active theme. They should use the theme's accent color instead:

- **Dark theme**: Toasts should use metro teal (the same teal used for the selected/playing row highlight)
- **Light theme**: Toasts should use the red/pink accent color (matching the selected row highlight)

Currently the "Playing 1 track next" toast appears as a bright green pill in both themes, which clashes with the rest of the UI. The toast background color should be derived from the theme's primary accent color so it feels cohesive.

See screenshots attached to the originating conversation showing the mismatch in both dark and light modes.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Toast background color uses metro teal in dark theme
- [x] #2 Toast background color uses red/pink accent in light theme
- [x] #3 Toast text remains readable (sufficient contrast) in both themes
- [x] #4 Toast color is derived from theme variables, not hardcoded per-theme
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Changes

### `app/frontend/styles.css`
- Added `--mt-toast-bg` and `--mt-toast-fg` CSS variables to `:root` (itunes-red / white) and `[data-theme-preset='metro-teal']` (teal / white)
- Added `.toast-accent` utility class that derives background/text color from those variables

### `app/frontend/views/modals.html`
- Changed success toast from hardcoded `bg-green-500 text-white` to `toast-accent` class

### `app/frontend/tests/error-states.spec.js`
- Added 3 Playwright tests verifying toast accent class usage, theme-dependent variable values, and text contrast

## Test Results
- 35/35 error-states E2E tests pass (including 3 new)
- 230/230 Vitest unit tests pass
<!-- SECTION:FINAL_SUMMARY:END -->
