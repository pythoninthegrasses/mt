---
id: task-153
title: Integrate Alpine.js Sort plugin to replace custom drag-and-drop implementation
status: In Progress
assignee: []
created_date: '2026-01-16 22:19'
updated_date: '2026-02-03 07:02'
labels:
  - frontend
  - alpine.js
  - refactor
  - tech-debt
dependencies: []
priority: high
ordinal: 1531.25
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Overview

Replace the bespoke drag-and-drop reordering implementation in `now-playing-view.js` (~195 lines) with Alpine.js's official Sort plugin (`@alpinejs/sort`).

## Current State

The `js/components/now-playing-view.js` file contains a complete custom drag-and-drop implementation:

```javascript
export function createNowPlayingView(Alpine) {
  Alpine.data('nowPlayingView', () => ({
    dragging: null,
    dragOverIdx: null,
    scrollInterval: null,
    dragY: 0,
    dragStartY: 0,
    dragItemHeight: 0,
    
    startDrag(idx, event) {
      event.preventDefault();
      const target = event.currentTarget.closest('.queue-item');
      if (!target) return;
      
      const rect = target.getBoundingClientRect();
      this.dragItemHeight = rect.height;
      this.dragStartY = rect.top;
      this.dragY = event.clientY || event.touches?.[0]?.clientY || rect.top;
      
      this.dragging = idx;
      this.dragOverIdx = null;
      
      const container = this.$refs.sortableContainer?.parentElement;
      
      const onMove = (e) => {
        const y = e.clientY || e.touches?.[0]?.clientY;
        if (y === undefined) return;
        this.dragY = y;
        this.handleAutoScroll(y, container);
        this.updateDropTarget(y);
      };
      
      const onEnd = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onEnd);
        document.removeEventListener('touchmove', onMove);
        document.removeEventListener('touchend', onEnd);
        
        this.stopAutoScroll();
        
        if (this.dragging !== null && this.dragOverIdx !== null && 
            this.dragging !== this.dragOverIdx) {
          this.reorder(this.dragging, this.dragOverIdx);
        }
        
        this.dragging = null;
        this.dragOverIdx = null;
      };
      
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onEnd);
      document.addEventListener('touchmove', onMove, { passive: true });
      document.addEventListener('touchend', onEnd);
    },
    
    updateDropTarget(y) { /* ~30 lines */ },
    handleAutoScroll(y, container) { /* ~20 lines */ },
    startAutoScroll(container, speed, y) { /* ~10 lines */ },
    stopAutoScroll() { /* ~6 lines */ },
    reorder(fromIdx, toIdx) { /* ~30 lines */ },
    isDragging(idx) { /* ... */ },
    isOtherDragging(idx) { /* ... */ },
    getShiftDirection(idx) { /* ~20 lines */ },
    getDragTransform() { /* ~15 lines */ },
  }));
}
```

### Current HTML (`index.html:762-800`)
```html
<div x-show="$store.queue.items.length > 0" x-ref="sortableContainer" class="relative">
  <template x-for="(track, index) in $store.queue.items" :key="track.id">
    <div 
      class="queue-item-wrapper"
      :class="{
        'opacity-50': isDragging(index),
        'transition-transform duration-150': isOtherDragging(index),
      }"
      :style="isDragging(index) ? `transform: ${getDragTransform()}; z-index: 50;` : 
              getShiftDirection(index) === 'up' ? 'transform: translateY(-100%)' :
              getShiftDirection(index) === 'down' ? 'transform: translateY(100%)' : ''"
    >
      <div 
        class="queue-item"
        @mousedown="startDrag(index, $event)"
        @touchstart="startDrag(index, $event)"
      >
        <!-- Track content -->
      </div>
    </div>
  </template>
</div>
```

## Proposed Solution

### Installation
```bash
npm install @alpinejs/sort
```

### Registration (`main.js`)
```javascript
import Alpine from 'alpinejs';
import sort from '@alpinejs/sort';

Alpine.plugin(sort);
Alpine.start();
```

### Refactored HTML
```html
<div 
  x-show="$store.queue.items.length > 0" 
  x-sort="handleReorder"
  x-sort:config="{ animation: 150 }"
  class="relative"
>
  <template x-for="(track, index) in $store.queue.items" :key="track.id">
    <div x-sort:item="track.id" class="queue-item">
      <div class="queue-item-handle" x-sort:handle>
        <svg><!-- drag handle icon --></svg>
      </div>
      <!-- Track content -->
    </div>
  </template>
</div>
```

