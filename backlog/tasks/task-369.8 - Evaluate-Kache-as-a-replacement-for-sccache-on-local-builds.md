---
id: TASK-369.8
title: Evaluate Kache as a replacement for sccache on local builds
status: To Do
assignee: []
created_date: '2026-11-14T05:43:00Z'
updated_date: '2026-11-14T05:43:00Z'
labels:
  - build-perf
dependencies:
  - TASK-369.1
references:
  - 'https://github.com/kunobi-ninja/kache'
  - >-
    https://github.com/kunobi-ninja/kache/blob/main/docs/getting-started/comparison.mdx
  - >-
    https://github.com/kunobi-ninja/kache/blob/main/docs/getting-started/worktrees.mdx
  - 'https://github.com/kunobi-ninja/kache/issues/1887'
  - 'https://ninja.kunobi.com/docs/kache/benchmarks'
documentation:
  - docs/builds.md
  - benchmarks/edit-to-run/README.md
parent_task_id: TASK-369
priority: medium
type: spike
ordinal: 73500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
mt pins `RUSTC_WRAPPER=sccache` (taskfile.yml, taskfiles/cargo.yml install-sccache) and sccache 0.18.0 sits behind the dev loop, but TASK-369.1 found the local sccache cache effectively empty (~1.6 MB, zero stats) — the documented cross-worktree reuse was not happening on the dev host. Kache (https://github.com/kunobi-ninja/kache, Apache-2.0, v2.1.1) is a newer Rust compiler cache whose pitch maps directly onto this initiative's two cost centres: it claims cache sharing across worktrees with per-worktree target directories, copy-on-write restores on APFS to cut physical disk per worktree, and caching of linked Rust executables and build-script runs that sccache passes through. It is also young (repo created 2026-02, 34 open issues) and its published benchmarks are Firefox/LLVM, not mt, so the vendor claims cannot be taken as mt savings. The decision this task produces — adopt, trial, or reject — needs measured evidence against the baseline TASK-369.1 already recorded, because a win on fresh-worktree builds can coincide with a regression in edit-to-run latency: Kache strips Cargo's incremental directory argument and only adaptively re-enables isolated incremental state for units detected as being edited. Windows is the weak platform (executable caching off by default, open daemon-connectivity and key-computation reports) and slow remote stores have stalled builds in the field (kunobi-ninja/kache#1887), so the scope is local macOS evaluation, not a CI migration.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Trial is recorded against the existing benchmarks/edit-to-run/ baseline on identical hardware and pinned toolchain, with methodology fixed across both runs (revision, lockfile, target triple, profile, job count)
- [ ] #2 Edit-to-run latency measured per change class from benchmarks/edit-to-run/, including repeated edits of the same unit so adaptive incremental mode has cycles to engage, not just a single edit
- [ ] #3 Fresh-worktree build measured from a populated cache, reported separately from local-hit and uncached cold builds
- [ ] #4 Physical disk allocation across worktrees measured with copy-on-write restores in play, distinguished from logical target/ size
- [ ] #5 Cached correctness verified against an uncached build, including the agent/mcp/devtools feature combos, with no stale-artifact failures
- [ ] #6 Build-script caching verified for the crates that declare build scripts, with OUT_DIR and rerun-if-changed behaviour confirmed correct
- [ ] #7 Pass-through behaviour characterized: which mt invocations Kache caches, which it bypasses, and what the bypass reasons are
- [ ] #8 Task integration explicitly tested: taskfile.yml sets RUSTC_WRAPPER=sccache, so a Kache trial must show how Task-driven commands (task tauri:dev, task tauri:build, task test) route through the cache, and what a kache init would change
- [ ] #9 Finding recorded as an adopt / trial-wider / reject recommendation with the measured numbers behind it, stating explicitly what was not evaluated
- [ ] #10 CI left unchanged; no remote cache configured and no CI workflow modified
- [ ] #11 Findings landed in this task's notes and docs/builds.md reflects the outcome only if a change is accepted
<!-- AC:END -->
