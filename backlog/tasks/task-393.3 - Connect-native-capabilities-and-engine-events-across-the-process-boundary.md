---
id: TASK-393.3
title: Connect native capabilities and engine events across the process boundary
status: To Do
assignee: []
created_date: '2026-11-15T05:32:00Z'
labels:
  - zig-first
  - migration
dependencies:
  - TASK-393.1
  - TASK-393.2
references:
  - crates/mt-tauri/src/events.rs
  - crates/mt-tauri/src/sidecar.rs
  - app/frontend/js/api/shared.js
documentation:
  - docs/tauri-architecture.md
  - docs/testing.md
  - zig-core/README.md
parent_task_id: TASK-393
priority: high
type: task
ordinal: 84500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Zig cannot own orchestration while retained Rust libraries can only be called from Tauri UI commands. Provide the generic private adapter request/event plumbing fixed by the ADR, with a fake capability for contract tests. This is transport wiring, not audio/scanner/agent implementation. Frontend events must have one authority and tolerate reconnect gaps. TASK-393 policy: feature freeze until Zig-first completion; preserve current behavior and data, permit bugfixes, add no product features. Zig owns domain policy; retained Rust/C libraries expose narrow capabilities. This task owns only the named capability. Read the approved ownership ADR from TASK-369.5 and dependency outputs before starting; record a current implementation plan then. Transfer callers and behavioral coverage with the capability; delete its replaced Rust policy/queries when no caller remains, rather than leave an authoritative duplicate. Do not expand into a benchmark matrix or unrelated subsystem.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Zig can invoke an allowlisted Rust capability through the agreed private boundary and receive a correlated success/error without requiring a browser or a database connection in the adapter.
- [ ] #2 Capability calls handle timeout, cancellation, child exit, malformed input and concurrent requests without deadlock or unbounded pending work.
- [ ] #3 Engine domain events reach the frontend through one documented path with revision/order and snapshot resynchronization after reconnect; do not create duplicate Tauri and direct subscriptions for the same event.
- [ ] #4 Authentication, local binding and operation allowlisting apply in both directions; arbitrary command execution and arbitrary filesystem access are not exposed as generic capabilities.
- [ ] #5 A fake adapter plus frontend event tests prove request correlation, cancellation, duplicate/out-of-order handling and reconnect recovery; docs include how domain workers register a capability or event.
- [ ] #6 No domain state machine, SQL, audio-device policy or service orchestration is moved into the generic bridge.
<!-- AC:END -->
