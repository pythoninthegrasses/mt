# Playlist Management Architecture - Complete Analysis

## Overview
This document maps the complete playlist management flow in the MT music player, including sidebar playlist renaming, "Add to Playlist" context menu, and data synchronization between components.

## Key Finding: Two Independent Playlist Data Sources

### Issue Discovered
The **sidebar** and **library context menu** use **DIFFERENT data sources** for playlists:

1. **Sidebar** (`sidebar.js`): Uses `loadPlaylists()` → calls `api.playlists.getAll()`
2. **Library Context Menu** (`library-browser.js`): Uses `loadPlaylists()` → calls `api.playlists.getAll()` 
3. **Synchronization**: They communicate via custom DOM event `mt:playlists-updated`

This means if one component doesn't refresh when playlists change, the other may show stale data.

---

## 1. SIDEBAR PLAYLIST MANAGEMENT

### File: `/Users/lance/git/mt/app/frontend/js/components/sidebar.js`

#### State Properties (lines 7-12)
```javascript
playlists: [],                    // List of playlists for sidebar
editingPlaylist: null,           // Currently editing playlist (inline rename)
editingName: '',                 // New name being typed
editingIsNew: false,             // Flag: is this a newly created playlist?
dragOverPlaylistId: null,        // For drag-over visual feedback
```

#### Key Methods

**`loadPlaylists()` (lines 140-152)**
- Fetches all playlists via `api.playlists.getAll()`
- Maps response to sidebar format with `id: 'playlist-{id}'` and `playlistId: id`
- Called on:
  - Component init (`init()`)
  - After creating a playlist
  - After renaming
  - After deleting
  - When receiving `mt:playlists-updated` event (line 410-412 in init)

**`startInlineRename(playlist, isNew)` (lines 239-250)**
- Sets up inline editing mode
- Focuses input field after `$nextTick()`
- Used for both new playlists and existing playlist renames

**`commitInlineRename()` (lines 252-296)**
- Validates new name (trims whitespace)
- Calls `api.playlists.rename(playlistId, newName)` (line 276)
- On success: calls `loadPlaylists()` to refresh state
- Handles duplicate name errors gracefully

**`createPlaylist()` (lines 220-237)**
- Calls `api.playlists.generateName()` to get unique default name
- Calls `api.playlists.create(uniqueName)`
- **Fires `mt:playlists-updated` event** (line 227) to notify other components
- Automatically starts inline rename for new playlist (line 231)

**Drag-Drop to Playlist (lines 360-424, `handlePlaylistDrop`)**
- Accepts track drag from library (uses `window._mtDraggedTrackIds` workaround for Tauri)
- Calls `api.playlists.addTracks(playlistId, trackIds)` (line 405)
- **Fires `mt:playlists-updated` event** (line 419)

#### Event Handlers

**Context Menu** (lines 611-620, 622-628, 630-644)
- Right-click on playlist shows: Rename, Delete options
- Calls `renamePlaylist()` or `deletePlaylist()` methods

**Delete Playlists** (lines 630-717, `deleteSelectedPlaylists()`)
- Multi-select support with Shift+Click, Cmd+Click
- Shows Tauri confirmation dialog
- Calls `api.playlists.delete()` for each playlist
- **Fires `mt:playlists-updated` event** (line 710)

#### Event Listeners
```javascript
window.addEventListener('mt:playlists-updated', () => {
  this.loadPlaylists();  // Refresh sidebar playlists
});
```
Called in `init()` at line 410-412

---

## 2. LIBRARY CONTEXT MENU - "Add to Playlist"

### File: `/Users/lance/git/mt/app/frontend/js/components/library-browser.js`

#### State Properties (lines 63-68)
```javascript
playlists: [],                    // List of playlists for context menu
showPlaylistSubmenu: false,       // Show/hide submenu
submenuOnLeft: false,             // Position submenu on left or right
submenuY: 0,                      // Vertical position of submenu
currentPlaylistId: null,          // Current playlist being viewed
```

#### Key Methods

**`loadPlaylists()` (lines 845-853)**
- Fetches playlists via `api.playlists.getAll()`
- **NOTE:** Uses slightly different format than sidebar - stores raw API response
- Called on:
  - Component init (`init()`)
  - When receiving `mt:playlists-updated` event (lines 410-412 in init)

