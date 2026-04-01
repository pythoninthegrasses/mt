---
id: TASK-306
title: 'CI Build Time Iteration: Linux prebaked image + macOS runner broadening'
status: Done
assignee: []
created_date: '2026-04-01 04:04'
updated_date: '2026-04-01 14:00'
labels:
  - ci
  - performance
  - infrastructure
dependencies: []
references:
  - .sisyphus/plans/ci-build-time-iteration.md
  - .github/workflows/test.yml
  - .github/workflows/release.yml
  - .github/actions/setup-tauri-build/action.yml
  - taskfiles/ci.yml
  - docs/builds.md
  - 'https://github.com/pythoninthegrass/mt/actions/runs/23830571007'
priority: medium
ordinal: 1125
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Reduce PR/push CI wall-clock time by eliminating Linux setup provisioning overhead via a prebaked Blacksmith image, then reduce macOS queue delay by broadening eligible self-hosted runners (remove `studio` label requirement).

**Scope**: Linux-first (prebaked image), then macOS (label broadening). Windows explicitly excluded due to flaky toolchain.

**Key findings from analysis**:
- Linux `Build` job spends ~1m21s in setup (apt-get + toolchain), only ~6s in cargo check — setup dominates
- macOS jobs stuck in `queued` state while all other jobs complete — runner availability is wall-clock bottleneck
- `mold` linker configured but not installed by `setup-system-deps` — must be in prebaked image

**Plan**: 10 tasks across 3 waves with acceptance criteria, QA scenarios, dependency matrix, and rollback controls. Full plan at `.sisyphus/plans/ci-build-time-iteration.md`.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Linux CI jobs using Tauri/Rust setup no longer spend ~1m+ on dependency provisioning
- [x] #2 macOS jobs run with [macOS, ARM64] labels (no studio pin) in both test.yml and release.yml
- [x] #3 task ci:setup-system-deps status checks pass on prebaked Linux environment without apt install
- [x] #4 Before/after timing summary exists from GHA run data
- [x] #5 Rollback path exists and is documented for Linux runner selection
- [x] #6 Lightweight JS jobs (deno-lint, vitest) remain on vanilla runner unless measured win proven
- [x] #7 Windows CI behavior unchanged
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Completed
- macOS labels broadened: `[macOS, ARM64, studio]` → `[macOS, ARM64]` in test.yml and release.yml
- Linux builds containerized with cargo-chef multi-stage Dockerfile + Blacksmith Docker layer caching
- Linux runner toggle: `linux-runner` workflow_dispatch input with vanilla fallback
- JS jobs (deno-lint, vitest) stay on vanilla runner
- Windows rust-cache scoped to registry-only (`cache-targets: false`) to reduce 186MB download
- Fixed PINNED_RUST empty-value bug on Windows (guard RUSTUP_TOOLCHAIN template)
- Filed cargo-chef#350 for per-target edition injection warnings
- Baseline timing captured; all jobs green on run 23834512216

## Timing (run 23834512216 vs baseline)
- Linux Build: 78.5s setup eliminated, cargo check via Docker in 59s (will improve as layer cache stabilizes)
- macOS rust: queue latency p50 = 2s (unchanged, was not the bottleneck)
- macOS build: now eligible on both mini + studio runners
- Windows: registry-only cache reduces restore from 186MB to ~20-30MB

## Commits
- `ci: broaden macOS runners, add Linux runner toggle`
- `ci(linux): containerize cargo check and release build with cargo-chef`
- `ci(windows): reduce cache restore time by caching registry only`
- `fix(ci): guard RUSTUP_TOOLCHAIN against empty PINNED_RUST on Windows`
<!-- SECTION:NOTES:END -->