### Refactored Component
```javascript
export function createNowPlayingView(Alpine) {
  Alpine.data('nowPlayingView', () => ({
    handleReorder(item, position) {
      const queue = Alpine.store('queue');
      const fromIdx = queue.items.findIndex(t => t.id === item);
      const toIdx = position;
      
      if (fromIdx === -1 || fromIdx === toIdx) return;
      
      const items = [...queue.items];
      const [moved] = items.splice(fromIdx, 1);
      items.splice(toIdx, 0, moved);
      
      // Update current index if needed
      let newCurrentIndex = queue.currentIndex;
      if (fromIdx === queue.currentIndex) {
        newCurrentIndex = toIdx;
      } else if (fromIdx < queue.currentIndex && toIdx >= queue.currentIndex) {
        newCurrentIndex--;
      } else if (fromIdx > queue.currentIndex && toIdx <= queue.currentIndex) {
        newCurrentIndex++;
      }
      
      queue.items = items;
      queue.currentIndex = newCurrentIndex;
      queue.save();
    },
  }));
}
```

## Projected Value

| Metric | Before | After |
|--------|--------|-------|
| Lines of JS | ~195 | ~30 |
| Event listeners | 4 manual (mouse/touch) | 0 (handled by plugin) |
| State variables | 6 | 0 |
| Touch support | Manual implementation | Built-in |
| Auto-scroll | Manual implementation | Built-in |
| Animation | Manual transforms | CSS-based |

## Additional Benefits

- **Accessibility**: Plugin handles keyboard navigation
- **Mobile**: Built-in touch support with proper gesture handling
- **Animation**: Smooth SortableJS-powered animations
- **Handle support**: Easy `x-sort:handle` for drag handles
- **Groups**: Can drag between different lists (future: playlist management)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Install and register @alpinejs/sort plugin
- [x] #2 Replace custom drag-and-drop code with x-sort directive
- [x] #3 Implement handleReorder callback for queue reordering
- [x] #4 Maintain current index tracking during reorder
- [x] #5 Remove all bespoke drag state variables and methods
- [x] #6 Verify touch/mobile drag-and-drop works correctly
- [x] #7 All queue reorder Playwright tests pass
- [x] #8 Visual drag feedback matches or improves current UX

- [ ] #9 #9 Phase 2: Migrate playlist track reordering (views/playlist.html) to x-sort
- [ ] #10 #10 Phase 3: Migrate sidebar playlist reordering (views/sidebar.html) to x-sort
- [ ] #11 #11 Phase 4: Migrate library column header reordering (components/library-table.html) to x-sort
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Phase 1 Complete: Queue Reordering (2026-02-03)

### Changes Made
- Replaced ~195 lines of custom drag-drop code with Alpine.js Sort plugin (~15 lines)
- Added `forceFallback: true` config to bypass Tauri's native drag-drop interception
- Fixed race condition in `queue.reorder()` - added `_updating` guard to prevent backend events from overwriting local state
- Added `typeof item !== 'undefined'` guards in now-playing.html to handle SortableJS clone elements (fallback mode clones are outside x-for scope)
- Added optional chaining `Alpine.store('player')?.stop()` to fix startup race condition

### Technical Notes
- SortableJS `forceFallback: true` creates DOM clones outside Alpine's x-for scope
- Clone elements trigger `x-init` but have no access to loop variables
- Solution: Store item data in `$el._itemData` during init, fall back to it in bindings

### Tests Passing
- 223 Vitest unit tests
- 5 queue E2E tests
- 18 drag-and-drop E2E tests

## Phase 2-4 Migration Pattern

Remaining views to migrate:
| Phase | Component | View/File | Drag Behavior |
|-------|-----------|-----------|---------------|
| 2 | Playlist Tracks | views/playlist.html | Reorder tracks within a playlist |
| 3 | Sidebar Playlists | views/sidebar.html | Reorder playlists in sidebar |
| 4 | Column Headers | components/library-table.html | Reorder table columns |

Each follows the same pattern established in Phase 1:
- Add `x-sort` directive with handler callback
- Add `x-sort:item` to draggable elements
- Use `forceFallback: true` for Tauri compatibility
- Guard against clone scope issues with `typeof` checks
<!-- SECTION:NOTES:END -->