**Context Menu Generation** (lines 1039-1126, `handleContextMenu()`)
- Right-click on track shows context menu with items:
  - Play Now
  - Add to Queue
  - Play Next
  - **"Add to Playlist" (with submenu arrow)** (lines 1069-1074)
  - Remove from Playlist (if in playlist view)
  - Show in Finder
  - Edit Metadata
  - Remove from Library

**`addToPlaylist(playlistId)` (lines 1204-1243)**
- Gets selected tracks via `getSelectedTracks()`
- Calls `api.playlists.addTracks(playlistId, trackIds)` (line 1216)
- Shows toast with success/info message
- **Fires `mt:playlists-updated` event** (line 1232)
- Closes context menu and submenu

**`createPlaylistWithTracks()` (lines 1245-1273)**
- Prompts for playlist name
- Creates playlist via `api.playlists.create(name)`
- Adds tracks via `api.playlists.addTracks(playlist.id, trackIds)`
- **Fires `mt:playlists-updated` event** (line 1265)

#### Playlist Submenu HTML (library.html, lines 282-312)
```html
<!-- Add to Playlist submenu -->
<div x-show="contextMenu && showPlaylistSubmenu" class="context-menu bg-card">
  <div @click="createPlaylistWithTracks()">
    <span>+</span>
    <span>New Playlist...</span>
  </div>
  <div x-show="playlists.length > 0" class="context-menu-separator"></div>
  <template x-for="playlist in playlists" :key="playlist.id">
    <div @click="addToPlaylist(playlist.id)">
      <span x-text="playlist.name"></span>
    </div>
  </template>
  <div x-show="playlists.length === 0">No playlists yet</div>
</div>
```

#### Event Listeners
```javascript
window.addEventListener('mt:playlists-updated', () => {
  this.loadPlaylists();  // Refresh library playlists
});
```
Called in `init()` at line 410-412

---

## 3. PLAYLIST DATA SOURCE - API

### File: `/Users/lance/git/mt/app/frontend/js/api.js` (lines 851-1057)

#### Playlist API Methods

**`playlists.getAll()` (lines 856-868)**
```javascript
async getAll() {
  if (invoke) {
    const response = await invoke('playlist_list');
    return response.playlists || [];
  }
  const response = await request('/playlists');
  return Array.isArray(response) ? response : (response.playlists || []);
}
```
- Primary method: Uses Tauri `invoke()` command `playlist_list`
- Fallback: HTTP request to `/playlists` (browser mode)
- Returns array of playlist objects with structure: `{id, name, ...}`

**`playlists.create(name)` (lines 893-907)**
- Tauri command: `playlist_create`
- Returns `{playlist: {...}}`

**`playlists.rename(playlistId, name)` (lines 932-945)**
- Tauri command: `playlist_update`
- Returns `{playlist: {...}}`

**`playlists.delete(playlistId)` (lines 952-964)**
- Tauri command: `playlist_delete`

**`playlists.addTracks(playlistId, trackIds, position)` (lines 973-990)**
- Tauri command: `playlist_add_tracks`
- Returns `{added: number, track_count: number}`
- **This is the method used by context menu**

**`playlists.reorderPlaylists(fromPosition, toPosition)` (lines 1044-1057)**
- Reorders playlists in sidebar
- Tauri command: `playlists_reorder`

---

## 4. EVENT SYNCHRONIZATION MECHANISM

### Custom DOM Event: `mt:playlists-updated`

**Where Dispatched:**
1. `sidebar.js:227` - After `createPlaylist()`
2. `sidebar.js:419` - After `handlePlaylistDrop()` (drag tracks to playlist)
3. `sidebar.js:710` - After `deleteSelectedPlaylists()`
4. `library-browser.js:1232` - After `addToPlaylist()`
5. `library-browser.js:1265` - After `createPlaylistWithTracks()`
6. `library-browser.js:1307` - After `removeFromPlaylist()`

**Listeners:**
- `sidebar.js:410-412` - Refreshes sidebar playlists
- `library-browser.js:410-412` - Refreshes library context menu playlists

**Event Pattern:**
```javascript
// Dispatch (all over the code)
window.dispatchEvent(new CustomEvent('mt:playlists-updated'));

// Listen (in both components)
window.addEventListener('mt:playlists-updated', () => {
  this.loadPlaylists();
});
```

