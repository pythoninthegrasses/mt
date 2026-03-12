---
id: TASK-297
title: Add active section highlight to settings nav for dark themes
status: Done
assignee: []
created_date: '2026-03-10 05:27'
updated_date: '2026-03-12 06:12'
labels:
  - ui
  - theme
  - settings
dependencies: []
references:
  - app/frontend/css/
  - app/frontend/js/stores/settings.js
  - app/frontend/settings.html
priority: low
ordinal: 7000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The settings view has a middle column with section links (General, Audio, Appearance, Library, etc.). In the Light theme, the currently active section is visually highlighted with a background color, making it clear which section is selected. In both dark themes (Metro Teal and Neon Love), there is no visible highlight on the active section — all items look the same, so users cannot tell which settings section they are viewing.

Add a visible active-state highlight to the settings navigation column for Metro Teal and Neon Love themes, matching the behavior already present in the Light theme.

**Current behavior:** Dark themes show no visual distinction for the active settings section in the middle nav column.
**Expected behavior:** The active settings section has a visible background highlight in all three themes.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Active settings section in Metro Teal theme has a visible background highlight
- [ ] #2 Active settings section in Neon Love theme has a visible background highlight
- [ ] #3 Highlight style is consistent with each theme's color palette (e.g. teal accent for Metro Teal, purple accent for Neon Love)
- [ ] #4 Light theme highlight remains unchanged
<!-- AC:END -->
