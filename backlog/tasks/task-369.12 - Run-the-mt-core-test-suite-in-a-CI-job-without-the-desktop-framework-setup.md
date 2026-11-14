---
id: TASK-369.12
title: Run the mt-core test suite in a CI job without the desktop framework setup
status: To Do
assignee: []
created_date: '2026-11-14T21:14:00Z'
labels:
  - build-perf
  - ci
dependencies:
  - TASK-353
references:
  - >-
    backlog/tasks/task-353 -
    Extract-crates-mt-core-a-tauri-free-library-crate.md
  - >-
    backlog/tasks/task-352 -
    Measure-CI-and-build-baseline-determine-the-critical-path.md
documentation:
  - docs/builds.md
  - docs/testing.md
  - docs/act-guide.md
modified_files:
  - .github/workflows/test.yml
  - taskfiles/ci.yml
  - docs/builds.md
  - docs/testing.md
parent_task_id: TASK-369
priority: medium
type: task
ordinal: 80500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-353 landed the tauri-free crates/mt-core crate and recorded this as the CI half of its payoff, explicitly out of that task's scope. The core is real and verified: 686 of the workspace's 1,071 #[test] functions live in crates/mt-core, its dependency graph is 326 crates (cargo tree -p mt-core -e normal) against mt-tauri's 1,177, and the guard step in .github/workflows/test.yml proves that no tauri, tao, wry, webkit, or objc2 crate appears in it transitively. All of those tests nevertheless still run inside the rust job (name: Rust Lint, Format, and Test, .github/workflows/test.yml:35), which runs on the self-hosted [macOS, ARM64] runner, calls ./.github/actions/setup-tauri-build with mode: test, stages a placeholder sidecar with task zig:stage-placeholder, and then runs cargo nextest run --workspace -E 'not test(/shadow_diff_parity_test::/)'. So 686 tests that need none of the desktop framework pay for its toolchain setup, share the scarcest runner with the desktop build, and gate playwright-tests, which lists rust in its needs:. The work is to give the core suite its own job that needs neither the desktop toolchain nor the sidecar, and to measure whether that moves CI wall clock rather than assuming it will. Cheapest existing paths to reuse rather than reinvent: taskfiles/ci.yml already has ci:setup-check (rustup and the pinned toolchain only) and ci:setup-test (that plus cargo-nextest), and the setup-tauri-build action's mode: check already skips Node.js, frontend deps, and cargo tools. Whether the job should also move off the macOS self-hosted runner onto the blacksmith ubuntu runners the other jobs use is worth evaluating: mt-core's only platform-specific dependencies are libc on unix and windows-sys on windows. Measure before claiming anything. TASK-353's controlled same-machine timings found no whole-workspace speedup from the split itself (cold build 44.53s versus the pre-split 48.81s, cold --tests 48.76s versus 47.00s, both inside single-run noise), so any improvement has to be shown as per-job wall clock from a real PR run. If it cannot be shown, revert the job split and record the negative result rather than keeping graph complexity that buys nothing.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A dedicated job in .github/workflows/test.yml runs cargo nextest run -p mt-core for both the default and the all-features (agent) feature sets, without installing the desktop framework toolchain (no Tauri CLI or cargo tools, no Tauri platform deps) and without a task zig:stage-placeholder step
- [ ] #2 Coverage is unchanged and not duplicated: the desktop job runs cargo nextest run -p mt-tauri with the same not test(/shadow_diff_parity_test::/) filter, the shadow-diff job is untouched, and the two jobs together report the same tests the single --workspace run reported (1,023 passed and 5 skipped excluding the parity filter, as recorded when TASK-353 closed)
- [ ] #3 The mt-core desktop dependency-boundary guard moves to the core job, next to the crate it protects, with its cargo tree command and grep patterns unchanged
- [ ] #4 Per-job wall clock for the new core job and the reduced desktop job is captured from a real PR run and recorded in this task's notes, compared against TASK-352's baseline and the current rust job, including runner queue time and the effect on when playwright-tests can start (it lists rust in needs:)
- [ ] #5 Local validation passes: actionlint on the changed workflow, an act run of the new job per docs/act-guide.md, and cargo nextest run -p mt-core locally
- [ ] #6 docs/builds.md documents the resulting job graph, and docs/testing.md is corrected where it describes the CI Rust job
- [ ] #7 If the recorded measurement shows no CI wall-clock or runner-occupancy benefit, the job split is reverted and this task's notes carry the negative result instead
<!-- AC:END -->
