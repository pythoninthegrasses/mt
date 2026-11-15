---
id: TASK-393.8
title: Transfer favorites and loved-track persistence to Zig
status: To Do
assignee: []
created_date: '2026-11-15T05:33:00Z'
labels:
  - zig-first
  - migration
dependencies:
  - TASK-393.6
  - TASK-393.3
  - TASK-393.5
references:
  - crates/mt-core/src/db/favorites.rs
  - crates/mt-core/src/db/lastfm_loved.rs
  - app/frontend/js/api
documentation:
  - docs/tauri-architecture.md
  - docs/testing.md
parent_task_id: TASK-393
priority: high
type: task
ordinal: 89500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Local favorite membership and persisted Last.fm-loved state should have one database owner. Move their local CRUD and change notification to Zig without implementing Last.fm network synchronization; TASK-393.20 supplies that service later. Include all current UI and background callers, not only context-menu toggles. TASK-393 policy: feature freeze, bugfixes allowed; Zig owns application policy and mt.db access, Rust only justified library/platform capabilities. Preserve existing behavior/data; no new product feature or CI benchmark campaign. Read TASK-369.5's ownership ADR and prerequisites, then record a current implementation plan before coding. Transfer all callers of this capability and replace its Rust behavioral tests with focused Zig tests before deleting obsolete implementations. Keep this change to the named domain; record discovered gaps rather than silently port neighboring subsystems.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Existing favorite and loved-state reads/toggles/bulk updates are handled by Zig, with stable IDs and current local-versus-remote semantics.
- [ ] #2 Mutations publish the expected committed-state event/revision and refresh section results; failed writes do not publish successful state.
- [ ] #3 Rust callers and frontend commands use the engine; obsolete favorite/loved SQL and duplicated rules are deleted.
- [ ] #4 Tests cover idempotent toggles/set operations, duplicates, missing tracks, transaction rollback and state after reopen; favorite UI behavior is exercised against the engine.
- [ ] #5 Last.fm network behavior is unchanged and explicitly remains assigned to TASK-393.20 until its port; docs explain this temporary boundary.
<!-- AC:END -->
