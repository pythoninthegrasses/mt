---
id: task-156
title: Integrate Alpine.js Anchor plugin for context menu and popover positioning
status: Done
assignee: []
created_date: '2026-01-16 22:19'
updated_date: '2026-02-03 05:51'
labels:
  - frontend
  - alpine.js
  - refactor
dependencies: []
priority: low
ordinal: 27500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Overview

Integrate Alpine.js's official Anchor plugin (`@alpinejs/anchor`) to replace manual positioning calculations for context menus, dropdowns, and popovers.

## Current State

Context menus and popovers use manual `position: fixed` with calculated coordinates:

### Playlist Context Menu (`index.html:309-312`)
```html
<div
  x-show="showPlaylistContextMenu"
  @click.away="hidePlaylistContextMenu()"
  @keydown.escape.window="hidePlaylistContextMenu()"
  class="fixed z-50 bg-popover border border-border rounded-md shadow-lg py-1 min-w-[140px]"
  :style="`left: ${contextMenuX}px; top: ${contextMenuY}px;`"
  data-testid="playlist-context-menu"
>
```

### Context Menu Positioning (`sidebar.js` / `library-browser.js`)
```javascript
showPlaylistContextMenu(event, playlist) {
  this.contextMenuPlaylist = playlist;
  this.contextMenuX = event.clientX;
  this.contextMenuY = event.clientY;
  this.showPlaylistContextMenu = true;
  
  // Viewport boundary checking would need to be added manually
}
```

### Issues with Current Approach

1. **No viewport boundary detection** - Menu can render off-screen
2. **No flip behavior** - Doesn't flip when near edges
3. **Manual coordinate tracking** - Must store X/Y in component state
4. **No anchor relationship** - Disconnected from trigger element

## Proposed Solution

### Installation
```bash
npm install @alpinejs/anchor
```

### Registration (`main.js`)
```javascript
import Alpine from 'alpinejs';
import anchor from '@alpinejs/anchor';

Alpine.plugin(anchor);
Alpine.start();
```

### Refactored Context Menu

**Before:**
```html
<div class="playlist-item" @contextmenu.prevent="showContextMenu($event, playlist)">
  {{ playlist.name }}
</div>

<div 
  x-show="contextMenuVisible"
  class="fixed z-50"
  :style="`left: ${contextMenuX}px; top: ${contextMenuY}px;`"
>
  <!-- menu items -->
</div>
```

**After:**
```html
<div 
  class="playlist-item" 
  x-ref="playlistTrigger"
  @contextmenu.prevent="contextMenuVisible = true; contextMenuPlaylist = playlist"
>
  {{ playlist.name }}
</div>

<div 
  x-show="contextMenuVisible"
  x-anchor.bottom-start.offset.5="$refs.playlistTrigger"
  class="z-50 bg-popover border rounded-md shadow-lg"
>
  <!-- menu items -->
</div>
```

### Anchor Positioning Options

```html
<!-- Position below, align start -->
<div x-anchor.bottom-start="$refs.trigger">

<!-- Position above, align end -->
<div x-anchor.top-end="$refs.trigger">

<!-- Position to the right -->
<div x-anchor.right-start="$refs.trigger">

<!-- With offset (gap from trigger) -->
<div x-anchor.bottom-start.offset.8="$refs.trigger">
```

### For Mouse-Position Context Menus

The Anchor plugin is primarily for anchoring to elements. For right-click context menus at mouse position, a hybrid approach:

```html
<div 
  x-data="{ 
    showMenu: false, 
    menuStyle: '' 
  }"
  @contextmenu.prevent="
    showMenu = true;
    menuStyle = `left: ${$event.clientX}px; top: ${$event.clientY}px;`
  "
>
  <div 
    x-show="showMenu" 
    :style="menuStyle"
    class="fixed z-50"
  >
    <!-- Still manual for mouse-position menus -->
  </div>
</div>
```

**OR** use Floating UI (which Anchor is built on) directly for advanced positioning.

## Projected Value

| Metric | Before | After |
|--------|--------|-------|
| Viewport boundary handling | None | Automatic |
| Flip on overflow | None | Built-in |
| Manual X/Y state | Required | Optional |
| Position options | Limited | 12+ positions |

## Best Candidates for Anchor

| Component | Current | Anchor Benefit |
|-----------|---------|---------------|
| Dropdown menus | Manual | High - anchored to button |
| Tooltips | N/A | High - automatic positioning |
| Popovers | basecoat JS | Medium - could simplify |
| Context menus (element) | Manual | Medium - anchored to element |
| Context menus (mouse) | Manual | Low - still needs coordinates |

## Note

This is **lower priority** because:
1. basecoat already provides popover positioning
2. Context menus at mouse position still need manual X/Y
3. Current implementation works adequately
4. Main benefit is for element-anchored popovers
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Install and register @alpinejs/anchor plugin
- [ ] #2 Identify dropdown/popover components that anchor to elements
- [ ] #3 Implement x-anchor on at least one dropdown or tooltip
- [ ] #4 Verify automatic flip behavior when near viewport edges
- [ ] #5 Compare with basecoat positioning and document trade-offs
- [ ] #6 Decide whether to adopt for new components or retrofit existing
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementation Complexity: HARDER

**Effort estimate**: ~1-2 hours

**Key challenges**:
- Mouse-position context menus still need manual X/Y coordinates anyway
- Must compare with basecoat's existing positioning system
- Refactoring manual positioning to x-anchor may not actually reduce code
- Limited value: "Main benefit is for element-anchored popovers" not mouse-position menus

**Concerns**:
- Hybrid approach still needed for right-click context menus
- May not simplify existing implementation
- Acceptance criteria requires trade-off analysis with basecoat

**Simplest path**:
1. Install + register plugin (5 min)
2. Find element-anchored dropdown (not mouse-position menu) (15-20 min)
3. Implement x-anchor on one component (20-30 min)
4. Compare with basecoat and document (20-30 min)

Task closed without implementation. Mouse-position context menus still require manual X/Y coordinates, and basecoat already provides adequate popover positioning. The effort did not justify the limited benefit.
<!-- SECTION:NOTES:END -->
