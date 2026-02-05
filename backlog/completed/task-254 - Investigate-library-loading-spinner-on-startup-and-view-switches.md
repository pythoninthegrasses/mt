---
id: task-254
title: Investigate library loading spinner on startup and view switches
status: Done
assignee: []
created_date: '2026-02-04 08:36'
updated_date: '2026-02-05 05:03'
labels:
  - frontend
  - performance
  - ux
  - investigation
dependencies: []
priority: medium
ordinal: 12750
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

The library loading spinner appears in situations where it shouldn't:

1. **On app startup**: Even though library data should be cached/instant, the loading spinner is visible for 1-2 seconds
2. **When switching views**: Navigating from any view back to the Music library triggers the loading animation

## Hypothesis

The watched folder rescan that triggers on startup (`[watcher] Triggering rescan for folder 1`) may be causing the library to reload and show the spinner, even when:
- No files have changed (`+0 ~0 -0`)
- The library data is already loaded

## Expected Behavior

- Library should load instantly from cache on startup (no spinner visible)
- Switching back to the Music library view should not trigger a reload if data is already present
- Loading spinner should only appear for actual data fetching operations

## Reproduction Steps

1. Start the app with `task tauri:dev`
2. Observe the loading spinner on the Music library view during startup
3. Switch to Settings or another view
4. Switch back to Music library
5. Observe the loading spinner appearing again

## Investigation Points

- Check if `watched-folder:results` event triggers unnecessary `library.load()` calls
- Check if `library-browser.init()` always triggers a load even when data exists
- Check if the `loading` state is being set unnecessarily
- Review the conditions that trigger `libraryStore.load()`
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Root cause of unnecessary library loading identified
- [x] #2 Library does not show loading spinner on startup when data is cached
- [x] #3 Switching back to Music library view does not trigger reload if data exists
- [x] #4 Loading spinner only appears for genuine data fetching operations
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Root Cause

The `library.load()` method always set `loading = true` and cleared `tracks = []` before fetching data, regardless of whether:
1. Data already existed for the same section
2. A force reload was actually needed

This caused the loading spinner to appear on:
- App startup (even though data would load quickly)
- View switching back to Music library from Settings/other views

## Solution

Added a `forceReload` parameter to `library.load()` with intelligent caching:

1. **Section Tracking**: Added `_lastLoadedSection` to track which section the current data belongs to

2. **Smart Skip Logic**: `load()` now skips loading if:
   - `forceReload` is false (default)
   - Data already exists (`tracks.length > 0`)
   - Not currently loading
   - Same section as last load (`_lastLoadedSection === currentSection`)

3. **Force Reload Cases**: The following operations use `forceReload: true`:
   - `init()` - First load on startup
   - `search()` - Search parameters changed
   - `setSortBy()` - Sort parameters changed
   - `scan()` - After scanning new files
   - `fetchTracks()` - Event-driven refresh
   - `_setupWatchedFolderListener()` - File changes detected
   - Settings actions that modify data

4. **Section Tracking in All Load Methods**: Updated `loadFavorites()`, `loadRecentlyPlayed()`, `loadRecentlyAdded()`, `loadTop25()`, and `loadPlaylist()` to set `_lastLoadedSection` appropriately.

## Files Changed

- `app/frontend/js/stores/library.js` - Main fix with forceReload parameter and section tracking
- `app/frontend/js/components/settings-view.js` - Updated to use `{ forceReload: true }`

## Testing

- All 223 Vitest unit tests pass
- Manual testing via Tauri MCP confirms:
  - Switching from Settings back to Music library: No loading spinner (tracks stay loaded)
  - Switching from Liked Songs to Music: Loading spinner shows (correct - different section)
<!-- SECTION:NOTES:END -->
