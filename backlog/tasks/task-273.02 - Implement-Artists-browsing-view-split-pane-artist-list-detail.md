---
id: TASK-273.02
title: 'Implement Artists browsing view (split pane: artist list + detail)'
status: In Progress
assignee: []
created_date: '2026-02-16 21:13'
updated_date: '2026-02-17 01:31'
labels:
  - feature
  - ux
dependencies:
  - TASK-273.01
parent_task_id: TASK-273
priority: medium
ordinal: 45500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Context

This is part of the Artist/Album browsing feature (TASK-273). The sidebar routing (subtask 1) provides the `artists` view state. This subtask implements the actual Artists view content.

## Target UX (Apple Music reference)

A split-pane layout:

**Left panel** - Scrollable alphabetical artist list:
- "All Artists" header at top
- Each row shows artist name (and optionally a small artwork thumbnail from one of their tracks)
- Selecting an artist highlights it and updates the right panel
- Should support keyboard navigation and scrolling for large libraries

**Right panel** - Selected artist detail:
- Artist name as large header
- Summary line: "X ALBUMS, Y SONGS"
- For each album by this artist:
  - Album artwork (from first track in album via `library_get_artwork_url`)
  - Album title and metadata (genre, year)
  - Track listing with track number, title, and duration
  - Summary line: "X SONGS, Y MINUTES"

## Existing Infrastructure

- `library.js` already has `artists` getter (unique sorted artist names, line 972) and `tracksByArtist` getter (groups tracks by artist, line 988)
- `library_get_all(artist?)` backend command can filter tracks by artist
- `library_get_artwork_url(track_id)` returns base64 artwork URL
- Track model has `artist`, `album`, `album_artist`, `track_number`, `disc_number`, `date`, `genre`, `duration` fields

## Performance Considerations

- Artist list may be long; consider virtual scrolling or lazy rendering
- Artwork loading should be lazy (only for visible albums in the detail pane)
- Consider a dedicated backend query for distinct artists with album/track counts rather than deriving everything client-side from all tracks

## Key Files to Create/Modify

- New: `app/frontend/views/artists.html` - Artists view template
- New: `app/frontend/js/components/artists-browser.js` - Artists view component
- Modify: Main layout to include the artists view template
- Possibly: `crates/mt-tauri/src/db/library.rs` and `commands.rs` for optimized artist listing query
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Left panel displays a scrollable list of all artists sorted alphabetically
- [ ] #2 Selecting an artist in the left panel shows their albums and tracks in the right panel
- [ ] #3 Right panel shows artist name header with album and song counts
- [ ] #4 Each album section shows album artwork, title, genre, year, and track listing
- [ ] #5 Tracks within an album show track number, title, and duration
- [ ] #6 Double-clicking or pressing play on a track starts playback
- [ ] #7 Context menu actions work on tracks (add to queue, add to playlist, etc.)
- [ ] #8 View handles empty states (no artists, artist with no albums)
- [ ] #9 Performance is acceptable for libraries with 500+ artists
<!-- AC:END -->
