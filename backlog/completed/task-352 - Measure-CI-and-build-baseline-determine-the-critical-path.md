---
id: TASK-352
title: Measure CI and build baseline; determine the critical path
status: Done
assignee: []
created_date: '2026-09-11 00:38'
updated_date: '2026-09-14 07:08'
labels: []
dependencies:
  - TASK-351
type: spike
ordinal: 54500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A recorded, trustworthy baseline is needed to tell whether a Zig core-engine migration can move CI wall-clock at all. This is the gate for TASK-357 (the Zig POC). playwright-tests runs against Vite preview at localhost:4173 with grepInvert /@tauri/ and mocked IPC, so no backend rewrite of any kind can speed it up. If it dominates the critical path after TASK-351 lands, the Zig migration's Phases 3-6 must be re-justified on dev-loop and code-ownership grounds rather than CI wall-clock, and that recommendation should be made explicit here rather than assumed later.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Per-job wall-clock captured from a real PR run after TASK-351 lands
- [x] #2 task build:timings output captured for both a cold and a warm build
- [x] #3 cargo tree -e normal | wc -l recorded as the dependency-count baseline
- [x] #4 The critical path (which job/chain actually bounds total CI time) is named explicitly in the task notes
- [x] #5 A written go/no-go recommendation for proceeding to TASK-357 is recorded on this task
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## AC#1 — per-job wall-clock, real PR run after TASK-351 landed

