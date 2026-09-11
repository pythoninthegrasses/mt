---
id: TASK-355.1
title: 'Zig toolchain, Taskfile integration, and CI job'
status: To Do
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
- [ ] #1 zig 0.15.2 is pinned in .tool-versions
- [ ] #2 taskfiles/zig.yml provides format, lint, test, build, and cross-compile tasks following the structure of taskfiles/cargo.yml
- [ ] #3 A missing or version-mismatched zig installation fails with an actionable error message rather than silently using the wrong binary
- [ ] #4 task lint, task format, and task test invoke the Zig equivalents alongside the existing Rust and Deno ones
- [ ] #5 A new zig CI job runs on a Blacksmith Linux runner in parallel with the existing rust job and does not extend the critical path
- [ ] #6 Both a cold-cache and a warm-cache run of the zig job are measured and the timings recorded on this task
<!-- AC:END -->
