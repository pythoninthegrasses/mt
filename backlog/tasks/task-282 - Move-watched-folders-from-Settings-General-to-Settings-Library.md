---
id: TASK-282
title: Move watched folders from Settings > General to Settings > Library
status: In Progress
assignee: []
created_date: '2026-02-20 21:22'
updated_date: '2026-02-20 21:28'
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
- [ ] #1 Watched folders UI is the first section in Settings > Library
- [ ] #2 Watched folders functionality works identically after the move (add, remove, scan)
- [ ] #3 Settings > General displays a user-facing TBD note (e.g. 'More settings coming soon')
- [ ] #4 Settings > General no longer contains the watched folders section
- [ ] #5 Existing tests pass without modification or are updated to reflect the new settings layout
- [ ] #6 E2E tests cover watched folders functionality within Settings > Library (add, remove, scan)
<!-- AC:END -->
