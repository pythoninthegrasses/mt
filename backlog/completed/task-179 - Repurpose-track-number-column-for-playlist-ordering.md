---
id: task-179
title: Repurpose track number column for playlist ordering
status: Done
assignee: []
created_date: '2026-01-20 09:30'
updated_date: '2026-02-02 05:43'
labels:
  - enhancement
  - frontend
  - playlists
  - ux
dependencies: []
priority: medium
ordinal: 9281.25
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Feature Request

The track number column (#) currently shows the track number from album metadata. In playlist view, this column should instead show the track's position within the playlist (1, 2, 3, etc.) to reflect the user-defined ordering.

### Current Behavior
- Track number column shows album track number (e.g., track 5 of an album shows "5")
- This is confusing in playlist context where order is user-defined

### Expected Behavior
- In **library view** (All, Artists, Albums): Show album track number from metadata
- In **playlist view**: Show playlist position (1-indexed sequential order)

### Implementation Notes
- The `library-browser.js` component needs to detect when viewing a playlist vs. library
- Column renderer for track number should check context and display appropriate value
- Playlist position should update after drag-reorder operations

### Related
- Playlist drag-reorder already exists (task-150)
- This enhances the UX by making playlist order visible
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Track number column shows album metadata track number in library view
- [x] #2 Track number column shows sequential position (1, 2, 3...) in playlist view
- [x] #3 Position numbers update correctly after drag-reorder in playlist
- [x] #4 Column header tooltip/label reflects context ("#" vs "Position")

- [x] #5 Verify all existing tests pass
- [x] #6 Write new tests to cover the functionality
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
- The `library-browser.js` component needs to detect when viewing a playlist vs. library
- Column renderer for track number should check context and display appropriate value
- Playlist position should update after drag-reorder operations

### Related
- Playlist drag-reorder already exists (task-150)
- This enhances the UX by making playlist order visible
<!-- SECTION:DESCRIPTION:END -->

## Implementation Progress (2026-01-20)

### Completed: Drag-and-Drop Visual Feedback for Playlist Tracks

Implemented smooth drag-and-drop reorder animation for tracks within playlist views, matching the sidebar playlist reorder behavior:

**State Variables Added** (`library-browser.js` ~line 47-50):
- `dragY: 0` - current cursor Y position during drag
- `dragStartY: 0` - initial center Y of dragged row

**Helper Functions Added** (`library-browser.js` ~line 1450-1465):
- `isOtherTrackDragging(index)` - returns true if another track is being dragged
- `getTrackDragTransform(index)` - returns `translateY(offset)` for dragged track to follow cursor

**HTML Track Row Styling** (`index.html` ~line 621-631):
- Dragged track: `bg-card shadow-lg z-10 relative` (highlighted with shadow)
- Other tracks: `opacity-50` (dimmed)
- Inline transform style for dragged track to follow cursor with `transition: none`

**CSS Transition** (`styles.css`):
```css
[data-track-id] {
  transition: transform 0.15s ease-out;
}
```

**Pattern Matches Sidebar Playlist Reorder:**
1. On drag start: capture `startY` = element center, set `dragY` = cursor position
2. On move: update `dragY`, calculate drop target index
3. Transform calculation: `offsetY = dragY - dragStartY` (simple delta)
4. Dragged item: highlighted + follows cursor (inline transform)
5. Other items: dimmed + shift with CSS transition

### Bug Identified: Incorrect Default Sort Column

**Issue:** When opening a playlist view, the Title column is being activated as the sort column. 

**Expected:** Playlist tracks should be sorted by timestamp order (the order they were added/arranged) until the user manually rearranges tracks via drag-and-drop. The track position column should reflect this ordering.

**To Investigate:**
- Check what triggers column sort activation when switching to playlist view
- Playlist tracks should maintain their stored order, not default to title sort
- May need to disable auto-sort or use a "custom order" sort mode for playlists

## Implementation Complete (2026-02-01)

### Changes Made

**1. New `drag` column added** (`library-browser.js`):
- Added to `DEFAULT_COLUMN_WIDTHS` (28px width)
- Added to `DEFAULT_COLUMN_VISIBILITY` (true)
- Added to `DEFAULT_COLUMN_ORDER` (between status and index)
- Added to `baseColumns` with `playlistOnly: true` flag
- Modified `columns` and `allColumns` getters to only include drag column when `isInPlaylistView()` returns true

**2. Updated `index` column rendering** (`library.html`):
- Library view: Shows `track.track_number` (album metadata) or empty string
- Playlist view: Shows `index + 1` (sequential position 1, 2, 3...)

**3. Drag handle moved to separate column** (`library.html`):
- New template for `col.key === 'drag'` renders the ⠿ drag handle
- Removed drag handle from inside the `index` column template

**4. Position numbers update after drag-reorder**:
- The existing `finishPlaylistDrag()` function already handles this by fetching the reordered playlist and updating `library.tracks`
- Since the `index` value comes from Alpine's `x-for` loop, positions update automatically when the array is re-rendered

### Files Modified
- `app/frontend/js/components/library-browser.js` (column definitions and getters)
- `app/frontend/views/library.html` (column rendering templates)

### Tests Passing
- All 223 Vitest unit tests pass
- All 11 playlist-related Playwright E2E tests pass
- All 51 drag/playlist tests pass

## Debug Session (2026-02-01)

### Issue Investigated: Drag reorder appeared not to persist

**Root Cause:** The drag logic was working correctly. When dragging from index 0 with `dragOverIndex = 1`, the adjusted `toPosition` equals 0 (same as start), so no reorder is needed. This is correct behavior - dropping item 0 "before item 1" means keeping it at position 0.

**Key Insight:** To actually move an item, the user needs to drag past the next item's midpoint. For example:
- Drag item 0 past item 1's midpoint → `dragOverIndex = 2` → `toPosition = 1` → Item moves to position 1

### Improvements Made

1. **Added visual drop indicator** (`styles.css`):
   - `.playlist-drop-indicator-above::before` - primary colored line above the target row
   - `.playlist-drop-indicator-below::after` - primary colored line at end of list
   - Indicator only shows when an actual reorder would happen

2. **Updated `getDragOverClass` function** (`library-browser.js`):
   - Calculates `wouldReorder` flag to only show indicator when drop position differs from current
   - Returns `playlist-drop-indicator-above` or `playlist-drop-indicator-below` classes

3. **Cleaned up debug logs**:
   - Removed 11 `console.log` statements that were added for debugging
   - Kept only the error log for failed reorder operations

### Test Results
- All 223 Vitest unit tests pass
- All 18 drag-and-drop E2E tests pass

Updated library header to show "Position" label/tooltip in playlist view and added Playwright coverage for header/position updates after reorder.

Tests: npx playwright test tests/library.spec.js
<!-- SECTION:NOTES:END -->
