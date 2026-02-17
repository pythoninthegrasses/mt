---
id: TASK-273
title: Artist and Album browsing views (iTunes/Apple Music style)
status: In Progress
assignee: []
created_date: '2026-02-16 21:12'
updated_date: '2026-02-17 01:31'
labels:
  - feature
  - ux
dependencies: []
priority: medium
ordinal: 42500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Overview

Add Artist and Album browsing views modeled after iTunes / Apple Music, giving users a hierarchical way to browse their library (Artist > Album > Track) instead of only the current flat "all tracks" list.

## Sidebar Changes

The sidebar currently has a single "Music" section that shows all tracks. Add two new sidebar items underneath "Music":

1. **Artists** - Artist browsing view
2. **Albums** - Album browsing view

"Music" remains the default view and keeps its current behavior (flat track list, equivalent to Apple Music's "Songs" view).

## Reference Screenshots

The user provided 5 Apple Music screenshots showing the target UX:

1. **Artists view**: Split pane - left panel has scrollable alphabetical artist list with artwork thumbnails. Selecting an artist shows their detail in the right panel: artist name header, album/song count, then each album with art + track listing.
2. **Songs view**: Flat track table with columns (Title, Time, Artist, Album, Genre, Plays) - this is what "Music" already does today.
3. **Albums grid**: Responsive grid of album cards showing album art, album title, and artist name below each card.
4. **Albums grid hover**: Hovering an album card reveals Play, Download, and More action buttons overlaid on the artwork.
5. **Album detail**: Clicking an album navigates to a detail view with: back button, large album art, album title, artist name (as link), genre/year, Play + Shuffle buttons, track listing with track numbers and durations, and footer metadata (release date, item count, total duration, copyright).

## Existing Infrastructure

- **Database**: Track model already has `artist`, `album`, `album_artist`, `track_number`, `disc_number`, `date`, `genre` fields
- **Backend**: `library_get_all()` already accepts `artist` and `album` filter params; `library_get_stats()` returns `total_artists` and `total_albums`
- **Frontend store** (`library.js`): Already has `artists`, `albums`, `tracksByArtist`, `tracksByAlbum` computed getters (lines 972-1012) but they are NOT rendered to any view yet
- **Artwork**: `library_get_artwork_url(track_id)` returns base64 data URL; cached in Rust LRU (capacity 50)
- **View system**: Alpine.js state-based (`ui.js` view property), no router. Views switched via `x-show` directives
- **Sidebar**: Hardcoded sections in `sidebar.js` lines 23-30, template in `sidebar.html`

## Architecture Notes

- All views use Alpine.js + basecoat/Tailwind CSS
- Virtual scrolling is used for the track list (34px row height) - new views with long lists should also virtualize
- No backend changes may be needed if the existing `library_get_all(artist?, album?)` filtering and the JS-side grouping getters are sufficient. However, dedicated backend queries for "list distinct artists" and "list distinct albums with metadata" would be more efficient for large libraries and should be considered.
<!-- SECTION:DESCRIPTION:END -->
