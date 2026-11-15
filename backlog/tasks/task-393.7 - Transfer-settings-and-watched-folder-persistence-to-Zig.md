---
id: TASK-393.7
title: Transfer settings and watched-folder persistence to Zig
status: To Do
assignee: []
created_date: '2026-11-15T05:33:00Z'
labels:
  - zig-first
  - migration
dependencies:
  - TASK-393.6
  - TASK-393.3
references:
  - crates/mt-core/src/db/settings.rs
  - crates/mt-core/src/db/watched.rs
  - app/frontend/js/api
documentation:
  - docs/tauri-architecture.md
  - docs/testing.md
parent_task_id: TASK-393
priority: high
type: task
ordinal: 88500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Settings and watched-folder configuration are a bounded first writable domain. Zig owns typed defaults, validation and persistence. Rust may still resolve platform directories or supply OS capabilities; it must not keep a competing settings DB. Filesystem watcher behavior is a separate task. Preserve the distinction between application settings and any retained Tauri-only window state. TASK-393 policy: feature freeze, bugfixes allowed; Zig owns application policy and mt.db access, Rust only justified library/platform capabilities. Preserve existing behavior/data; no new product feature or CI benchmark campaign. Read TASK-369.5's ownership ADR and prerequisites, then record a current implementation plan before coding. Transfer all callers of this capability and replace its Rust behavioral tests with focused Zig tests before deleting obsolete implementations. Keep this change to the named domain; record discovered gaps rather than silently port neighboring subsystems.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Existing setting reads/writes, defaults and watched-folder add/remove/list operations are authoritative in Zig and persist across restart.
- [ ] #2 Frontend, startup and background callers use the engine; no direct Rust SQL remains for these domains, and any shell-only state exception is documented.
- [ ] #3 Invalid setting values, duplicate folders, absent paths and write failures preserve existing explicit behavior without corrupting saved settings.
- [ ] #4 Zig tests cover defaults, round trips, duplicate/removal behavior, rollback and reopening existing data; frontend tests cover failure propagation.
- [ ] #5 Existing settings UI and watched-folder configuration work against the real engine; docs and ownership inventory list removed Rust code and retained shell-only state.
<!-- AC:END -->
