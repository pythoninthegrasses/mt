---
id: task-249
title: Break up index.html into partials and move inline CSS to styles.css
status: Done
assignee: []
created_date: '2026-01-29 22:57'
updated_date: '2026-01-29 23:12'
labels:
  - frontend
  - refactor
  - html
  - css
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Refactor `app/frontend/index.html` (~1800 lines) into modular HTML partials using `vite-plugin-handlebars`, and migrate inline `<style>` block to `app/frontend/styles.css`.

## Context
- index.html contains one monolithic file with sidebar, library view, queue view, now-playing view, settings view, footer player controls, and modals
- Inline `<style>` block (~215 lines) includes: x-cloak, library scrollbars, context menus, sidebar-no-select, column header/resizer/drag classes, range input styling
- Alpine.js x-data roots: sidebar, libraryBrowser, nowPlayingView, settingsView, playerControls, metadataModal

## Approach
1. Add `vite-plugin-handlebars` as dev dependency
2. Create `app/frontend/views/` directory for partials
3. Extract each major section into a partial file
4. Update `index.html` to include partials via Handlebars syntax
5. Move inline CSS to `styles.css` using Tailwind `@layer components` organization
6. Ensure Basecoat import order is preserved (tailwind -> basecoat -> custom)

## Partials to Create
- `views/sidebar.html` - sidebar navigation and playlists
- `views/library.html` - library browser view with track table
- `views/queue.html` - queue view
- `views/now-playing.html` - now playing view with album art and up-next
- `views/settings.html` - settings view with all sections
- `views/footer.html` - player controls footer
- `views/modals.html` - metadata modal and any overlays

## CSS Migration
Move to `styles.css` with `@layer components`:
- `.library-scroll-container` and scrollbar styles
- `.context-menu`, `.context-menu-item`, `.context-menu-separator`
- `.sidebar-no-select`
- `.column-header-active`, `.sort-indicator`
- `.column-resizer-right`, `.column-resizer-left` and related
- `.column-header-cell` and drag states
- Range input styling (`input[type="range"]`)
- `.library-header-container`, `.resizing-columns`
- `.cursor-grab`

Keep inline only: `[x-cloak] { display: none !important; }` (critical for Alpine hydration)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 vite-plugin-handlebars installed and configured in vite.config.js
- [x] #2 app/frontend/views/ directory created with partial files
- [x] #3 index.html reduced to shell that includes partials
- [x] #4 Inline CSS moved to styles.css except x-cloak rule
- [x] #5 CSS organized with @layer components for reusable classes
- [x] #6 Basecoat import order preserved (tailwind -> basecoat -> custom)
- [x] #7 task npm:test passes
- [x] #8 task test:e2e passes
- [x] #9 No visual regressions in UI
- [x] #10 Alpine.js component bindings (x-data) work correctly after split
- [ ] #11 Hot reload works in development mode
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Completion Summary (2026-01-29)

### Files Created
- `app/frontend/views/sidebar.html` (223 lines)
- `app/frontend/views/library.html` (301 lines)
- `app/frontend/views/queue.html` (52 lines)
- `app/frontend/views/now-playing.html` (108 lines)
- `app/frontend/views/settings.html` (628 lines)
- `app/frontend/views/footer.html` (198 lines)
- `app/frontend/views/modals.html` (372 lines)

### Files Modified
- `app/frontend/index.html`: 2156 → 70 lines (97% reduction)
- `app/frontend/styles.css`: 265 → 474 lines (+209 lines of moved CSS)
- `app/frontend/vite.config.js`: Added vite-plugin-handlebars config
- `app/frontend/package.json`: Added vite-plugin-handlebars dependency

### Test Results
- Build: ✅ Passes (321ms)
- Vitest unit tests: ✅ 213 passed
- Playwright E2E tests: ✅ 595 passed (1.2m)

### Note
AC#11 (hot reload) requires manual verification with `task tauri:dev`
<!-- SECTION:NOTES:END -->
