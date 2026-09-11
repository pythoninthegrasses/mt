---
id: TASK-355.1
title: 'Zig toolchain, Taskfile integration, and CI job'
status: In Progress
assignee: []
created_date: '2026-09-11 00:38'
labels: []
dependencies: []
parent_task_id: TASK-355
type: task
ordinal: 58500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The Zig toolchain must be reproducibly available to both local developers and CI, and it currently is not: running `which zig` on the reference dev machine resolves to a copy bundled with a VS Code extension, and the repo's root taskfile.yml deliberately strips globalStorage paths from PATH (to avoid exactly this kind of accidental tool resolution), so any task invoking zig today would fail or silently use an unpinned, unmanaged binary. This subtask establishes Zig 0.15.2 as a properly pinned, mise-managed toolchain and wires it into the existing Taskfile conventions (see taskfiles/cargo.yml for the pattern to follow) plus a new parallel CI job.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 zig 0.15.2 is pinned in .tool-versions
- [x] #2 taskfiles/zig.yml provides format, lint, test, build, and cross-compile tasks following the structure of taskfiles/cargo.yml
- [x] #3 A missing or version-mismatched zig installation fails with an actionable error message rather than silently using the wrong binary
- [x] #4 task lint, task format, and task test invoke the Zig equivalents alongside the existing Rust and Deno ones
- [x] #5 A new zig CI job runs on a Blacksmith Linux runner in parallel with the existing rust job and does not extend the critical path
- [ ] #6 Both a cold-cache and a warm-cache run of the zig job are measured and the timings recorded on this task
<!-- AC:END -->

## Plan
<!-- SECTION:PLAN:BEGIN -->
See PROMPT.md decisions on the branch: `zig-core/` placeholder executable (no SQLite/HTTP — that is TASK-355.2), zig resolved through mise against the pinned version rather than PATH, and a standalone `zig` CI job that no other job depends on.
<!-- SECTION:PLAN:END -->

## Notes
<!-- SECTION:NOTES:BEGIN -->
### Local verification (2026-09-11)

`mise install zig` -> 0.15.2, then all green against the placeholder `zig-core/`:
`task zig:format`, `task zig:lint`, `task zig:test` (1/1 tests passed), `task zig:build`, plus `task zig:cross-compile TARGET=aarch64-macos|x86_64-macos|x86_64-linux|x86_64-windows`. `task --list` shows the six `zig:*` tasks, and root `task format` / `task lint` / `task test` now run the zig step last (the Vitest step in root `task test` fails on 17 pre-existing frontend failures in `context-menu-favorites`, `go-to-album`, `go-to-artist` and `library.store` tests — untouched by this task).

AC#3 was exercised by hand: a pinned version that is not installed, a resolved binary reporting a different version, and `mise` absent from PATH each produce their own error naming the expected version, what was found, and the `mise install zig` fix.

### AC#6 still open — needs a push

Cold/warm cache timings cannot be measured from this unpushed worktree. The job caches `zig-core/.zig-cache` and `zig-core/zig-out` under a key of runner OS + pinned version + `hashFiles(build.zig, build.zig.zon, src/**/*.zig, .tool-versions)`, so the measurement is ready to take: push this branch, run the `zig` job twice (first run cold, second warm with unchanged inputs), and record both durations from the Actions UI here.
<!-- SECTION:NOTES:END -->
