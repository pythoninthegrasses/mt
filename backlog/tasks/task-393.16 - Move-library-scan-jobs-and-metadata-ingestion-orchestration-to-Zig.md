---
id: TASK-393.16
title: Move library scan jobs and metadata ingestion orchestration to Zig
status: To Do
assignee: []
created_date: '2026-11-15T05:34:00Z'
labels:
  - zig-first
  - migration
dependencies:
  - TASK-393.15
  - TASK-393.10
  - TASK-393.7
  - TASK-393.3
references:
  - crates/mt-core/src/scanner
  - crates/mt-tauri/src/scanner
  - crates/mt-tauri/src/commands
  - app/frontend/js/api
documentation:
  - docs/tauri-architecture.md
  - docs/testing.md
parent_task_id: TASK-393
priority: high
type: task
ordinal: 97500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The scan pipeline chooses files, schedules metadata extraction and commits library changes; these are domain responsibilities even when lofty remains Rust. Port current full/add-folder scan job behavior, bounded work, progress and cancellation. Reconciliation/dedup policy and watch event handling are assigned to TASK-393.17/.18; do not rewrite them opportunistically. TASK-393 policy: feature freeze with bugfixes allowed, Zig-first application ownership, no new product features or timing matrices. Read TASK-369.5's ownership ADR and dependency outputs before starting; research then record a bounded implementation plan. Rust may wrap named mature libraries/OS facilities but cannot retain database access or domain orchestration. Port the named capability with caller rewiring, focused behavioral tests, deletion of replaced Rust policy and updated ownership/API docs. Do not silently absorb neighboring subsystems.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Zig owns scan job creation, traversal/filtering, bounded metadata-adapter work, progress, cancellation and batched library ingestion for existing supported sources.
- [ ] #2 Unreadable directories/files, symlink behavior, malformed metadata and cancellation preserve current explicit outcomes; no successful scan is reported before committed batches complete.
- [ ] #3 Rust scanning callers use the engine; replaced orchestration and direct DB access are removed, with remaining reconciliation/watcher logic assigned to its task.
- [ ] #4 Tests use isolated directory/audio fixtures for nested traversal, duplicate submissions, partial errors, cancellation and stable track IDs; metadata-adapter failures are deterministic.
- [ ] #5 A real add-folder/full scan emits progress and updates the frontend through the engine; no private library or live remote host is needed for automated tests.
- [ ] #6 Docs state concurrency/batching limits and the boundary with dedup/reconcile; no new scanner feature or indexing scheme is introduced.
<!-- AC:END -->
