---
id: TASK-393.30
title: Move metadata-edit workflows and database reconciliation to Zig
status: To Do
assignee: []
created_date: '2026-11-15T05:41:00Z'
labels:
  - zig-first
  - migration
dependencies:
  - TASK-393.15
  - TASK-393.10
  - TASK-393.29
  - TASK-393.3
references:
  - crates/mt-core/src/metadata
  - crates/mt-tauri/src/metadata.rs
  - app/frontend/js/api
  - TASK-384
documentation:
  - docs/tauri-architecture.md
  - docs/testing.md
parent_task_id: TASK-393
priority: high
type: task
ordinal: 111500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Metadata primitives alone do not transfer the application workflow for editing tags. Zig must validate existing edit operations, invoke the approved Rust lofty capability, reconcile successful changes into library storage and invalidate shared artwork/metadata results. This task preserves current inline/batch metadata-edit behavior; do not add tagging formats or new editing UI. TASK-393 feature freeze applies; research current callers and record an implementation plan at start. Scope excludes scanner traversal, codec implementation and a new filesystem transaction framework. Existing data/music files remain valuable despite the greenfield project; partial failures must be explicit.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Existing single/batch metadata edits are orchestrated by Zig using explicit track/source identities and validated fields; Rust only reads/writes tags through the approved primitive boundary.
- [ ] #2 A failed file/tag write cannot be reported as a successful database edit; partial batch and file-success/DB-failure outcomes are explicit, recoverable and tested without pretending file+SQL changes are one atomic transaction.
- [ ] #3 Successful edits update Zig-owned library state/revision and invalidate positive/negative shared artwork/metadata results so views refresh consistently.
- [ ] #4 Tests cover supported fields/formats, invalid values, unreadable/read-only files, partial failure, cancellation, retry/reconciliation and stable IDs using disposable fixtures.
- [ ] #5 Frontend and background callers use the engine workflow; superseded Rust metadata policy/SQL and duplicate frontend reconciliation are removed while adapter format tests remain.
- [ ] #6 One real metadata-edit/refresh flow is recorded; ownership/API docs state write failure/recovery behavior and identify deleted application logic.
<!-- AC:END -->
