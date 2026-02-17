---
id: TASK-273.03
title: Implement Albums browsing view (grid + album detail)
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
ordinal: 46500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Context

This is part of the Artist/Album browsing feature (TASK-273). The sidebar routing (subtask 1) provides the `albums` view state. This subtask implements the Albums grid and album detail views.

## Target UX (Apple Music reference)

Two states within the albums view:

### State 1: Album Grid

- Responsive grid of album cards
- Each card shows:
  - Album artwork (square, fetched via `library_get_artwork_url` from any track on the album)
  - Album title below the artwork
  - Artist name below the title (slightly muted text)
- **Hover behavior**: Hovering a card reveals overlay action buttons on the artwork (Play, More/context menu)
- Cards are sorted alphabetically by album title (or optionally by artist)
- "NO IMAGE AVAILABLE" placeholder for albums without embedded artwork

### State 2: Album Detail (click-through from grid)

When user clicks an album card, navigate to a detail view:
- **Back button** (top-left) to return to the album grid
- **Large album artwork** on the left
- **Album metadata** on the right: album title (large), artist name (as clickable link that navigates to the artist in the Artists view), genre and year
- **Play and Shuffle buttons** below metadata
- **Track listing**: Table with track number, title, duration, and per-track context menu
- **Footer metadata**: Release date, item count, total duration

## Existing Infrastructure

- `library.js` has `albums` getter (unique sorted album names, line 981) and `tracksByAlbum` getter (groups tracks by album, line 1000)
- `library_get_all(album?)` backend command can filter tracks by album
- `library_get_artwork_url(track_id)` returns base64 artwork URL
- Track model has all needed fields: `album`, `artist`, `album_artist`, `track_number`, `date`, `genre`, `duration`

## Performance Considerations

- Album grid may have hundreds of cards; lazy-load artwork as cards scroll into view (IntersectionObserver)
- Consider a dedicated backend query returning distinct albums with first-track-id (for artwork), artist, year, track count
- Artwork cache (LRU capacity 50 in Rust) may need adjustment for grid view showing many albums simultaneously

## Key Files to Create/Modify

- New: `app/frontend/views/albums.html` - Albums view template (grid + detail)
- New: `app/frontend/js/components/albums-browser.js` - Albums view component
- Modify: Main layout to include the albums view template
- Possibly: `crates/mt-tauri/src/db/library.rs` and `commands.rs` for optimized album listing query
- Possibly: Album detail view could be a shared component reused by the Artists view
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Album grid displays responsive cards with artwork, album title, and artist name
- [ ] #2 Hovering an album card reveals Play and context menu action buttons overlaid on artwork
- [ ] #3 Albums without artwork show a placeholder image
- [ ] #4 Clicking an album card navigates to the album detail view
- [ ] #5 Album detail shows large artwork, album title, artist name, genre, year
- [ ] #6 Album detail has Play and Shuffle buttons that queue the album tracks
- [ ] #7 Album detail shows track listing with track numbers, titles, and durations
- [ ] #8 Back button in album detail returns to the album grid preserving scroll position
- [ ] #9 Artist name in album detail is clickable and navigates to that artist in the Artists view
- [ ] #10 Double-clicking a track in album detail starts playback
- [ ] #11 Performance is acceptable for libraries with 200+ albums (lazy artwork loading)
<!-- AC:END -->
