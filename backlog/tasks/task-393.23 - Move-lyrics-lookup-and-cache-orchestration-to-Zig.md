---
id: TASK-393.23
title: Move lyrics lookup and cache orchestration to Zig
status: To Do
assignee: []
created_date: '2026-11-15T05:36:00Z'
labels:
  - zig-first
  - migration
dependencies:
  - TASK-393.12
  - TASK-393.3
  - TASK-393.5
references:
  - crates/mt-tauri/src/lyrics.rs
  - crates/mt-core/src/db/lyrics.rs
  - TASK-296
documentation:
  - docs/tauri-architecture.md
  - docs/testing.md
parent_task_id: TASK-393
priority: high
type: task
ordinal: 104500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Zig should choose cached versus fetched lyrics and normalize current service outcomes; retained HTTPS/parser primitives must not own a second cache. Port current lyrics behavior only, including instrumental/not-found states. TASK-310's new agent-validation behavior remains frozen and is not a migration requirement. TASK-393 policy: feature freeze, bugfixes allowed, Zig owns domain rules/storage/orchestration; Rust only explicitly justified mature-library or OS capabilities. Preserve current behavior and data, add no deferred feature. Read TASK-369.5's ownership ADR and prerequisite outputs; research and record a bounded implementation plan before coding. Transfer every caller and equivalent behavioral coverage, delete replaced Rust policy and SQL, and update API/ownership docs. Use local fake services for automated tests; no live account, credential dump, paid run or CI timing matrix is required.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Current lyrics lookup, cache use/update, source query normalization and instrumental/not-found/error outcomes are authoritative in Zig.
- [ ] #2 Late lyrics for an older track cannot replace the current track's UI; cancellation and service failure do not poison a valid cached result.
- [ ] #3 Fake-service and Zig tests cover cache hit/miss, synchronized/plain/instrumental payloads as currently supported, malformed response, offline failure and retry.
- [ ] #4 Frontend lyrics consumers use the engine; replaced Rust orchestration/SQL is removed and retained transport/parser justification is explicit.
- [ ] #5 Existing lyrics display is exercised against the engine; docs distinguish current behavior from deferred TASK-310 agent validation.
<!-- AC:END -->
