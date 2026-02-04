---
id: task-250
title: Fix startup rendering flash - hide UI scaffolding until ready
status: Done
assignee: []
created_date: '2026-02-03 07:16'
updated_date: '2026-02-04 08:18'
labels:
  - frontend
  - ux
  - polish
  - startup
dependencies: []
priority: medium
ordinal: 17000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

During app startup (first 1-2 seconds), the UI flashes various components before they're properly sized and styled. Users see the scaffolding of the app (unstyled/unsized components) before everything is in place.

## Evidence

**Original recordings:**
- `~/Desktop/Kapture 2026-02-03 at 01.10.38.mp4` (7s video, issue visible in first ~3s)
- `~/Desktop/Kapture 2026-02-03 at 01.10.38.gif` (same timing)

**Extracted key frames** (213 total frames at 30fps):
- `docs/evidence/startup-flash/01-initial-state.png` - Frame 1: Empty olive background, no content area
- `docs/evidence/startup-flash/02-pre-content.png` - Frame 61: Main area still empty, sidebar rendered
- `docs/evidence/startup-flash/03-loading-state.png` - Frame 62: Column headers appear (#, Title, Artist, Album), loading spinner
- `docs/evidence/startup-flash/04-content-loaded.png` - Frame 74: Content populated with track list

**Timeline analysis:**
- Frames 1-61 (~2 seconds): Empty scaffolding visible
- Frames 62-73 (~0.4 seconds): Loading state with headers but no content
- Frames 74+: Final rendered state

## Expected Behavior

The end user should not see any scaffolding or unstyled components. The app should either:
1. Show nothing (blank/background) until fully ready
2. Show a minimal splash/loading indicator until all components are sized and styled
3. Use CSS techniques to prevent FOUC (Flash of Unstyled Content)

## Technical Considerations

- Consider using `visibility: hidden` or `opacity: 0` on the root container until Alpine.js initializes and styles are computed
- May need to coordinate with Tauri window show/hide to prevent flash
- Could use `x-cloak` directive pattern from Alpine.js
- Ensure all async data (library stats, playlists, etc.) is loaded before reveal
- Test with both cold starts and hot reloads
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 No visible flash of unstyled/unsized content during app startup
- [x] #2 All components are properly sized and styled before becoming visible
- [x] #3 Startup experience feels polished and professional
- [x] #4 Works consistently across cold starts and app restarts
- [x] #5 No regression in startup time (or minimal acceptable increase)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementation (2026-02-04)

### Solution
Implemented a two-part fix to prevent startup flash:

1. **Tauri window visibility**: Set `visible: false` in `tauri.conf.json` to start with a hidden window
2. **CSS cloak**: Added `x-cloak` attribute to body with `visibility: hidden` CSS rule
3. **Programmatic reveal**: Added `revealApp()` function that removes x-cloak and calls `window.show()` after Alpine.js initializes
4. **Permission**: Added `core:window:allow-show` permission to capabilities

### Key learnings
- `requestAnimationFrame` callbacks don't fire when the window is hidden, so `setTimeout` must be used instead
- The Tauri window `show()` method requires explicit permission (`core:window:allow-show`)

### Files changed
- `crates/mt-tauri/tauri.conf.json` - Added `visible: false` to window config
- `crates/mt-tauri/capabilities/default.json` - Added `core:window:allow-show` permission
- `app/frontend/index.html` - Added `x-cloak` to body with special CSS rule for body
- `app/frontend/main.js` - Added `revealApp()` function called via setTimeout after Alpine.start()

### Test results
- Manual testing: Window reveals correctly after Alpine initialization
- E2E tests: 596/597 passed (1 unrelated failure about column reset)
<!-- SECTION:NOTES:END -->
