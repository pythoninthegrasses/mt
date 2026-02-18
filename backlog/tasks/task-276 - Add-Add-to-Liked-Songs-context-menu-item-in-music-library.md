---
id: task-276
title: Add "Add to Liked Songs" context menu item in music library
status: To Do
assignee: []
created_date: '2026-02-18 05:58'
labels:
  - frontend
  - ux
  - context-menu
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add a context menu option to like/unlike tracks directly from the music library views. When a user right-clicks a track in any library view (tracks list, album view, artist view, now playing queue), the context menu should include an "Add to Liked Songs" / "Remove from Liked Songs" toggle option.

This is similar to TASK-275 which added "Add to Playlist" context menu items to Artist and Album browsing views.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Context menu shows 'Add to Liked Songs' for unliked tracks and 'Remove from Liked Songs' for liked tracks
- [ ] #2 Liking/unliking a track from the context menu updates the UI state immediately (heart icon, etc.)
- [ ] #3 Works in all library views where track context menus appear (tracks list, album view, artist view, queue)
- [ ] #4 Backend correctly persists the liked status
<!-- AC:END -->
