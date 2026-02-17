---
id: task-275
title: Add "Add to Playlist" context menu item to Artist and Album browsing views
status: In Progress
assignee: []
created_date: '2026-02-17 03:19'
updated_date: '2026-02-17 03:27'
labels:
  - feature
  - ux
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Overview

GitHub issue #3 requests a right-click menu to easily add tracks/albums/artists to playlists from the browsing views. The Artist and Album views are implemented, and their context menus support queue operations (Add to Queue, Play Next), but are missing an "Add to Playlist" option.

Playlists already exist in the app — this task is about wiring the existing playlist functionality into the context menus of the Artist and Album browsing views.

## What's Already Done (issue #3)

- **Artist view**: commit `6a776c3` (task-273.02)
- **Album view**: commit `8008d91` (task-273.03)
- **Queue context menus**: Add to Queue, Play Next, Play Album, Shuffle Album all work

## What's Missing

- "Add to Playlist" context menu item in the Album browsing view (`albums-browser.js`) for both album-level and track-level context menus
- "Add to Playlist" context menu item in the Artist browsing view for artist-level and track-level context menus
- Submenu or picker to select which playlist to add to

## References

- GitHub issue: #3
- Album browser component: `app/frontend/js/components/albums-browser.js`
- Album browser template: `app/frontend/views/albums.html`
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Right-click context menu on albums includes 'Add to Playlist' option
- [ ] #2 Right-click context menu on tracks in album detail includes 'Add to Playlist' option
- [ ] #3 Right-click context menu on artists/tracks in artist view includes 'Add to Playlist' option
- [ ] #4 Selecting 'Add to Playlist' shows a playlist picker (existing playlists)
- [ ] #5 All tracks for the selected album/artist are added to the chosen playlist
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementation Summary

### Albums Browser (`albums-browser.js` + `albums.html`)
- Added playlist state: `playlists`, `showPlaylistSubmenu`, `submenuOnLeft`, `submenuY`, `submenuCloseTimeout`
- Added `_loadPlaylists()` with `mt:playlists-updated` event listener in `init()`
- Added "Add to Playlist" with submenu to both `showAlbumContextMenu()` (all album tracks) and `showTrackContextMenu()` (single track)
- Added `addToPlaylist(playlistId)`, `createPlaylistWithTracks()`, `closeContextMenu()`, `handleSubmenuEnter()`, `handleSubmenuLeave()` methods
- Updated HTML context menu to use `context-menu` CSS classes (matching artists/library pattern) with submenu support
- Added playlist submenu with "New Playlist..." option, separator, and existing playlists list

### Artists Browser (`artists-browser.js` + `artists.html`)
- Enhanced `addToPlaylist()` to show playlist name in toast and dispatch `mt:playlists-updated` event
- Added `createPlaylistWithTracks()` method for creating new playlists from context menu
- Added "New Playlist..." option to playlist submenu HTML (was missing, only showed existing playlists)
<!-- SECTION:NOTES:END -->
