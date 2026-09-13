---
id: TASK-358
title: Implement context menu and playlist submenu improvements
status: To Do
assignee: []
created_date: '2026-01-14 20:59'
labels:
  - frontend
  - ui
  - context-menu
  - playlist
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Re-implement context menu changes on top of the restored `index.html` (aa1132d) with the following requirements:

**Context Menu Styling:**
- Solid white opaque background (`#ffffff`)
- Darker grey hover highlight for all items (no red hover)
- Reserve iTunes red only for selected track rows
- NO danger-zone styling (remove `.danger:hover` special treatment)
- All menu items use same neutral grey hover

**Submenu ("Add to Playlist") Requirements:**
1. **Alignment**: Match alignment of other menu items (label + chevron flush right)
2. **Reliable hover**: Fix "stuck cursor" and flaky submenu open
   - Use `pointerenter/pointerleave` with small close delay (150ms)
   - Apply handlers to wrapper containing both parent item and submenu panel
3. **Viewport-aware positioning**:
   - Flip submenu to left side when insufficient space on right
   - Clamp vertically to stay within viewport bounds
   - Measure actual rendered submenu size via `$nextTick`
4. **Submenu content**:
   - "Create Playlist..." option at top with + icon
   - Separator line
   - List of existing playlists

**Main Context Menu Viewport Awareness:**
- Clamp menu position so all items stay visible
- Estimate menu height (~320px) and adjust y position if near bottom edge

**Files to modify:**
- `app/frontend/index.html` (CSS + HTML structure)
- `app/frontend/js/components/library-browser.js` (submenu state + positioning logic)

**Acceptance Criteria:**
- [ ] Context menu has solid white background
- [ ] All hover states use neutral grey (not red)
- [ ] "Add to Playlist" submenu opens reliably on hover
- [ ] Submenu flips to left when near right edge of viewport
- [ ] Submenu stays within vertical viewport bounds
- [ ] "Create Playlist..." option creates playlist and adds selected tracks
- [ ] No visual "danger zone" styling on any menu items
- [ ] Layout regression avoided (footer stays locked, library rows visible)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Context menu has solid white background
- [ ] #2 All hover states use neutral grey (not red)
- [ ] #3 Add to Playlist submenu opens reliably on hover
- [ ] #4 Submenu flips to left when near right edge of viewport
- [ ] #5 Submenu stays within vertical viewport bounds
- [ ] #6 Create Playlist option creates playlist and adds selected tracks
- [ ] #7 No visual danger zone styling on any menu items
- [ ] #8 Layout regression avoided (footer stays locked, library rows visible)
<!-- AC:END -->
