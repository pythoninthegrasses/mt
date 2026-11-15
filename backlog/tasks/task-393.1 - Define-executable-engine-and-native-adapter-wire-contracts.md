---
id: TASK-393.1
title: Define executable engine and native-adapter wire contracts
status: To Do
assignee: []
created_date: '2026-11-15T05:32:00Z'
labels:
  - zig-first
  - migration
dependencies:
  - TASK-369.5
references:
  - app/frontend/js/api/shared.js
  - crates/mt-tauri/src/sidecar.rs
  - TASK-355.6
documentation:
  - docs/tauri-architecture.md
  - docs/testing.md
  - zig-core/README.md
parent_task_id: TASK-393
priority: high
type: task
ordinal: 82500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The working POC exposes only one HTTP read. Independent subsystem workers need a single documented request, response, error and event contract, including Rust capability calls, before adding routes. This task defines and validates the boundary chosen by the ADR, not a new transport research project. Excludes implementing process supervision or porting domain operations. TASK-393 policy: feature freeze until Zig-first completion; preserve current behavior and data, permit bugfixes, add no product features. Zig owns domain policy; retained Rust/C libraries expose narrow capabilities. This task owns only the named capability. Read the approved ownership ADR from TASK-369.5 and dependency outputs before starting; record a current implementation plan then. Transfer callers and behavioral coverage with the capability; delete its replaced Rust policy/queries when no caller remains, rather than leave an authoritative duplicate. Do not expand into a benchmark matrix or unrelated subsystem.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A versioned contract covers frontend engine requests and engine-to-Rust capability calls using the transport fixed by the ADR; schemas/examples define envelope, correlation, errors, cancellation and event revision semantics.
- [ ] #2 Contracts explicitly define null versus absent fields, booleans, paths, query encoding, ID/timestamp precision across JavaScript, and structured failure responses; no silent i64 precision loss.
- [ ] #3 Shared fixtures cover valid and malformed messages, unknown operations/versions, empty lists, non-ASCII text, large IDs and error responses; Zig and Rust boundary codecs plus frontend decoding validate their relevant fixtures.
- [ ] #4 Runtime credentials are local-only, redacted and never accepted via an unauthenticated adapter operation; limits and timeout ownership are documented without exposing a LAN server.
- [ ] #5 The protocol document and ownership ADR name which later task supplies supervision and adapter/event plumbing; existing getTracks remains functional with no new business routes.
<!-- AC:END -->
