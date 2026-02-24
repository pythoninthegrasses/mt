---
id: TASK-287
title: Fix drag ghost offset in Now Playing queue — item renders below cursor
status: In Progress
assignee: []
created_date: '2026-02-24 20:13'
updated_date: '2026-02-24 20:14'
labels:
  - bug
  - frontend
  - drag-and-drop
dependencies: []
references:
  - app/frontend/js/components/now-playing-view.js
  - app/frontend/views/now-playing.html
  - app/frontend/styles.css
  - app/frontend/js/mixins/playlist-drag.js
  - app/frontend/js/stores/queue.js
  - app/frontend/tests/drag-and-drop.spec.js
priority: medium
ordinal: 4500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Bug

When dragging a track in the "Up Next" queue (Now Playing view), the dragged item (ghost) renders significantly below the cursor position instead of inline with it. There is a large visual gap between where the cursor is and where the dragged item appears.

## Root Cause Analysis (in progress)

The drag transform is computed in `getDragTransform()` which calculates `offsetY = dragY - itemMidY`. The `itemMidY` is derived from:

```js
const itemViewportTop = containerRect.top + displayIdx * this._rowHeight - container.scrollTop;
const itemMidY = itemViewportTop + this._rowHeight / 2;
```

The math appears correct for computing the item's logical viewport position. However, the transform is applied as an inline style on the `.queue-item` element (the inner div), which is nested inside:
1. `.queue-item-wrapper` — has CSS `transition: transform 0.15s ease-out`
2. A virtual scroll offset div with `transform: translateY(${queueOffsetY}px)`
3. A spacer div with `height: queueTotalHeight; position: relative`
4. The scrollable container `queueList`

Likely suspects:
- The `queueOffsetY` parent transform may be double-counted — the item's DOM position already incorporates it, but `getDragTransform` computes position from scratch using `displayIdx * _rowHeight`
- Possible interaction between the virtual scroll offset transform and the drag transform when they're on nested elements
- The `startDrag` sets `dragStartY = rect.top` (line 96) but this value is never used in `getDragTransform` — unlike the playlist-drag mixin which uses `dragStartY` as anchor

## Key Files and Symbols

| File | Symbol | Purpose |
|------|--------|---------|
| `app/frontend/js/components/now-playing-view.js:267` | `getDragTransform()` | Computes translateY offset for dragged item |
| `app/frontend/js/components/now-playing-view.js:88` | `startDrag()` | Initiates drag, sets dragY/dragStartY |
| `app/frontend/js/components/now-playing-view.js:138` | `updateDropTarget()` | Determines drop target from Y position |
| `app/frontend/views/now-playing.html:52` | virtual scroll offset div | Parent transform: `translateY(queueOffsetY)` |
| `app/frontend/views/now-playing.html:68` | `.queue-item` inline style | Where `getDragTransform()` is applied |
| `app/frontend/styles.css:118-144` | `.queue-item-wrapper` CSS | Shift transforms and transitions |
| `app/frontend/js/mixins/playlist-drag.js` | `getTrackDragTransform()` | Reference: simpler working implementation using `dragStartY` |
| `app/frontend/js/stores/queue.js:792` | `playOrderItems` getter | Maps display indices to original indices |

## Comparison with Working Playlist Drag

The playlist-drag mixin uses a simpler approach that works correctly:
```js
getTrackDragTransform(index) {
  const offsetY = this.dragY - this.dragStartY;
  return `translateY(${offsetY}px)`;
}
```

Here `dragStartY` is set to `rect.top + rect.height / 2` (the item's midpoint at drag start). The offset is simply how far the mouse moved from the initial grab point. This approach is immune to virtual scroll issues because it's purely relative.

## Screenshot

`~/Desktop/Screenshot 2026-02-24 at 2.05.56 PM (3).png`
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Dragged queue item tracks inline with cursor position (no visible gap between cursor and ghost element)
- [ ] #2 Drag positioning works correctly regardless of scroll position in the queue
- [ ] #3 Drag positioning works correctly with virtual scrolling (large queues)
- [ ] #4 Existing E2E tests pass: npx playwright test app/frontend/tests/drag-and-drop.spec.js
<!-- AC:END -->
