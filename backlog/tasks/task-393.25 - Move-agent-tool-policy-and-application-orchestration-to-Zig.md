---
id: TASK-393.25
title: Move agent tool policy and application orchestration to Zig
status: To Do
assignee: []
created_date: '2026-11-15T05:36:00Z'
labels:
  - zig-first
  - migration
dependencies:
  - TASK-393.5
  - TASK-393.9
  - TASK-393.20
  - TASK-393.23
  - TASK-393.3
references:
  - crates/mt-tauri/src/agent
  - docs/agent.md
  - docs/genius.md
  - TASK-310
  - TASK-311
documentation:
  - docs/tauri-architecture.md
  - docs/testing.md
parent_task_id: TASK-393
priority: high
type: task
ordinal: 106500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The optional agent/rig-core integration is not a blanket Rust exception. Preserve current generate-playlist behavior with Zig owning tool authorization/dispatch, library access, playlist rules and application workflow. Rust may retain narrowly specified SDK/provider capabilities whose replacement would require substantial handrolling. Deferred preview/refine/approve and lyrics-validation features are out of scope. TASK-393 policy: feature freeze, bugfixes allowed, Zig owns domain rules/storage/orchestration; Rust only explicitly justified mature-library or OS capabilities. Preserve current behavior and data, add no deferred feature. Read TASK-369.5's ownership ADR and prerequisite outputs; research and record a bounded implementation plan before coding. Transfer every caller and equivalent behavioral coverage, delete replaced Rust policy and SQL, and update API/ownership docs. Use local fake services for automated tests; no live account, credential dump, paid run or CI timing matrix is required.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Current optional-agent workflows use Zig for library queries, tool authorization/dispatch, validation, track selection/postprocessing and playlist persistence; retained rig-core/provider behavior is narrowly justified in the ADR.
- [ ] #2 Agent tools and eval utilities no longer open SQLite or apply hidden Rust playlist policy; tool calls cross the approved contract with bounded cancellation/errors.
- [ ] #3 Deterministic fake-provider tests cover valid/malformed responses, invalid track IDs, tool rejection, provider failure and cancellation without needing Ollama or a paid service.
- [ ] #4 Current one-shot Genius behavior is preserved without adding TASK-310/311 features; UI integration covers success/error through the engine.
- [ ] #5 Default builds still work without the optional agent capability and enabling it preserves current functionality; deleted Rust orchestration/tests have mapped replacements and agent docs explain the final boundary.
<!-- AC:END -->
