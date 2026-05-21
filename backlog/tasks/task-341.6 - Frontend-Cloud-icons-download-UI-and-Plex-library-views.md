---
id: TASK-341.6
title: 'Frontend: Cloud icons, download UI, and Plex library views'
status: To Do
assignee: []
created_date: '2026-05-21 22:58'
labels: []
dependencies:
  - TASK-341.3
  - TASK-341.4
  - TASK-341.5
parent_task_id: TASK-341
ordinal: 58500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add visual indicators and interaction patterns for remote (Plex) tracks in the frontend.

**Cloud icon:**
- Display a cloud icon (basecoat icon) next to track/album/artist names where source='plex'
- Icon should be theme-aware and subtle (not distracting)
- Use existing icon system (check what icons are available in basecoat)

**Context menu:**
- Add 'Download from Plex' option to right-click context menu on remote tracks
- Triggers the same download flow as first-play download
- Shows progress indicator during download

**Library view filters:**
- Add a 'Show Remote' toggle in the library view toolbar
- When toggled off, filters out source='plex' tracks
- Default: show all (both local and remote)

**Plex sidebar section:**
- When Plex is configured, show a 'Plex' section in the sidebar
- Displays albums grouped by artist (flat album list, like cliamp)
- Clicking an album loads its tracks
- Double-clicking a track plays it (triggers download-on-play)

**Key files:**
- `app/frontend/views/library.html` — library view template
- `app/frontend/views/artists.html` — artist view
- `app/frontend/views/albums.html` — album view
- `app/frontend/js/stores/library.js` — library store
- `app/frontend/js/stores/queue.js` — queue store
- `app/frontend/views/sidebar.html` — sidebar navigation
- `app/frontend/views/settings.html` + settings section for Plex

**Design notes:**
- Follow existing basecoat icon patterns
- Cloud icon should be small (12-14px) and positioned consistently
- Download progress should use the existing toast/notification pattern
- The Plex album list should be lazy-loaded (fetch on demand, not at startup)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Cloud icon (basecoat icon) displayed next to track title for remote tracks (source='plex') in library view
- [ ] #2 Cloud icon displayed next to album title in library grid and album browsing view for albums with remote tracks
- [ ] #3 Cloud icon displayed next to artist name in artist view when artist has remote tracks
- [ ] #4 Cloud icon uses theme-aware color (subtle, not distracting)
- [ ] #5 Right-click context menu on remote tracks shows 'Download from Plex' option
- [ ] #6 Clicking 'Download from Plex' triggers download (same flow as first-play download)
- [ ] #7 Download progress shown as inline progress bar or toast notification
- [ ] #8 After download, cloud icon disappears (track is now local)
- [ ] #9 Remote tracks can be filtered out via a 'Show Remote' toggle in the library view toolbar
- [ ] #10 Plex section in sidebar shows album list grouped by artist (flat album list like cliamp)
- [ ] #11 Clicking a Plex album loads and displays its tracks
- [ ] #12 Double-clicking a Plex track plays it (triggers download-on-play)
- [ ] #13 E2E tests for: cloud icon visibility, download from context menu, filter toggle
<!-- AC:END -->
