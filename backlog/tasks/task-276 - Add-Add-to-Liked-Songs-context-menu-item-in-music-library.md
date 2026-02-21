---
id: TASK-276
title: Add "Add to Liked Songs" context menu item in music library
status: Done
assignee: []
created_date: '2026-02-18 05:58'
updated_date: '2026-02-20 23:58'
labels:
  - frontend
  - ux
  - context-menu
dependencies: []
priority: medium
ordinal: 2000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add a context menu option to like/unlike tracks directly from the music library views. When a user right-clicks a track in any library view (tracks list, album view, artist view, now playing queue), the context menu should include an "Add to Liked Songs" / "Remove from Liked Songs" toggle option.

This is similar to TASK-275 which added "Add to Playlist" context menu items to Artist and Album browsing views.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Context menu shows 'Add to Liked Songs' for unliked tracks and 'Remove from Liked Songs' for liked tracks
- [x] #2 Liking/unliking a track from the context menu updates the UI state immediately (heart icon, etc.)
- [x] #3 Works in all library views where track context menus appear (tracks list, album view, artist view, queue)
- [x] #4 Backend correctly persists the liked status
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added "Add to Liked Songs" / "Remove from Liked Songs" context menu item to all three browser views:

- **library-browser.js**: Added `toggleFavoriteFromMenu()` method and async favorite status check in `handleContextMenu()`
- **artists-browser.js**: Added `_toggleFavorite()` method and async favorite status check in `handleContextMenu()`
- **albums-browser.js**: Added `_toggleFavorite()` method and async favorite status check in `showTrackContextMenu()`

The menu item checks favorite status asynchronously when the context menu opens, updating the label from "Add to Liked Songs" to "Remove from Liked Songs" for already-liked tracks. On click, it toggles the favorite status via the existing `api.favorites` API and refreshes the liked songs library view.

**Files changed:**
- `app/frontend/js/components/library-browser.js`
- `app/frontend/js/components/artists-browser.js`
- `app/frontend/js/components/albums-browser.js`
- `app/frontend/__tests__/context-menu-favorites.test.js` (new, 11 tests)

No HTML template changes needed — all three views render context menu items dynamically from their `items` array. The backend already had all needed endpoints (`favorites_check`, `favorites_add`, `favorites_remove`) and the `FavoritesUpdatedEvent` is already handled in `events.js` to update the player's heart icon state.
<!-- SECTION:FINAL_SUMMARY:END -->
