---
id: TASK-374
title: Implement Top 25 Most Played playlist
status: Done
assignee: []
created_date: '2025-10-09 05:26'
updated_date: '2025-10-09 05:33'
labels: []
dependencies: []
---

## Description

Create a dynamic 'Top 25 Most Played' playlist that displays the 25 tracks with the highest play counts, using the existing play_count field that is updated by the update_play_count method.

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Top 25 Most Played playlist created and visible in left panel navigation, positioned after Recently Played
- [x] #2 Playlist displays exactly 25 tracks (or fewer if library has less than 25 played tracks)
- [x] #3 Tracks sorted by play_count in descending order (highest play count first)
- [x] #4 Playlist view matches library > music view styling, showing tracks with standard columns (artist, title, album, track#, year)
- [x] #5 Playlist automatically updates when play counts change (via existing update_play_count mechanism)
- [x] #6 Playlist only shows tracks that have been played at least once (play_count > 0)
- [x] #7 Playlist state persists across application restarts
- [x] #8 Clicking on tracks in the playlist adds them to queue and plays as expected
- [x] #9 All playlist interactions logged with Eliot using appropriate trigger sources
<!-- AC:END -->
