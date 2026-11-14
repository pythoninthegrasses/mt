---
id: TASK-369
title: Cut build latency and artifact footprint (dev loop and releases)
status: To Do
assignee: []
created_date: '2026-11-14T04:23:00Z'
labels:
  - build-perf
dependencies: []
references:
  - 'https://blog.rust-lang.org/2026-11-12/Rust-1.100.0/'
  - 'https://doc.rust-lang.org/cargo/reference/lints.html#unused_dependencies'
documentation:
  - docs/builds.md
  - zig-core/README.md
priority: medium
type: task
ordinal: 72500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Releases average ~9.8 min wall-clock (median 7.8, range 2.9-25.8 across 12 runs Feb-May 2026) with Windows consistently slowest (399-464 s in the last three releases) and Linux volatile (86-598 s). But CI wall-clock is only half the motivation: the developer-facing costs -- edit-to-run incremental rebuild latency and multi-GB target/ directories (worse across git worktrees, profiles, and feature combos) -- are equally important reasons to weigh restructuring or moving subsystems out of Rust. TASK-352 concluded no-go on Zig for CI wall-clock alone and said any language move must be justified on dev-loop and artifact-footprint grounds; this initiative creates exactly that evidence base: measure the dev-loop/disk baseline, harvest the Rust 1.100 dependency-lint findings (TASK-361 found cargo::unused_dependencies does not fire on mt-tauri, so the fallback lint must be used), trim release-profile cost (fat LTO + codegen-units=1 today), fix CI cache config (taskfiles/ci.yml clears RUSTC_WRAPPER so sccache is bypassed; Windows rust-cache sets cache-targets:false), and end with an evidence-based architecture decision that folds in the already-planned TASK-353 mt-core extraction and the TASK-355 Zig POC report. Current dependency baseline: 1443 normal deps (cargo tree, TASK-352).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Baseline child records edit-to-run latency per change type and target/cache disk footprint
- [ ] #2 Unused and over-scoped dependencies audited across all three platforms and the agent/mcp/devtools features, with removals landed or justified
- [ ] #3 Heavyweight dependencies behind narrow features (chart-grid image stack) have a trim/replace/move-to-frontend recommendation with measured impact
- [ ] #4 Release profile (LTO, codegen-units) benchmarked and the winner documented in Cargo.toml and docs/builds.md
- [ ] #5 CI compilation caching audited and improved where cache hit rates justify it
- [ ] #6 Final architecture decision recorded on the decision child, weighing lean-split Rust against a Zig engine on dev-loop latency, disk footprint, and release time
- [ ] #7 docs/builds.md updated to reflect every accepted change
<!-- AC:END -->
