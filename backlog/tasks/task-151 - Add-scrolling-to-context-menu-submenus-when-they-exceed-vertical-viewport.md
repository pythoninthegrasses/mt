---
id: task-151
title: Add scrolling to context menu submenus when they exceed vertical viewport
status: Done
assignee: []
created_date: '2026-01-16 21:01'
updated_date: '2026-02-06 04:11'
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

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Submenu constrains height to fit within vertical viewport bounds
- [ ] #2 Vertical scrolling enabled when playlist count exceeds available space
- [ ] #3 All playlist items accessible via scrolling
- [ ] #4 Thin scrollbar styling consistent with app design
- [ ] #5 No regression when submenu has ample space (no unnecessary scroll)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementation\n\n### Changes\n1. **`app/frontend/views/library.html`** (line 303): Added dynamic `max-height: ${window.innerHeight - submenuY - 10}px` and `overflow-y: auto` to the playlist submenu's inline `:style` binding.\n2. **`app/frontend/styles.css`**: Added thin scrollbar styling for `.context-menu` (Firefox `scrollbar-width: thin` + WebKit `::-webkit-scrollbar` rules).\n\n### Verification\n- Tested via Tauri MCP with 9 playlists\n- Near viewport bottom: submenu constrained with scrollbar, all items accessible\n- Higher on viewport: full submenu shown without scrolling\n- 230 Vitest tests pass, 171/172 Playwright tests pass (1 pre-existing failure)\n\n### Commit\n`1a54200` fix(ui): add scrolling to playlist submenu when it exceeds viewport (task-151)
<!-- SECTION:NOTES:END -->
