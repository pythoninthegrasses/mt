---
id: task-151
title: Add scrolling to context menu submenus when they exceed vertical viewport
status: In Progress
assignee: []
created_date: '2026-01-16 21:01'
updated_date: '2026-02-03 05:43'
labels:
  - frontend
  - ux
  - context-menu
dependencies: []
priority: low
ordinal: 34000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
When a context menu submenu (e.g., "Add to Playlist") contains many items, it can extend beyond the vertical viewport bounds. The submenu should:

1. Detect when its height would exceed the available viewport space
2. Constrain the submenu height to fit within the viewport
3. Add vertical scrolling (overflow-y: auto) to allow access to all items
4. Optionally show scroll indicators (fade gradients or scroll shadows) at top/bottom when scrollable

This applies to:
- The "Add to Playlist" submenu in the track context menu
- Any future submenus that may have dynamic/variable content
<!-- SECTION:DESCRIPTION:END -->
