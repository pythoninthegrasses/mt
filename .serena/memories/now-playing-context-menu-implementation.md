# Now Playing Context Menu Implementation Guide

## Overview
Task-304 requires adding right-click context menu support to tracks in the Now Playing / Up Next queue list. The context menu should reuse existing library view logic with proper viewport-aware positioning.

## Architecture

### 1. Context Menu Implementation in Library View

#### HTML Template (`app/frontend/views/library.html` lines 330-395)
- Track context menu div with classes: `context-menu track-context-menu bg-card`
- Positioned using `:style="contextMenu ? left: ${contextMenu.x}px; top: ${contextMenu.y}px : ''"`
- Uses `@click.outside` to dismiss menu
- Renders menu items from `contextMenu.items` array
- Playlist submenu rendered separately with `getSubmenuStyle()`

#### CSS Styles (`app/frontend/styles.css` lines 579-630)
- `.context-menu`: fixed positioning, z-index 100, min-width 180px, borders, shadows, padding 0.25rem
- `.context-menu-item`: flex layout, gap 0.5rem, padding 0.5rem 0.75rem, cursor pointer
- `.context-menu-item:hover`: bg #dfdfdf
- `.context-menu-item.disabled`: opacity 0.5, pointer-events none
- `.context-menu-item.danger`: color destructive
- `.context-menu-separator`: height 1px background border

#### Mixin: `single-track-context-menu.js`
Located at `app/frontend/js/mixins/single-track-context-menu.js`

Key properties:
- `contextMenu`: { x, y, track, items }
- `playlists`: array for submenu
- `showPlaylistSubmenu`: boolean to toggle submenu
- `submenuOnLeft`: boolean for flipped positioning
- `submenuCloseTimeout`: for delayed submenu close

Key methods:
- `handleContextMenu(event, track)`: Opens context menu
  - Calculates menu position with viewport bounds checking
  - Determines if submenu should flip left: `x + menuWidth + 45 + submenuWidth > window.innerWidth`
  - Creates menu items array with actions
  - Asynchronously checks favorite status
  
- `_ctxPlayTrack(track)`: Clear queue, add track, play
- `_ctxAddToQueue(track)`: Add to end of queue
- `_ctxPlayNext(track)`: Insert at currentIndex + 1
- `_ctxToggleFavorite(track)`: Toggle favorite status
- `addToPlaylist(playlistId)`: Add track to playlist
- `_ctxShowInFinder(track)`: Reveal in Finder

#### Mixin: `context-menu-actions.js` (more complex version)
Located at `app/frontend/js/mixins/context-menu-actions.js`

Used in library-browser for multi-track selections. More sophisticated approach:
- Handles single and multiple selection
- More menu items including "Go to Album", "Go to Artist", "Edit Metadata", "Remove from Library"
- Track removal with confirmation dialog
- Shows selected track count in menu labels

### 2. Now Playing View Components

#### JavaScript Component (`app/frontend/js/components/now-playing-view.js`)
- Uses `queueDragReorderMixin()` for drag-and-drop
- Virtual scroll state management
- Lyrics fetching and display
- Key properties needed for context menu:
  - `contextMenu`: null or { x, y, track, items }
  - `showPlaylistSubmenu`: boolean
  - `submenuOnLeft`: boolean

#### HTML Template (`app/frontend/views/now-playing.html`)
Queue item rendering (lines 206-270):
- Queue item div with classes: `queue-item-wrapper`, `queue-item`
- Shows drag handle on left
- Track title and artist in middle
- Remove button (X) on right
- Double-click handler: `@dblclick.stop="$store.queue.playIndex(item.originalIndex)"`
- Current track highlighted with `item.isCurrentTrack ? 'bg-primary/20 text-primary' : ''`

Currently NO right-click handler on queue items.

### 3. Queue Store and API

#### Queue Store (`app/frontend/js/stores/queue.js`)
Key properties:
- `items`: tracks in play order
- `currentIndex`: currently playing track index
- `playOrderItems`: computed getter that returns items with metadata for UI

Key methods for context menu actions:
- `async playNextTracks(tracks)`: Insert tracks after current track
  - Handles move semantics: removes track from queue before re-inserting at play-next position
  - Tracks play-next tracks in `_playNextTrackIds` Set for shuffle preservation
  - Uses `_playNextOffset` to append after previously queued-next tracks
  
- `async remove(index)`: Remove track at index
  - Updates local state
  - Adjusts currentIndex if needed
  - Calls `queueApi.remove(index)`
  
- `async playIndex(index, fromNavigation)`: Play track at index
  - Pushes current track to history (for prev button)
  - Resets `_playNextOffset`
  - Calls `player.playTrack(track)` and `queueApi.setCurrentIndex()`

#### Queue API (`app/frontend/js/api/queue.js`)
- `queue.add(trackIds, position)`: Add tracks at position
- `queue.remove(position)`: Remove track at position
- `queue.playNextTracks()`: Not exposed directly, handled by store

### 4. Library Browser Implementation Reference

