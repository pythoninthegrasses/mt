---
id: TASK-304
title: Add context menu to Now Playing track list
status: Done
assignee: []
created_date: '2026-03-31 04:43'
updated_date: '2026-03-31 04:48'
labels:
  - frontend
  - now-playing
  - context-menu
  - UX
dependencies: []
references:
  - app/frontend/js/components/now-playing-view.js
  - app/frontend/js/stores/queue.js
  - app/frontend/views/now-playing.html
priority: medium
ordinal: 750
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add a right-click context menu to tracks in the Now Playing / Up Next queue list. Currently, the only interaction available on queue tracks is the remove (x) button. Users should be able to right-click any track in the Now Playing view to access actions like "Play Next", "Remove from Queue", etc.

Reuse the existing context menu logic from the music library view, including the smart positioning that flips the menu from right-side to left-side of the cursor when the menu would overflow the viewport edge.

**Current state**: The Now Playing view (screenshot attached) shows tracks with drag handles and remove buttons, but no context menu on right-click.

**Desired state**: Right-clicking a track in the Up Next list opens a context menu with queue manipulation actions (Play Next, Remove, etc.), using the same positioning logic as the library view's context menu.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Right-clicking a track in the Now Playing / Up Next list opens a context menu
- [x] #2 Context menu includes queue actions: Play Next, Remove from Queue, and other relevant actions from the library context menu
- [x] #3 Menu positioning flips from right-side to left-side of cursor when it would overflow the viewport (reuse library view logic)
- [x] #4 Play Next action reorders the queue and the Now Playing view updates accordingly
- [x] #5 Context menu dismisses on click outside or after selecting an action
- [x] #6 No regression in existing drag-to-reorder or remove button functionality
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Changes

### `app/frontend/js/components/now-playing-view.js`
- Added `singleTrackContextMenuMixin` spread with context menu state properties
- Added store getter shortcuts (`queue`, `library`, `player`, `ui`) required by the mixin
- Overrode `handleContextMenu()` with queue-specific menu items:
  - **Play Now** — plays track at its queue position
  - **Play Next** — uses `playNextTracks()` move semantics (disabled for current track)
  - **Add to Playlist** — submenu with playlist list
  - **Add to/Remove from Liked Songs** — async favorite status check
  - **Show in Finder** — reveals file in OS file manager
  - **Remove from Queue** — removes track (disabled for current track, styled as danger)
- Added `_ctxPlayInQueue()`, `_ctxPlayNextInQueue()`, `_ctxRemoveFromQueue()` action methods
- Added playlist event listener setup/teardown in `init()`/`destroy()`

### `app/frontend/views/now-playing.html`
- Added `@contextmenu` handler on queue item rows
- Added context menu HTML with dynamic item rendering (reused from artists/albums pattern)
- Added playlist submenu HTML with smart left/right positioning
- Menu items support `disabled` and `danger` CSS classes
<!-- SECTION:NOTES:END -->
