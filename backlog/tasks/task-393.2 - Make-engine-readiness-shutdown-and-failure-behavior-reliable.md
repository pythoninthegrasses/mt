---
id: TASK-393.2
title: 'Make engine readiness, shutdown and failure behavior reliable'
status: To Do
assignee: []
created_date: '2026-11-15T05:32:00Z'
updated_date: '2026-11-15T05:42:00Z'
labels:
  - zig-first
  - migration
dependencies:
  - TASK-393.1
references:
  - crates/mt-tauri/src/sidecar.rs
  - app/frontend/main.js
  - app/frontend/js/api/shared.js
  - zig-core/README.md
documentation:
  - docs/tauri-architecture.md
  - docs/testing.md
  - zig-core/README.md
parent_task_id: TASK-393
priority: high
type: task
ordinal: 83500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The frontend already depends on Zig getTracks without a Rust fallback, while the POC has known startup/lifecycle limitations. Make the existing engine process a trustworthy application dependency using the agreed contract. Rust remains temporary schema initializer until the final database handoff. Excludes new domain endpoints and automatic recovery that replays mutations. TASK-393 policy: feature freeze until Zig-first completion; preserve current behavior and data, permit bugfixes, add no product features. Zig owns domain policy; retained Rust/C libraries expose narrow capabilities. This task owns only the named capability. Read the approved ownership ADR from TASK-369.5 and dependency outputs before starting; record a current implementation plan then. Transfer callers and behavioral coverage with the capability; delete its replaced Rust policy/queries when no caller remains, rather than leave an authoritative duplicate. Do not expand into a benchmark matrix or unrelated subsystem.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Fresh and existing database startup follows the documented temporary migrator order; frontend initialization waits for a verified compatible engine endpoint rather than racing DB creation or using a hardcoded port.
- [ ] #2 Missing binary, timeout, incompatible protocol, malformed runtime file and early child exit yield a bounded visible unavailable state, not an empty successful library or silent Rust fallback.
- [ ] #3 Shutdown releases the child and runtime endpoint; stale endpoint/token files cannot attach a new launch to an unrelated old process, and credentials never appear in logs.
- [ ] #4 Engine death during a request produces a structured unavailable result; any restart policy is bounded and cannot blindly replay non-idempotent mutations.
- [ ] #5 Tests exercise supervision failures and restart/shutdown paths; at least one actual Tauri-webview startup-to-fetch flow is recorded separately from mocked browser evidence.
- [ ] #6 Existing staging/signing behavior is preserved; docs explain readiness, failure recovery and how to diagnose the engine without a new CI benchmark workflow.
- [ ] #7 Runtime endpoint credentials are protected by platform-appropriate permissions, including Windows ACLs or a documented equivalent approved design; local/browser-origin access tests reject unauthorized clients without claiming loopback alone is a security boundary.
<!-- AC:END -->
