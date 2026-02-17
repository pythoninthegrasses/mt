---
id: TASK-273.01
title: Add Artists and Albums sidebar navigation items with view routing
status: Done
assignee: []
created_date: '2026-02-16 21:13'
updated_date: '2026-02-17 01:46'
labels:
  - feature
  - ux
dependencies: []
parent_task_id: TASK-273
priority: medium
ordinal: 44500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Context

This is part of the Artist/Album browsing feature (TASK-273). This subtask adds the sidebar entries and view routing plumbing that the Artists and Albums views will use.

## Current State

The sidebar (`app/frontend/js/components/sidebar.js` lines 23-30) has hardcoded sections: Music, Now Playing, Liked Songs, Recently Played, Recently Added, Top 25. View switching uses Alpine.js state in `ui.js` (the `view` property) with `x-show` directives in templates. Valid views are currently: `library`, `queue`, `nowPlaying`, `settings`.

## Requirements

1. Add two new sidebar items in the Library section, positioned after "Music":
   - **Artists** (icon: appropriate music/person icon from the existing icon set)
   - **Albums** (icon: appropriate album/disc icon from the existing icon set)

2. Add two new valid view states to the UI store (`ui.js`):
   - `artists` - for the Artists browsing view
   - `albums` - for the Albums browsing view

3. Clicking "Artists" in sidebar sets `ui.view = 'artists'` and highlights the sidebar item
4. Clicking "Albums" in sidebar sets `ui.view = 'albums'` and highlights the sidebar item
5. "Music" remains the default view on app launch (current behavior unchanged)

6. Add placeholder `x-show` blocks in the main content area for `artists` and `albums` views so the subsequent subtasks can fill them in

## Key Files

- `app/frontend/js/components/sidebar.js` - add new sections
- `app/frontend/views/sidebar.html` - sidebar template
- `app/frontend/js/stores/ui.js` - add new view states
- Main layout template (wherever `x-show` view switching happens)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Artists and Albums items appear in the sidebar below Music
- [x] #2 Clicking Artists switches the main content area to the artists view
- [x] #3 Clicking Albums switches the main content area to the albums view
- [x] #4 Music remains the default view on app launch
- [x] #5 Active sidebar item is visually highlighted for Artists and Albums
- [x] #6 Placeholder content renders for both new views (to be replaced by subtasks 2 and 3)
<!-- AC:END -->
