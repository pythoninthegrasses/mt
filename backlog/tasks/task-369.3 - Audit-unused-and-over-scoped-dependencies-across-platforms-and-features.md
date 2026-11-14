---
id: TASK-369.3
title: Audit unused and over-scoped dependencies across platforms and features
status: To Do
assignee: []
created_date: '2026-11-14T04:24:00Z'
updated_date: '2026-11-14T04:24:00Z'
labels: []
dependencies:
  - TASK-361
references:
  - 'https://doc.rust-lang.org/cargo/reference/lints.html#unused_dependencies'
documentation:
  - docs/builds.md
parent_task_id: TASK-369
type: task
ordinal: 2000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
mt-tauri declares ~50 direct dependencies plus dev-dependencies (tempfile, proptest, wiremock) against a 1443-normal-dep graph, and some may be dead or platform-misplaced after recent refactors (e.g. raw-window-handle and windows-sys exist only for the Windows souvlaki HWND path). Rust 1.100's cargo::unused_dependencies lint was adopted by TASK-361 but found NOT to fire on mt-tauri at all (bin/lib target shapes suppress it), so this audit must use TASK-361's documented fallback (cargo rustc -p mt-tauri --lib -- -W unused-crate-dependencies) plus CARGO_LOG=cargo::diagnostics::rules::unused_dependencies=debug cargo check --workspace --all-targets for dev-dependencies, and must be repeated per platform (macOS, Linux, Windows) and per optional feature (default, agent, mcp, devtools) because a dep unused on one platform can be load-bearing on another. Removals that survive all matrices land with a green CI run.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Fallback lint run per platform and per feature; findings recorded in task notes including dev-dependency results from the CARGO_LOG debug path
- [ ] #2 Every flagged dependency either removed in a commit or annotated with the platform/feature that requires it
- [ ] #3 False-positive classes documented (feature-activation deps, cfg-gated deps) so a future rerun does not re-litigate them
- [ ] #4 cargo tree -e normal | wc -l recorded before and after; docs/builds.md notes the final count
- [ ] #5 task lint, task test, and CI green after removals
<!-- AC:END -->
