---
id: TASK-368
title: Show remote toggle does not hide remote tracks in the paginated library view
status: To Do
assignee: []
created_date: '2026-11-14T03:15:00Z'
labels:
  - plex
  - library
  - frontend
dependencies: []
references:
  - app/frontend/js/stores/library.js
  - app/frontend/js/utils/library-operations.js
  - app/frontend/views/settings-plex.html
  - app/frontend/tests/plex.spec.js
priority: medium
ordinal: 71500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
With the library on the paginated path (`_sectionTracks === null`), turning off Show remote (Settings > Plex) sets `library.showRemote = false` and `filteredTracks` excludes remote tracks, but the rendered rows still include them. `getTrackAtIndex` reads raw `_trackPages` without applying `showRemote`; the filter in `_filterByLibrary` only runs when a non-paginated section loads. Evidence: probe spec toggled off, returned to Music, and found showRemote=false, paginated=true, filtered=0, pages=[0], row 9001 still in the DOM (16/16 runs under load). The Playwright test `plex.spec.js` "Show remote toggle hides fully-remote tracks" fails ~50% under parallel load, passing only when a section reload happens to re-filter. Decide between filtering in the render path (getTrackAtIndex, totalTracks and the page cache) and passing showRemote to the backend query, then fix and keep the existing Playwright test as the regression check.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Turning off Show remote hides remote tracks in the paginated Music view without requiring a section reload
- [ ] #2 Turning Show remote back on restores them
- [ ] #3 totalTracks, scroll height and selection ranges stay consistent while remote tracks are hidden
- [ ] #4 app/frontend/tests/plex.spec.js 'Show remote toggle hides fully-remote tracks' passes 16/16 with --repeat-each=16 --workers=8 in webkit
<!-- AC:END -->
