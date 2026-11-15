---
id: TASK-393.27
title: Remove transitional Rust domain code and enforce the final ownership boundary
status: To Do
assignee: []
created_date: '2026-11-15T05:36:00Z'
labels:
  - zig-first
  - migration
dependencies:
  - TASK-393.26
  - TASK-393.19
  - TASK-393.22
  - TASK-393.24
  - TASK-393.25
  - TASK-369.12
references:
  - crates/mt-core
  - crates/mt-tauri/src
  - app/frontend/js/api
  - docs/tauri-architecture.md
  - AGENTS.md
documentation:
  - docs/tauri-architecture.md
  - docs/testing.md
parent_task_id: TASK-393
priority: high
type: task
ordinal: 108500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Ports can leave unused implementations, proxies and test-only production paths that make Rust the engine by inertia. Audit the entire ownership inventory after capability transfers. Remove transitional Rust domain code, obsolete commands, shadow comparisons and dependencies; retain or rename mt-core only for real approved adapter capabilities. This is cleanup of already-transferred behavior, not a catch-all rewrite of unported domains. TASK-393 policy: feature freeze, bugfixes allowed, Zig owns domain rules/storage/orchestration; Rust only explicitly justified mature-library or OS capabilities. Preserve current behavior and data, add no deferred feature. Read TASK-369.5's ownership ADR and prerequisite outputs; research and record a bounded implementation plan before coding. Transfer every caller and equivalent behavioral coverage, delete replaced Rust policy and SQL, and update API/ownership docs. Use local fake services for automated tests; no live account, credential dump, paid run or CI timing matrix is required.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Every row in TASK-369.5's ownership map is resolved to Zig, Tauri shell or a named justified adapter; any missed domain capability blocks completion and gets an explicit bounded task rather than being hidden in cleanup.
- [ ] #2 Unused Rust domain modules, obsolete Tauri commands/proxies, shadow-diff runtime code and duplicate frontend business logic are removed with caller/test mappings; no silent legacy engine fallback remains.
- [ ] #3 Retained Rust adapters have no SQL, queue/scrobble/playlist rules or application schedulers; dependency-boundary checks cover the agreed forbidden ownership.
- [ ] #4 mt-core is removed or deliberately repurposed/renamed for justified capability code; Cargo/task/docs references and optional agent/devtools/mcp paths remain coherent.
- [ ] #5 Focused Zig/Rust/frontend suites and build checks pass with removed code; test deletions are justified by replacement coverage, not lower test counts alone.
- [ ] #6 AGENTS.md, architecture, development, build, testing and service docs describe the actual Zig-first tree and point to the final acceptance gate; no new benchmark campaign is required.
<!-- AC:END -->
