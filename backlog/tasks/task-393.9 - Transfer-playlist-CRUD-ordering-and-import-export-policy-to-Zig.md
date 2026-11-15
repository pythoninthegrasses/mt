---
id: TASK-393.9
title: 'Transfer playlist CRUD, ordering and import/export policy to Zig'
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
  - crates/mt-core/src/db/playlists.rs
  - crates/mt-tauri/src/commands
  - app/frontend/js/api
documentation:
  - docs/tauri-architecture.md
  - docs/testing.md
parent_task_id: TASK-393
priority: high
type: task
ordinal: 90500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Playlists are a complete bounded domain: creation/rename/delete, membership/order, and current import/export behavior. Zig must own transactions and policy; Tauri file pickers may remain shell capabilities. Do not add smart queries or the deferred Genius approval flow. Existing M3U behavior must not be lost because its code sits outside the DB module. TASK-393 policy: feature freeze, bugfixes allowed; Zig owns application policy and mt.db access, Rust only justified library/platform capabilities. Preserve existing behavior/data; no new product feature or CI benchmark campaign. Read TASK-369.5's ownership ADR and prerequisites, then record a current implementation plan before coding. Transfer all callers of this capability and replace its Rust behavioral tests with focused Zig tests before deleting obsolete implementations. Keep this change to the named domain; record discovered gaps rather than silently port neighboring subsystems.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Current playlist CRUD, membership, duplicate handling and reorder operations are authoritative in Zig and preserve ordering across restart.
- [ ] #2 Existing import/export behavior and path handling are preserved through narrow shell file-dialog/I/O capabilities where justified; importing failure cannot leave a silently partial playlist.
- [ ] #3 Frontend, queue-context and agent playlist persistence callers use engine operations; corresponding Rust playlist SQL/policy and obsolete commands are deleted.
- [ ] #4 Zig tests cover empty playlists, duplicate/missing IDs, reorder bounds, deletion, transaction failure and import/export round trips; UI tests drive creation and play-from-playlist.
- [ ] #5 Committed changes notify existing playlist/library consumers exactly once according to the agreed event contract; API docs and ownership map are updated.
<!-- AC:END -->