#### Position Calculation Logic (`library-browser.js` lines 164-172)
```javascript
const menuHeight = 320;
const menuWidth = 200;
const submenuWidth = 200;
let x = event.clientX;
let y = event.clientY;

if (x + menuWidth > window.innerWidth) {
  x = window.innerWidth - menuWidth - 10;
}
if (y + menuHeight > window.innerHeight) {
  y = window.innerHeight - menuHeight - 10;
}

this.submenuOnLeft = x + menuWidth + 45 + submenuWidth > window.innerWidth;
```

#### Submenu Style Calculation (`library-browser.js` lines 642-647)
```javascript
getSubmenuStyle() {
  if (!this.contextMenu) return '';
  const left = this.submenuOnLeft ? 
    this.contextMenu.x - 180 : 
    this.contextMenu.x + 180 + 45;
  const maxHeight = window.innerHeight - this.submenuY - 10;
  return `left: ${left}px; top: ${this.submenuY}px; max-height: ${maxHeight}px; overflow-y: auto`;
}
```

#### Menu Item Click Handler (`library-browser.js` lines 612-619)
```javascript
handleContextMenuItemClick(item) {
  if (!item.disabled && !item.hasSubmenu) {
    item.action();
    this.contextMenu = null;
  } else if (!item.disabled) {
    item.action();
  }
}
```

#### Submenu Mouse Handlers (`library-browser.js` lines 621-640)
- `handleSubmenuMouseenter()`: Shows submenu, stores Y position for alignment
- `handleSubmenuMouseleave()`: Sets timeout to hide submenu (200ms delay)
- Timeout cleared on submenu enter to prevent flickering

## Implementation Plan

### For Now Playing View

1. **Add context menu data properties** to `nowPlayingView` component
   - `contextMenu`: null | { x, y, track, items }
   - `playlists`: array
   - `showPlaylistSubmenu`: boolean
   - `submenuOnLeft`: boolean
   - `submenuY`: number
   - `submenuCloseTimeout`: null | timeout ID

2. **Add right-click handler to queue items** in now-playing.html
   - Add `@contextmenu.prevent="handleContextMenu($event, item.track)"` to queue-item div

3. **Add context menu methods to nowPlayingView**:
   - `handleContextMenu(event, track)`: Create menu with queue-specific items
   - `handleContextMenuItemClick(item)`: Click handler
   - `handleSubmenuMouseenter(item, el)`: Submenu hover enter
   - `handleSubmenuMouseleave(item)`: Submenu hover leave
   - `getSubmenuStyle()`: Calculate submenu position

4. **Add context menu HTML** to now-playing.html after the queue list div
   - Main context menu div (similar to library.html)
   - Playlist submenu div
   - Reuse exact CSS classes for styling

5. **Menu items for Now Playing context**:
   - Play Now (clear queue, add track, play)
   - Add to Queue (append to end)
   - separator
   - Play Next (insert after current)
   - Add to Playlist (with submenu)
   - Add to Liked Songs
   - separator
   - Show in Finder
   - separator
   - Remove from Queue (simple remove)

6. **Action implementations**:
   - Use `this.queue` store methods: `playNextTracks()`, `remove()`, `playIndex()`
   - Use `favorites.add()`, `favorites.remove()`, `favorites.check()`
   - Use `playlists.addTracks()`
   - For "Show in Finder": use Tauri `show_in_folder()` command

7. **Mixin approach** (optional, cleaner):
   - Create `now-playing-context-menu.js` mixin
   - Mix into nowPlayingView alongside `queueDragReorderMixin`
   - Keeps code modular and reusable

## Key Differences from Library View

1. **No multi-select**: Now Playing is single-track context menu (like artists/albums)
   - Should use `singleTrackContextMenuMixin` pattern
   - Simpler menu with fewer items

2. **Queue-specific actions**:
   - "Play Next" uses `queue.playNextTracks()` not generic insert
   - "Remove from Queue" uses `queue.remove()` not playlist-specific removal
   - No "Edit Metadata" (queue tracks are read-only references)
   - No "Remove from Library" (would remove from library, not queue)

3. **Position context**:
   - Queue list is inside fixed right panel (w-96)
   - Menu positioning needs to account for panel boundaries
   - Container rect calculations needed for accurate positioning

4. **No drag conflicts**:
   - Context menu right-click shouldn't interfere with drag-handle left-side
   - Drag handle is on left (0.5rem gap), context menu typically triggered on track content

## Testing Considerations

- AC#1: Right-click on queue track opens menu
- AC#2: Menu items present and functional
- AC#3: Menu flips left when near right edge of screen
- AC#4: Play Next reorders queue visually updates
- AC#5: Click outside or select item dismisses menu
- AC#6: Drag-to-reorder still works, remove button still works

## Files to Modify

1. `app/frontend/js/components/now-playing-view.js` - Add properties and methods
2. `app/frontend/views/now-playing.html` - Add @contextmenu handler and context menu HTML
3. Create or reuse `app/frontend/js/mixins/now-playing-context-menu.js` - Optional mixin file

## CSS Already Available

All context menu styles already exist in `app/frontend/styles.css` lines 579-630.
No new CSS needed.