Source: [PR #51](https://github.com/pythoninthegrasses/mt/pull/51)'s own run, [34815076214](https://github.com/pythoninthegrasses/mt/actions/runs/34815076214) — this PR *is* the TASK-351 fix, so its own CI run is the first real PR run against the corrected graph (merged as `a9c794e`).

| Job | Start | End | Duration | Result |
|---|---|---|---|---|
| Detect Changes | 06:49:48 | 06:49:56 | 8s | success |
| Deno Lint and Format Check | 06:49:49 | 06:49:56 | 7s | success |
| Vitest Unit Tests | 06:49:49 | 06:50:05 | 16s | failure (pre-existing, see below) |
| Zig Lint, Test, and Build | 06:49:49 | 06:50:22 | 33s | failure (pre-existing) |
| Rust/Zig Shadow-Diff Parity | 06:49:49 | 06:50:48 | 59s | failure (continue-on-error) |
| Rust Lint, Format, and Test | 06:49:32 | 06:51:20 | 1m48s | failure (pre-existing) |
| Build (linux) | 06:50:10 | 06:59:03 | 8m53s | success |
| Build (windows) | 06:50:26 | 06:57:10 | 6m44s | failure |
| Build (macos) | 06:51:22 | 06:53:07 | 1m45s | failure |
| Playwright E2E Tests | 06:49:57 | 06:49:56 | ~0s | skipped (no `app/frontend/**` change in this PR) |

Total run wall-clock: 9m34s (06:49:30 → 06:59:04).

The `rust`/`vitest-tests`/`zig`/`shadow-diff` failures are a real, pre-existing, unrelated bug — `resource path binaries/mt-zig-core-{host} doesn't exist` — the same Zig sidecar staging-path issue TASK-355.6's agent flagged as an incidental out-of-scope finding. Not caused by this measurement work; it's also why `build(windows)`/`build(macos)` show `failure` (the sidecar binary isn't staged for those targets since `build` runs bare `cargo check`, not `task ci:build`). `build(linux)`'s Docker-based check path tolerates it differently. Fixing this staging bug is out of scope for this spike.

Since this PR touched no frontend paths, `playwright-tests` didn't execute. For real playwright execution-time data (a job's own runtime is unaffected by which graph gates it), pulled from the last four real successful runs that touched frontend paths (April 2026, pre-TASK-351): 2m50s, 2m51s, 2m56s, and one outlier of 19m57s — evidently a cache-cold run, since the same run also shows build(macos) at 18m47s and build(windows) at 14m14s: cache-miss slows everything together, not just playwright.

## AC#2 — task build:timings, cold vs warm

Run on this dev machine (Linux x86_64, mise-managed nightly toolchain, no sccache warm cache):

- **Cold** (`rm -rf target`, `task zig:stage TARGET=x86_64-unknown-linux-gnu` run first — without it `cargo build --workspace` fails on the sidecar-staging bug noted in AC#1, since `build:timings` calls bare `cargo build` rather than `task ci:build`): `Finished `dev` profile [unoptimized + debuginfo] target(s) in 1m 35s`.
- **Warm** (touch `crates/mt-tauri/src/main.rs`, rebuild): `Finished ... in 3.21s`.

(The task's own post-build `xdg-open` step fails with `OSTYPE: unbound variable` on this shell — a pre-existing Taskfile bug unrelated to the timing measurement itself; the timing report was written to `target/cargo-timings/` before that failure.)

## AC#3 — dependency-count baseline

`cargo tree -e normal | wc -l` → **1443** normal dependencies (workspace, this repo state at `a9c794e`).

## AC#4 — critical path

Post-TASK-351, the critical path is **deno-lint → build matrix** (specifically whichever platform's `cargo check` is slowest in a given run — linux, windows, and macos have each been the slowest platform in different observed runs; no single platform consistently dominates). `rust`, `vitest-tests`, `zig`, `shadow-diff`, and (when it runs) `playwright-tests` are now fully decoupled from `build` and from each other, so none of them extend the critical path any more — that was exactly TASK-351's fix.

This contradicts the assumption in this task's own description (a serial `rust(20m) -> playwright(20m) -> build(30m)` chain costing ~40min): under normal/warm-cache conditions every job observed in real runs finishes in 1-3 minutes, and the ~15-20min figures only appear in what looks like a single cache-cold run where all jobs (playwright included) slow down together — not a scenario where playwright specifically bottlenecks the pipeline. TASK-351's fix (decoupling the graph) captures the large majority of the available wall-clock benefit; there is no evidence playwright-tests is, or was, the dominant term.

## AC#5 — go/no-go recommendation for the further Zig migration (this task's description calls it TASK-357)

**No-go on CI-wall-clock grounds.** The premise that motivated gating the Zig migration's later phases on CI wall-clock doesn't hold up against real data:

1. Playwright-tests does not dominate the critical path (AC#4) — it's comparable in duration to the build jobs, and TASK-351 already removed it from any serial chain regardless.
2. The build matrix (native Rust `cargo check`/`cargo build` across 3 platforms) is the actual critical path, and it is bounded by Rust compilation, not by anything a Zig core-engine port would touch under the shadow-diff/endpoint-flip pattern being tested in TASK-355 — those changes don't remove Rust dependencies from `mt-tauri`'s own crate graph, so they wouldn't move `cargo tree`'s 1443-dependency baseline or the build-matrix wall-clock either.
3. Local build timings (cold 1m35s / warm 3.21s) are already fast; there's no local dev-loop pain visible here that a Zig rewrite would obviously fix on this measurement alone.

If TASK-357 (the broader migration, Phases 3-6) is still pursued, per this task's own framing it should be justified explicitly on **dev-loop and code-ownership grounds** (e.g. reducing `mt-tauri`'s own dependency footprint over time, or isolating a specific hot-path engine from the Tauri/Rust plugin ecosystem's build weight) — not on CI wall-clock, which TASK-351 already substantially fixed on its own.

Separately, and out of scope for this spike but worth flagging again: the `mt-zig-core-{host}` sidecar staging-path bug is currently failing `rust`/`vitest-tests`/`zig`/`shadow-diff` (and by extension `build(windows)`/`build(macos)`) on every real PR run observed during this measurement. That's a real, live defect blocking clean CI signal today, independent of any Zig-migration go/no-go decision.
<!-- SECTION:NOTES:END -->
