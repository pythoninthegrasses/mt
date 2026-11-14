---
id: TASK-351
title: Restore the documented CI job graph in test.yml
status: Done
assignee: []
created_date: '2026-09-11 00:38'
updated_date: '2026-09-14 07:00'
labels: []
dependencies: []
type: bug
ordinal: 53500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Cross-platform build verification should start as soon as deno-lint finishes rather than waiting on the slowest test job. .github/workflows/test.yml:78 declares `build: needs: [deno-lint, rust, vitest-tests, playwright-tests]` and :200 declares `playwright-tests: needs: [changes, deno-lint, rust, vitest-tests]`, producing a serial rust(20m) -> playwright(20m) -> build(30m) chain. docs/builds.md:587 documents and justifies the intended graph: deno-lint alone gates build, with the three test jobs independent. The workflow has drifted from its own documented design, costing up to ~40 minutes of CI wall-clock per run.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 build job gates only on deno-lint
- [x] #2 playwright-tests job gates only on changes and deno-lint
- [x] #3 A PR run shows the build matrix starting within ~3 minutes of deno-lint completing
- [x] #4 Total CI wall-clock recorded before and after the change in the task notes
- [x] #5 docs/builds.md dependency graph re-verified as accurate against the workflow file
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## CI wall-clock: before/after

**Before (drifted graph)** — most recent real PR run on the old graph, [run 34811970745](https://github.com/pythoninthegrasses/mt/actions/runs/34811970745) (TASK-355.6's PR): `rust` failed on a pre-existing, unrelated bug (`resource path binaries/mt-zig-core-aarch64-apple-darwin doesn't exist`). Because `build` and `playwright-tests` both depended on `rust`, they were **skipped entirely** rather than delayed — total run wall-clock 1m50s, but zero build/E2E signal produced for the PR. That's the sharpest cost of the drift: one unrelated job failure silenced build+E2E for the whole PR, not just slowed them.

For a wall-clock (not skip-cascade) comparison, the last fully-successful run on the old graph, [run 24358563505](https://github.com/pythoninthegrasses/mt/actions/runs/24358563505) (2026-04-13, predates the `zig`/`shadow-diff`/`changes` jobs): total 17m8s. `build(macos)` didn't start until 18:02:44 — 2m18s after `deno-lint` finished (17:58:26) — because it waited on `playwright-tests` (finished 18:02:42), which itself waited on `rust`/`vitest-tests`. In that run rust/vitest/playwright happened to be fast (~1-2 min each), so the observed serial penalty was minutes, not the worst-case ~40 min the task description assumes for slower runs — but the mechanism (build gated on jobs it doesn't need) is the same regardless of their duration.

**After (this fix)** — [PR #51's own run, 34815076214](https://github.com/pythoninthegrasses/mt/actions/runs/34815076214): `deno-lint` finished 06:49:56. `build(linux)` started 06:50:10 (+14s), `build(windows)` started 06:50:26 (+30s), `build(macos)` started 06:51:22 (+1m26s) — all well within the ~3min target (AC#3), and critically, **all three started even though `rust`/`vitest-tests`/`shadow-diff` failed** (same pre-existing zig staging bug as the before-case), because `build` no longer depends on them. Total run wall-clock 9m34s — longer in absolute terms than the before-cascade-skip case specifically because build now actually runs to completion three times instead of being dropped; that's the intended behavior, not a regression.

`playwright-tests` was correctly skipped in the after-run (completed 06:49:56, essentially instantly) because this PR touches no `app/frontend/**` paths, not because of any upstream failure — confirms AC#2's `changes` gating works independently of `rust`/`vitest-tests` now.

## AC#5 — docs/builds.md re-verification

Updated `docs/builds.md`'s "Test Workflow Dependency Graph" section in the same commit: it said "five jobs" and listed `playwright-tests` as fully independent, both stale (workflow now has eight jobs — `zig`/`shadow-diff`/`changes` were added since the doc was last touched — and `playwright-tests` already depended on `deno-lint` even before this fix). Section now names all eight jobs and correctly shows `build` and `playwright-tests` both gated on `deno-lint` only (plus `playwright-tests` on `changes`), matching `test.yml` exactly.
<!-- SECTION:NOTES:END -->
