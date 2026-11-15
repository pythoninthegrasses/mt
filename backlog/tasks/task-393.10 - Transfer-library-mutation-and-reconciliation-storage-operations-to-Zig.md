---
id: TASK-393.10
title: Transfer library mutation and reconciliation storage operations to Zig
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
  - crates/mt-core/src/db/library.rs
  - crates/mt-core/src/db/removed.rs
  - crates/mt-core/src/db/dedup.rs
  - crates/mt-core/src/db/revision.rs
  - crates/mt-tauri/src/library/reconcile.rs
documentation:
  - docs/tauri-architecture.md
  - docs/testing.md
parent_task_id: TASK-393
priority: high
type: task
ordinal: 91500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Scanner and reconciliation ports cannot delete Rust DB access until the engine supplies atomic track upsert/remove/missing/restore operations, removed identifiers, dedup persistence and revision handling. This task transfers the storage-facing capability, not filesystem traversal or the dedup selection algorithm. File deletion itself must remain explicit and bounded; do not equate removing a library entry with deleting music files. TASK-393 policy: feature freeze, bugfixes allowed; Zig owns application policy and mt.db access, Rust only justified library/platform capabilities. Preserve existing behavior/data; no new product feature or CI benchmark campaign. Read TASK-369.5's ownership ADR and prerequisites, then record a current implementation plan before coding. Transfer all callers of this capability and replace its Rust behavioral tests with focused Zig tests before deleting obsolete implementations. Keep this change to the named domain; record discovered gaps rather than silently port neighboring subsystems.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Zig owns current track upsert/update/remove/missing/restore, removed-track identifiers, persisted dedup decisions and library revision operations with the current transaction semantics.
- [ ] #2 Batch mutation results identify committed changes/failures; rollback never publishes a successful library revision, and retries cannot silently duplicate rows.
- [ ] #3 Existing Rust scanner/reconcile/metadata/remote callers use bounded engine operations instead of direct SQL for the transferred writes; duplicate query implementations are deleted.
- [ ] #4 Tests cover ID stability, duplicate paths, local/remote identifiers, missing/restored sources, persisted removed suppression, FK effects and transaction rollback.
- [ ] #5 Destructive filesystem actions remain separately authorized and scoped; SQL removal does not unexpectedly unlink source files.
- [ ] #6 Docs describe the write API consumed by later scan/reconcile tasks and map any remaining Rust DB caller to a specific pending task.
<!-- AC:END -->
