---
id: TASK-282
title: Move watched folders from Settings > General to Settings > Library
status: Done
assignee: []
created_date: '2026-02-20 21:22'
updated_date: '2026-02-20 23:20'
labels:
  - ui
  - settings
dependencies: []
references:
  - app/frontend/js/stores/queue.js
  - src-tauri/src/
priority: high
ordinal: 1000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The "Watched Folders" section currently lives under Settings > General. It belongs under Settings > Library since it directly relates to library management (scanning, indexing, monitoring music directories).

Consolidate watched folders as the **first item** in Settings > Library. After moving, leave Settings > General with a user-facing note indicating it is TBD (placeholder for future general settings).

This is a UI reorganization task — the underlying watched folders functionality and Rust backend remain unchanged.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Watched folders UI is the first section in Settings > Library
- [x] #2 Watched folders functionality works identically after the move (add, remove, scan)
- [x] #3 Settings > General displays a user-facing TBD note (e.g. 'More settings coming soon')
- [x] #4 Settings > General no longer contains the watched folders section
- [x] #5 Existing tests pass without modification or are updated to reflect the new settings layout
- [x] #6 E2E tests cover watched folders functionality within Settings > Library (add, remove, scan)
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Moved watched folders UI from Settings > General to Settings > Library as the first section. Settings > General now shows a \"More settings coming soon\" placeholder. Updated all 26 E2E tests in watched-folders.spec.js to navigate to Settings > Library instead of General. All tests pass (26 watched-folders + 45 settings/library-settings).\n\nFiles changed:\n- app/frontend/views/settings.html\n- app/frontend/tests/watched-folders.spec.js
<!-- SECTION:FINAL_SUMMARY:END -->
