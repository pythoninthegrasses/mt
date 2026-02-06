---
id: task-258
title: Style toasts to match theme accent colors
status: In Progress
assignee: []
created_date: '2026-02-06 07:53'
updated_date: '2026-02-06 07:54'
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
- [ ] #1 Toast background color uses metro teal in dark theme
- [ ] #2 Toast background color uses red/pink accent in light theme
- [ ] #3 Toast text remains readable (sufficient contrast) in both themes
- [ ] #4 Toast color is derived from theme variables, not hardcoded per-theme
<!-- AC:END -->
