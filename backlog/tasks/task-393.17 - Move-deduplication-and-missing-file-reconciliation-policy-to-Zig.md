---
id: TASK-393.17
title: Move deduplication and missing-file reconciliation policy to Zig
status: To Do
assignee: []
created_date: '2026-11-15T05:34:00Z'
labels:
  - zig-first
  - migration
dependencies:
  - TASK-393.16
  - TASK-393.10
references:
  - crates/mt-core/src/library
  - crates/mt-core/src/scanner
  - crates/mt-tauri/src/library/reconcile.rs
  - TASK-294
  - TASK-335
  - TASK-360
documentation:
  - docs/tauri-architecture.md
  - docs/testing.md
parent_task_id: TASK-393
priority: high
type: task
ordinal: 98500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Reconciliation and dedup rules are easy to lose if only scanner traversal is ported. Transfer the existing directory-scoped duplicate selection, missing/restored track handling and removed-item suppression policy using Zig storage. This task does not add a new dedup algorithm or delete music files as a side effect. TASK-393 policy: feature freeze with bugfixes allowed, Zig-first application ownership, no new product features or timing matrices. Read TASK-369.5's ownership ADR and dependency outputs before starting; research then record a bounded implementation plan. Rust may wrap named mature libraries/OS facilities but cannot retain database access or domain orchestration. Port the named capability with caller rewiring, focused behavioral tests, deletion of replaced Rust policy and updated ownership/API docs. Do not silently absorb neighboring subsystems.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Existing reconciliation, missing/restored handling, directory-scoped dedup, preference rules and removed-item suppression are authoritative in Zig and persist across runs.
- [ ] #2 Offline/unmounted sources are distinguished from confirmed absence according to current behavior; reappearing sources can recover without a destructive library reset.
- [ ] #3 Tests cover same-directory duplicates, identical content in distinct directories, preference/timestamp ties, removals, reinstatement, idempotence and cancellation/rollback.
- [ ] #4 Real reconciliation runs off the UI thread through the engine and emits consistent progress/revision events; no direct Rust DB calls or equivalent policy remains.
- [ ] #5 No test or implementation unlinks source music unless an existing explicit user-approved deletion action requires it; fixtures verify safe path boundaries.
- [ ] #6 Ownership docs map historical dedup/reconcile regressions to replacement coverage and state the completed scanner/reconciliation boundary.
<!-- AC:END -->
