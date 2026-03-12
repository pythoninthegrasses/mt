---
id: TASK-288
title: Add "Go to Album" context menu item to track context menus
status: Done
assignee: []
created_date: '2026-02-24 22:31'
updated_date: '2026-02-25 22:05'
labels:
  - frontend
  - ux
  - context-menu
dependencies: []
references:
  - app/frontend/js/mixins/context-menu-actions.js
  - app/frontend/js/components/albums-browser.js
  - app/frontend/js/stores/ui.js
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add a "Go to Album" item to the track right-click context menu in track-list based views. Clicking it should navigate to the Albums view and drill down into the track's album.

**Scope**: Music (library), Liked Songs, Recently Played, Recently Added, Top 25, and Playlist detail views — all views using `context-menu-actions.js` mixin.

**Out of scope**: Artists browser and Albums browser views (use `single-track-context-menu.js` mixin — can be added in a follow-up task).

**User story**: Right-click "Sia - Chandelier" > "Go to Album" > navigates to Albums view showing "1000 Forms of Fear" album detail.

**Menu placement**: Between "Add to Liked Songs" and the separator before "Show in Finder".

## Current Context Menu Order

1. Play Now
2. Add to Queue
3. ---separator---
4. Play Next
5. Add to Playlist (submenu)
6. Add to Liked Songs
7. ---separator--- ← INSERT "Go to Album" BEFORE this separator
8. Show in Finder
9. Edit Metadata
10. ---separator---
11. Remove from Library

## Target Context Menu Order

1. Play Now
2. Add to Queue
3. ---separator---
4. Play Next
5. Add to Playlist (submenu)
6. Add to Liked Songs
7. **Go to Album** ← NEW
8. ---separator---
9. Show in Finder
10. Edit Metadata
11. ---separator---
12. Remove from Library

## Key Files

### Context menu mixin (add menu item here)
- `app/frontend/js/mixins/context-menu-actions.js` — Used by library browser, liked songs, recently played/added, top 25, and playlist views. Menu items defined in `handleContextMenu()` at line 80. Insert new item after "Add to Liked Songs" (line 104) and before the separator/Show in Finder block (line 131).

### Albums browser (navigation target)
- `app/frontend/js/components/albums-browser.js` — Has `openAlbumDetail(album)` (line 169) which drills into an album. Has `navigateToArtist()` (line 197) as a cross-view navigation precedent using `ui.setView()` + `CustomEvent`.

### UI store (view switching)
- `app/frontend/js/stores/ui.js` — `setView('albums')` switches to albums view (line 86).

## Implementation Pattern

Follow the existing `navigateToArtist()` pattern in `albums-browser.js`:

1. **Dispatch event**: `window.dispatchEvent(new CustomEvent('mt:navigate-to-album', { detail: { album: track.album, albumArtist: track.album_artist || track.artist } }))`
2. **Switch view**: `this.$store.ui.setView('albums')`
3. **Listen in albums-browser.js**: Add event listener for `mt:navigate-to-album` in `init()`, find the matching album in `albumList`, and call `openAlbumDetail(album)`.

### Track → Album linkage
Albums are identified by composite key: `track.album` + `track.album_artist` (falling back to `track.artist`). See `albumList` getter at line 83 of `albums-browser.js`.

### Menu item should be disabled when:
- Multiple tracks are selected (`selectedCount > 1`)
- Track has no album metadata (`!track.album`)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Right-clicking a track in the Music (library) view shows 'Go to Album' between 'Add to Liked Songs' and the separator before 'Show in Finder'
- [x] #2 Clicking 'Go to Album' switches to Albums view and opens the correct album detail (matching album name + album artist)
- [x] #3 Right-clicking a track in Liked Songs view shows 'Go to Album' with same behavior
- [x] #4 Right-clicking a track in Recently Played view shows 'Go to Album' with same behavior
- [x] #5 Right-clicking a track in Recently Added view shows 'Go to Album' with same behavior
- [x] #6 Right-clicking a track in Top 25 view shows 'Go to Album' with same behavior
- [x] #7 Right-clicking a track in a Playlist detail view shows 'Go to Album' with same behavior
- [x] #8 'Go to Album' is disabled when multiple tracks are selected
- [x] #9 'Go to Album' is disabled or hidden when the track has no album metadata
- [x] #10 Context menu closes after clicking 'Go to Album'
<!-- AC:END -->
