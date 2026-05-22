---
id: TASK-336
title: 'Follow up to PR #44: reduce remaining duplication and complexity hotspots'
status: Done
assignee: []
created_date: '2026-04-29 04:19'
updated_date: '2026-05-04 04:16'
labels:
  - refactor
  - complexity
  - tech-debt
dependencies:
  - TASK-336.1
  - TASK-336.2
  - TASK-336.3
references:
  - 'https://github.com/pythoninthegrass/mt/commit/4ba8be8'
  - 'https://github.com/pythoninthegrass/mt/pull/44'
priority: medium
ordinal: 5500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
PR #44 (`4ba8be8`, "refactor: reduce complexity of codebase") removed ~485 LOC of mechanical duplication via two extractions: `tool_def()` in `crates/mt-tauri/src/agent/tools.rs` and `tauriInvoke()` in `app/frontend/js/api/shared.js`.

A follow-up audit (largest files, largest functions, duplicated patterns, dead code) identified another ~330 LOC of mechanical wins across the Rust backend, JS frontend, and CI/test scaffolding. This parent task tracks that follow-up effort. Each child task is independently reviewable and lands as its own PR.

The work is intentionally scoped to mechanical, low-risk extractions that reuse helpers that already exist (`Database::with_conn` at `crates/mt-tauri/src/db/mod.rs:190`, `row_to_track` in `crates/mt-tauri/src/db/library.rs`, `tauriInvoke` in `app/frontend/js/api/shared.js`). Out of scope: splitting the giant Rust files (`db/library.rs` 3374 LOC, `db/queue.rs` 2292 LOC, `library/commands.rs` 1798 LOC) and `components/settings-view.js` (1108 LOC) — those are wide rather than tangled, and structural splits are deferred until there's specific pressure.

This task is complete when all three child tasks are merged and the workspace remains green on `task lint`, `task format`, `task test`, and `task tauri:build`.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 All three child tasks are completed and merged
- [x] #2 Total LOC reduction across the three PRs is ≥250 LOC (target ~330)
- [x] #3 task lint, task format, task test all pass on main after final child merges
- [x] #4 task tauri:build (or cargo check at minimum) succeeds on main after final child merges
- [x] #5 No behavior changes are introduced — refactor-only
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
All three child tasks (336.1, 336.2, 336.3) merged to main and archived. Total gross deletions: ~584 LOC (253 Rust + 130 JS + 201 test/build), clearing the ≥250 target. CI green on main throughout. Refactor-only — no behavior changes.
<!-- SECTION:FINAL_SUMMARY:END -->
