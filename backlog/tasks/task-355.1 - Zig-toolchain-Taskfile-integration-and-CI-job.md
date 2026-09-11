---
id: TASK-355.1
title: 'Zig toolchain, Taskfile integration, and CI job'
status: Done
assignee: []
created_date: '2026-09-11 00:38'
updated_date: '2026-09-11 21:01'
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
- [x] #6 Both a cold-cache and a warm-cache run of the zig job are measured and the timings recorded on this task
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Follow-up (PR #48, 2026-09-11): the first real CI run showed the `zig` job resolving zig exclusively through `mise which`, but CI installs Zig directly onto PATH via mlugg/setup-zig with no mise present at all. taskfiles/zig.yml's ZIG var now tries mise first, falling back to `command -v zig` on PATH, so the same taskfile works for both mise-managed local dev and PATH-managed CI.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
### Local verification (2026-09-11)

`mise install zig` -> 0.15.2, then all green against the placeholder `zig-core/`:
`task zig:format`, `task zig:lint`, `task zig:test` (1/1 tests passed), `task zig:build`, plus `task zig:cross-compile TARGET=aarch64-macos|x86_64-macos|x86_64-linux|x86_64-windows`. `task --list` shows the six `zig:*` tasks, and root `task format` / `task lint` / `task test` now run the zig step last (the Vitest step in root `task test` fails on 17 pre-existing frontend failures in `context-menu-favorites`, `go-to-album`, `go-to-artist` and `library.store` tests — untouched by this task).

AC#3 was exercised by hand: a pinned version that is not installed, a resolved binary reporting a different version, and `mise` absent from PATH each produce their own error naming the expected version, what was found, and the `mise install zig` fix.

### AC#5/AC#6 CI results and fix (2026-09-11)

The first automatic `pull_request` run on `task-355.1` (run 34644057303) showed the `zig` job **failing** in ~25s: `_check-zig-version` only resolved zig via `mise which`, but the Blacksmith runner has no mise at all — CI installs Zig straight onto PATH via `mlugg/setup-zig@v2`. Fixed in PR #48 (merged as `219c8ef`) by falling back to `command -v zig` when mise can't resolve the pin.

Confirmed via `gh workflow run test.yml --ref main` (workflow_dispatch, twice in a row, same cache key since no source files changed):

- **Cold cache** (run 34646813761): `Cache not found for input keys: zig-build-Linux-0.15.2-...` — zig job completed in **44s** (20:56:32–20:57:16).
- **Warm cache** (run 34647003875): `Cache hit for: zig-build-Linux-0.15.2-...` (and cache hit on the setup-zig tarball too) — zig job completed in **23s** (20:58:45–20:59:08).

Confirmed via `gh run view --json jobs` that `zig` is not in the `needs:` list of `build` or `playwright-tests`, so it does not extend the critical path (AC#5). The pre-existing `Rust Lint, Format, and Test` (clippy) and `Vitest Unit Tests` failures in these runs are unrelated to this task and predate it.
<!-- SECTION:NOTES:END -->
