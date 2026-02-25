---
id: TASK-289
title: Add "Go to Artist" context menu item to track context menus
status: Done
assignee: []
created_date: '2026-02-25 22:04'
updated_date: '2026-02-25 22:39'
labels:
  - frontend
  - ux
  - context-menu
dependencies: []
references:
  - app/frontend/js/mixins/context-menu-actions.js
  - app/frontend/js/components/artists-browser.js
  - app/frontend/js/stores/ui.js
  - TASK-288
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add a "Go to Artist" item to the track right-click context menu in track-list based views. Clicking it should navigate to the Artists view and drill down into the track's artist.

**Scope**: Music (library), Liked Songs, Recently Played, Recently Added, Top 25, and Playlist detail views — all views using `context-menu-actions.js` mixin.

**Out of scope**: Artists browser and Albums browser views (use `single-track-context-menu.js` mixin — can be added in a follow-up task).

**User story**: Right-click "Sia - Chandelier" > "Go to Artist" > navigates to Artists view showing Sia's artist detail.

**Menu placement**: Before "Go to Album", after "Add to Liked Songs".

## Implementation Pattern

Follow the existing `mt:navigate-to-album` pattern from TASK-288:

1. **Add menu item** in `context-menu-actions.js` before "Go to Album"
2. **Add `goToArtist(track)` method** that dispatches `mt:navigate-to-artist` event
3. **Listen in artists-browser.js**: Add event listener for `mt:navigate-to-artist` in `init()`, find the matching artist, and open artist detail

### Existing precedent
`albums-browser.js` already has `navigateToArtist()` (line 199) which dispatches `mt:navigate-to-artist` — artists-browser may already listen for this event.

### Menu item should be disabled when:
- Multiple tracks are selected (`selectedCount > 1`)
- Track has no artist metadata (`!track.artist && !track.album_artist`)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Right-clicking a track in the Music (library) view shows 'Go to Artist' before 'Go to Album'
- [x] #2 Clicking 'Go to Artist' switches to Artists view and opens the correct artist detail
- [x] #3 Right-clicking a track in Liked Songs view shows 'Go to Artist' with same behavior
- [x] #4 Right-clicking a track in Recently Played view shows 'Go to Artist' with same behavior
- [x] #5 Right-clicking a track in Recently Added view shows 'Go to Artist' with same behavior
- [x] #6 Right-clicking a track in Top 25 view shows 'Go to Artist' with same behavior
- [x] #7 Right-clicking a track in a Playlist detail view shows 'Go to Artist' with same behavior
- [x] #8 'Go to Artist' is disabled when multiple tracks are selected
- [x] #9 'Go to Artist' is disabled or hidden when the track has no artist metadata
- [x] #10 Context menu closes after clicking 'Go to Artist'
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Summary

Added "Go to Artist" context menu item to track context menus in all views using `context-menu-actions.js` mixin.

## Changes

### `app/frontend/js/mixins/context-menu-actions.js`
- Added "Go to Artist" menu item positioned before "Go to Album"
- Added `goToArtist(track)` method that dispatches `mt:navigate-to-artist` event
- Menu item disabled when multiple tracks selected or track has no artist metadata

### `app/frontend/js/components/artists-browser.js`
- Added event listener for `mt:navigate-to-artist` in `init()`
- Handler performs case-insensitive artist matching, switches to Artists view, and selects the artist
- Shows error toast if artist not found
- Added `destroy()` method for proper event listener cleanup

### `app/frontend/__tests__/go-to-artist.test.js`
- Added 11 unit tests covering:
  - Event dispatch with correct artist name
  - Fallback from album_artist to artist
  - No dispatch when track has no artist metadata
  - Context menu closing behavior
  - Menu item placement before "Go to Album"
  - Disabled state for multi-selection and missing metadata
  - artists-browser view switching and artist selection
  - Case-insensitive matching
  - Event listener cleanup

## Test Results
- All 306 frontend tests pass
- Linting passes

### Additional Fix
- Added scroll-to-top behavior when navigating via "Go to Artist" so the detail panel shows the artist header and first album
<!-- SECTION:FINAL_SUMMARY:END -->
