---
id: TASK-370
title: Implement favorites/liked songs feature with dynamic playlist
status: Done
assignee: []
created_date: '2025-10-09 04:59'
updated_date: '2025-10-09 05:16'
labels: []
dependencies: []
---

## Description

Add ability to mark tracks as favorites with a heart icon button, store favorites in database, and create a dynamic 'Liked Songs' playlist that displays liked tracks in FIFO order.

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Favorite icon button (favorite_border) added between volume and shuffle controls, aligned and sized to match other utility controls
- [x] #2 Icon toggles between favorite_border (unliked) and favorite (liked) when clicked while a track is playing
- [x] #3 Favorites stored in database with timestamps for each liked track
- [x] #4 'Liked Songs' dynamic playlist created and visible in left panel navigation
- [x] #5 Liking a track automatically adds it to 'Liked Songs' playlist
- [x] #6 Unliking a track automatically removes it from 'Liked Songs' playlist
- [x] #7 Playlist displays tracks in FIFO timestamp order (first liked = first in list, most recent liked = last in list)
- [x] #8 Playlist view matches library > music view styling, showing only liked tracks with standard columns
- [x] #9 Favorites and playlist state persist across application restarts
- [x] #10 All favorite/unfavorite interactions logged with Eliot using appropriate trigger sources
<!-- AC:END -->
