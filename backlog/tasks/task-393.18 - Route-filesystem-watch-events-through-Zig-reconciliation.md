---
id: TASK-393.18
title: Route filesystem watch events through Zig reconciliation
status: To Do
assignee: []
created_date: '2026-11-15T05:34:00Z'
labels:
  - zig-first
  - migration
dependencies:
  - TASK-393.17
  - TASK-393.7
  - TASK-393.3
references:
  - crates/mt-tauri/src/watcher.rs
  - crates/mt-core/src/db/watched.rs
  - TASK-292
documentation:
  - docs/tauri-architecture.md
  - docs/testing.md
parent_task_id: TASK-393
priority: high
type: task
ordinal: 99500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Filesystem notification libraries may remain Rust capabilities; deciding what a change means for tracks belongs in Zig. Transfer watch lifecycle policy and event interpretation while preserving current debounce/coalescing behavior and settings. Do not create a second scan pipeline or independently mutate the database from Rust callbacks. TASK-393 policy: feature freeze with bugfixes allowed, Zig-first application ownership, no new product features or timing matrices. Read TASK-369.5's ownership ADR and dependency outputs before starting; research then record a bounded implementation plan. Rust may wrap named mature libraries/OS facilities but cannot retain database access or domain orchestration. Port the named capability with caller rewiring, focused behavioral tests, deletion of replaced Rust policy and updated ownership/API docs. Do not silently absorb neighboring subsystems.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The retained watcher exposes OS file events/errors with explicit watch registration/cancellation; Zig interprets/coalesces events and routes changes through its existing scan/reconcile operations.
- [ ] #2 Watched-folder add/remove, rename, rapid create/modify/delete, unavailable source and reconnect/overflow behavior have explicit bounded handling.
- [ ] #3 Callbacks do not perform Rust SQL or domain dedup; duplicate events cannot create duplicate library rows or start unbounded jobs.
- [ ] #4 Tests with fake events cover bursts, overflow/error recovery, cancellation and folder removal; an isolated real filesystem smoke verifies registration and library update.
- [ ] #5 Shutdown unregisters watches and cannot leave callbacks targeting a dead engine; ownership/API docs explain retained notify-library justification.
<!-- AC:END -->
