# Task task-254 - Investigate library loading spinner on startup and view switches

- **Status:** Backlog
- **Priority:** Medium
- **Created:** 2026-02-04
- **Labels:** frontend, performance, ux, investigation

## Description

### Problem

The library loading spinner appears in situations where it shouldn't:

1. **On app startup**: Even though library data should be cached/instant, the loading spinner is visible for 1-2 seconds
2. **When switching views**: Navigating from any view back to the Music library triggers the loading animation

### Hypothesis

The watched folder rescan that triggers on startup (`[watcher] Triggering rescan for folder 1`) may be causing the library to reload and show the spinner, even when:
- No files have changed (`+0 ~0 -0`)
- The library data is already loaded

### Expected Behavior

- Library should load instantly from cache on startup (no spinner visible)
- Switching back to the Music library view should not trigger a reload if data is already present
- Loading spinner should only appear for actual data fetching operations

### Reproduction Steps

1. Start the app with `task tauri:dev`
2. Observe the loading spinner on the Music library view during startup
3. Switch to Settings or another view
4. Switch back to Music library
5. Observe the loading spinner appearing again

### Investigation Points

- Check if `watched-folder:results` event triggers unnecessary `library.load()` calls
- Check if `library-browser.init()` always triggers a load even when data exists
- Check if the `loading` state is being set unnecessarily
- Review the conditions that trigger `libraryStore.load()`

## Acceptance Criteria

- [ ] #1 Root cause of unnecessary library loading identified
- [ ] #2 Library does not show loading spinner on startup when data is cached
- [ ] #3 Switching back to Music library view does not trigger reload if data exists
- [ ] #4 Loading spinner only appears for genuine data fetching operations