### Tauri Event System: `playlists:updated` (events.js)

**File:** `/Users/lance/git/mt/app/frontend/js/events.js` (lines 182-198)

```javascript
// Playlists updated event
await subscribe(Events.PLAYLISTS_UPDATED, (payload) => {
  const { action, playlist_id } = payload;
  const library = Alpine.store('library');

  console.log(`[events] Playlists ${action}: playlist ${playlist_id}`);

  // Refresh playlists
  if (library.loadPlaylists) {
    library.loadPlaylists();
  }

  // If showing this playlist, refresh its tracks
  if (library.activePlaylistId === playlist_id && library.loadPlaylistTracks) {
    library.loadPlaylistTracks(playlist_id);
  }
});
```

**Note:** This is a Tauri backend event, but it references `library.loadPlaylists()` which may not exist (library store doesn't seem to have this method). This might be defensive code for future use.

---

## 5. SIDEBAR PLAYLIST RENAMING - DETAILED FLOW

### Inline Rename Flow

1. **User right-clicks playlist** → `showPlaylistContextMenu()` (line 611)
   - Sets `contextMenuPlaylist`, `contextMenuX`, `contextMenuY`

2. **User clicks "Rename" in context menu** → `renamePlaylist()` (line 622)
   - Hides context menu
   - Calls `startInlineRename(playlist, false)` (line 627)

3. **`startInlineRename()`** (line 239)
   - Sets `editingPlaylist = playlist`
   - Sets `editingName = playlist.name`
   - Sets `editingIsNew = false` (or `true` if new playlist)
   - Focuses input field after `$nextTick()`

4. **HTML Update** (sidebar.html, lines 112-126)
   - Shows input field instead of button
   - User types new name in input field

5. **User hits Enter or clicks away** → `commitInlineRename()` (line 252)
   - Validates name (trims, checks if empty)
   - If unchanged, just closes editing mode
   - Calls `api.playlists.rename(playlistId, newName)`
   - On success: calls `loadPlaylists()` to refresh sidebar
   - Fires `mt:playlists-updated` event (line 280)
   - If new playlist, loads the playlist view

6. **`mt:playlists-updated` event triggers** (line 410-412)
   - `library-browser.js` refreshes its playlist list for context menu
   - Other listeners (if any) also refresh

### Create New Playlist Flow

1. **User clicks "+" button in playlists header** → `createPlaylist()` (line 220)
   - Calls `api.playlists.generateName()` to get unique name like "New playlist 2"
   - Calls `api.playlists.create(uniqueName)` 
   - Fires `mt:playlists-updated` event (line 227)
   - Calls `loadPlaylists()` to fetch updated list
   - Starts inline rename on new playlist (line 231)

2. **User types new name and presses Enter** → Same as rename flow above

3. **If user cancels (ESC or leaves blank)** → `cancelInlineRename()` (line 298)
   - If it was a new playlist: calls `api.playlists.delete(playlistId)` to remove it
   - Calls `loadPlaylists()` to refresh
   - Clears editing state

---

## 6. "ADD TO PLAYLIST" CONTEXT MENU - DETAILED FLOW

### Context Menu Display Flow

1. **User right-clicks track in library** → `handleContextMenu()` (line 1039)
   - Builds context menu items array (lines 1054-1102)
   - Includes "Add to Playlist" item with `hasSubmenu: true` (line 1070)
   - Sets `contextMenu` object with position `x`, `y`, and menu items

2. **HTML shows context menu** (library.html, lines 248-280)
   - User hovers over "Add to Playlist" item (line 268)
   - `@mouseenter` event triggers: `showPlaylistSubmenu = true` (line 268)

3. **Submenu Displays** (library.html, lines 283-312)
   - Shows "New Playlist..." option (line 294)
   - Lists all playlists from `this.playlists` array (line 300)
   - Each playlist is clickable

### Add Tracks to Existing Playlist

1. **User clicks playlist in submenu** → `addToPlaylist(playlistId)` (line 1204)
   - Gets selected tracks via `getSelectedTracks()`
   - Calls `api.playlists.addTracks(playlistId, trackIds)`
   - Shows toast: "Added X tracks to [playlist name]"
   - Fires `mt:playlists-updated` event (line 1232)
   - Closes both context menu and submenu (line 1241-1242)

2. **`mt:playlists-updated` triggers** (line 410-412)
   - `sidebar.js` refreshes its playlist list (usually no visual change unless playlist is being viewed)
   - `library-browser.js` refreshes its playlist list for next context menu

### Create New Playlist from Context Menu

1. **User clicks "New Playlist..." in submenu** → `createPlaylistWithTracks()` (line 1245)
   - Shows prompt for playlist name
   - Calls `api.playlists.create(name.trim())`
   - Calls `api.playlists.addTracks(playlist.id, trackIds)`
   - Shows toast: "Created [name] with X tracks"
   - Fires `mt:playlists-updated` event (line 1265)

2. **Both sidebar and context menu refresh** via event listener

---

## 7. POTENTIAL ISSUES & DESIGN NOTES

### Issue 1: Separate Data Sources
- Sidebar and library context menu maintain separate `playlists[]` arrays
- They communicate via DOM event, which is less reliable than shared state
- If event fails to dispatch, one component will have stale data

### Issue 2: No Shared Store
- Unlike `library`, `queue`, `player`, there's no global Alpine store for playlists
- Each component loads playlists independently
- Could lead to data inconsistencies

### Issue 3: Event System Redundancy
- Two event mechanisms: custom DOM events + Tauri backend events
- Tauri event handler in `events.js` references `library.loadPlaylists()` which doesn't exist
- This appears to be incomplete or defensive code

### Issue 4: Race Conditions
- If user rapidly creates/deletes playlists while viewing context menu, could miss updates
- No debouncing on playlist list refresh

---

## 8. KEY INSIGHT: WHY SEPARATE DATA SOURCES?

The architecture uses separate data sources because:

1. **Independent Lifecycle**
   - Sidebar loads playlists when initialized and when sidebar is active
   - Library browser loads playlists when initialized and when context menu appears
   - Each component can refresh independently

2. **Event Coordination**
   - Custom `mt:playlists-updated` event allows loose coupling
   - Components don't need to know about each other
   - Either component can trigger a refresh that alerts others

3. **Flexibility**
   - Sidebar might show different playlist list than context menu (e.g., filtered)
   - Currently they show the same list, but architecture allows divergence

---

## 9. HTML STRUCTURE SUMMARY

### Sidebar Playlist Context Menu (sidebar.html, lines 165-189)
- Shows when user right-clicks a playlist
- Options: Rename, Delete
- Simple 2-item menu

### Library Track Context Menu (library.html, lines 248-280)
- Shows when user right-clicks a track
- Main menu items + "Add to Playlist" with submenu arrow

### Playlist Submenu (library.html, lines 283-312)
- Shows alongside main context menu
- "New Playlist..." option at top
- List of existing playlists from `libraryBrowser.playlists[]`
- "No playlists yet" message if list is empty

---

## 10. DATA FLOW DIAGRAM

```
Sidebar Component (sidebar.js)
├── playlists[] (from api.playlists.getAll())
├── Events Fired:
│   ├── createPlaylist() → mt:playlists-updated
│   ├── handlePlaylistDrop() → mt:playlists-updated
│   └── deleteSelectedPlaylists() → mt:playlists-updated
├── Event Listener:
│   └── mt:playlists-updated → loadPlaylists()
└── Inline Rename UI (sidebar.html, lines 112-126)

Library Component (library-browser.js)
├── playlists[] (from api.playlists.getAll())
├── Events Fired:
│   ├── addToPlaylist() → mt:playlists-updated
│   ├── createPlaylistWithTracks() → mt:playlists-updated
│   └── removeFromPlaylist() → mt:playlists-updated
├── Event Listener:
│   └── mt:playlists-updated → loadPlaylists()
└── Context Menu UI (library.html, lines 283-312)

API Layer (api.js)
└── playlists.getAll() → Tauri invoke('playlist_list')
    └── Returns: Array of {id, name, ...}

Backend (Rust via Tauri)
└── Playlist CRUD commands
```

---

## Conclusion

The playlist management system uses a **dual component architecture** with:
1. **Sidebar** for managing playlists (create, rename, delete, reorder)
2. **Context Menu** for adding tracks to playlists
3. **Custom DOM events** for synchronization between components
4. **Shared API layer** that both components use independently

This design provides flexibility and loose coupling, but at the cost of data duplication and potential inconsistency issues.
