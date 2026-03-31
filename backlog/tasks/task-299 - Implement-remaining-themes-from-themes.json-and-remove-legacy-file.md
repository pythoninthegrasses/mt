---
id: TASK-299
title: Implement remaining themes from themes.json and remove legacy file
status: To Do
assignee: []
created_date: '2026-03-19 03:56'
updated_date: '2026-03-31 03:38'
labels:
  - frontend
  - themes
  - cleanup
dependencies: []
references:
  - themes.json
  - app/frontend/styles.css
  - docs/theming.md
documentation:
  - docs/theming.md
priority: low
ordinal: 48500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`themes.json` is a legacy file from the tkinter-era backend containing theme definitions that were never ported to the Tauri/Tailwind CSS frontend. Three themes are defined but not implemented as CSS presets:

- **midnight** — dark theme with blue primary (#0a21f5)
- **nightout** — dark theme with blue primary (#164fe2)
- **spotify** — dark theme with green primary (#1DB954)

`metro-teal` is already implemented in `styles.css`. After porting the remaining three, delete `themes.json`.

Each new theme needs:
1. CSS custom properties under `[data-theme-preset='<name>']` in `styles.css`
2. Toggle overrides for `bg-primary`/`bg-muted` (see `docs/theming.md`)
3. Entry in the theme picker UI
4. Visual regression test snapshots
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 midnight, nightout, and spotify themes implemented as CSS presets in styles.css
- [ ] #2 Each theme has dark-mode toggle overrides for bg-primary/bg-muted (per docs/theming.md)
- [ ] #3 Each theme selectable from the Appearance settings theme picker
- [ ] #4 Visual regression snapshots added for each new theme
- [ ] #5 themes.json deleted from repo root
<!-- AC:END -->
