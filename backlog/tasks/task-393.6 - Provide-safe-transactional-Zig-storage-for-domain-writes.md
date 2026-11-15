---
id: TASK-393.6
title: Provide safe transactional Zig storage for domain writes
status: To Do
assignee: []
created_date: '2026-11-15T05:33:00Z'
labels:
  - zig-first
  - migration
dependencies:
  - TASK-354
  - TASK-393.1
  - TASK-393.2
references:
  - crates/mt-core/src/db
  - zig-core/README.md
documentation:
  - docs/tauri-architecture.md
  - docs/testing.md
parent_task_id: TASK-393
priority: high
type: task
ordinal: 87500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The POC opens SQLite read-only. Subsequent domain ports need a tested writable foundation, not ad hoc SQL or a separate migration owner per subsystem. This task adds write/transaction capability while Rust remains the sole schema migrator until TASK-393.26. Different processes may temporarily write different unported domains; never run competing migrations or duplicate one operation in both engines. TASK-393 policy: feature freeze, bugfixes allowed; Zig owns application policy and mt.db access, Rust only justified library/platform capabilities. Preserve existing behavior/data; no new product feature or CI benchmark campaign. Read TASK-369.5's ownership ADR and prerequisites, then record a current implementation plan before coding. Transfer all callers of this capability and replace its Rust behavioral tests with focused Zig tests before deleting obsolete implementations. Keep this change to the named domain; record discovered gaps rather than silently port neighboring subsystems.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Writable Zig storage checks the required schema version and uses the agreed connection/locking/foreign-key/busy-timeout policy without creating a second schema migrator.
- [ ] #2 Transactions commit atomically and roll back on SQL failure, cancellation and allocation failure; statements/connections are finalized and freed on every tested path.
- [ ] #3 Concurrent reads and bounded writes against an isolated DB exercise busy/locked outcomes and return structured retryable errors rather than deadlock, partial success or silent row loss.
- [ ] #4 Reusable binding and row-mapping coverage includes nulls, Unicode paths, blobs, large integer IDs and timestamps without truncation.
- [ ] #5 No product domain is ported here; tests use a small disposable domain/fixture, not the user's mt.db; docs state temporary per-domain ownership and final handoff requirements.
<!-- AC:END -->
