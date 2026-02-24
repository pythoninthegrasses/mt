---
id: TASK-288
title: Add "Go to Album" context menu item to track context menus
status: To Do
assignee: []
created_date: '2026-02-24 22:31'
labels:
  - frontend
  - ux
  - context-menu
dependencies: []
references:
  - app/frontend/js/mixins/context-menu-actions.js
  - app/frontend/js/mixins/single-track-context-menu.js
  - app/frontend/js/components/albums-browser.js
  - app/frontend/js/stores/ui.js
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add a "Go to Album" item to the track right-click context menu across all views (library, artists, albums detail). Clicking it should navigate to the Albums view and drill down into the track's album.

**User story**: Right-click "Sia - Chandelier" > "Go to Album" > navigates to Albums view showing "1000 Forms of Fear" album detail.

**Menu placement**: Between "Add to Liked Songs" and the separator before "Show in Finder" — matching the user's request.

## Current Context Menu Order (library)

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

### Context menu mixins (add menu item here)
- `app/frontend/js/mixins/context-menu-actions.js` — Library browser context menu (multi-track). Menu items defined in `handleContextMenu()` at line 80. Insert new item after "Add to Liked Songs" (line 104) and before the separator/Show in Finder block (line 131).
- `app/frontend/js/mixins/single-track-context-menu.js` — Artists/albums browser context menu (single-track). Menu items defined in `handleContextMenu()` at line 24. Insert after "Add to Liked Songs" (line 36) and before the separator + "Show in Finder" (line 37-38).

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
- Multiple tracks are selected (in library view, `selectedCount > 1`)
- Track has no album metadata (`!track.album`)

### Note on single-track-context-menu.js
This mixin is used by both artists-browser and albums-browser. When the user is already in the album detail view, "Go to Album" should either be hidden or disabled (they're already looking at the album). Consider checking if `$store.ui.view === 'albums'` and the album matches.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Right-clicking a track in the library view shows 'Go to Album' between 'Add to Liked Songs' and the separator before 'Show in Finder'
- [ ] #2 Clicking 'Go to Album' switches to Albums view and opens the correct album detail (matching album name + album artist)
- [ ] #3 Right-clicking a track in the artists view also shows 'Go to Album' with same behavior
- [ ] #4 'Go to Album' is disabled when multiple tracks are selected in library view
- [ ] #5 'Go to Album' is disabled or hidden when the track has no album metadata
- [ ] #6 When already viewing an album in albums detail view, 'Go to Album' is hidden or disabled for tracks in that same album
- [ ] #7 Context menu closes after clicking 'Go to Album'
<!-- AC:END -->
