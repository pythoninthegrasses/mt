---
id: TASK-318
title: Optimize Linux containerized CI workflow overhead and cache reuse
status: Done
assignee: []
created_date: '2026-04-12 06:59'
updated_date: '2026-04-12 07:48'
labels:
  - ci
  - github-actions
  - docker
  - performance
milestone: m-1
dependencies:
  - TASK-316
references:
  - 'https://github.com/pythoninthegrasses/mt/actions/runs/24300669188'
documentation:
  - .github/workflows/test.yml
  - docker/linux/Dockerfile
  - docs/builds.md
priority: medium
ordinal: 687.5
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Improve the Linux container-based CI path without abandoning Docker-based verification. Focus on reducing fixed orchestration cost, maximizing cache reuse across runs, and minimizing teardown overhead so the Linux build-check path remains containerized but spends more time on useful work and less on setup/cleanup.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The Linux CI job remains containerized for verification purposes.
- [x] #2 The workflow or Docker configuration is updated to improve cache reuse or reduce setup/teardown overhead for the Linux build-check path.
- [x] #3 Any caching or builder changes avoid broadening artifact publishing scope or changing the verification semantics of the Linux check job.
- [x] #4 The optimization is measured or otherwise verified, and the before/after impact or tradeoff is recorded in task notes or PR summary.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
### Before-Optimization Baseline (2026-04-12)

Measured from 6 successful `Build (linux)` jobs on `test.yml` workflow (Blacksmith runners, 8 vCPU).

#### Per-Run Step Timings (seconds)

| Run ID | Total | Setup Job | Checkout | Docker Builder Setup | Cargo Check | Post Docker Builder | Notes |
|--------|-------|-----------|----------|---------------------|-------------|--------------------|---------| 
| 24301345691 | 75s | 3s | 1s | 31s | 7s | 31s | Full cache hit |
| 24300669188 | 75s | 2s | 2s | 31s | 5s | 30s | Full cache hit |
| 24299363035 | 104s | 3s | 1s | 32s | 35s | 30s | Partial cache hit |
| 24299356687 | 243s | 2s | 1s | 33s | 172s | 32s | Cache miss (code change) |
| 24298889645 | 342s | 3s | 1s | 46s | 288s | 1s | Cache miss (code change) |
| 24298218124 | 540s | 2s | 2s | 32s | 469s | 31s | Cache miss (first build?) |

#### Overhead Analysis

Fixed orchestration cost per run (non-cargo-check time):

- **Docker Builder Setup**: 31-46s (median ~32s)
  - Actual log activity ends at ~2s; remaining ~29s is unaccounted dead time between last log line and step completion
  - Includes: sticky disk clone (1s), DB integrity check (1s), buildkitd startup (1s), then ~29s idle
- **Post Docker Builder (teardown)**: 0-32s (bimodal: either ~0s or ~31s)
  - Actual cleanup takes ~1s (prune, SIGTERM, unmount, commit)
  - 30s gap between last log and next step when non-zero
- **Setup Job + Checkout**: ~4s (negligible)

**Worst-case fixed overhead**: ~65s (32s setup + 31s teardown + 2s other) on a 75s fully-cached run = **87% overhead**

**Best-case fixed overhead**: ~34s on a 540s cold build = **6% overhead**

#### Key Observations

1. **Docker builder setup/teardown dominates cached runs**: When `cargo check` is fully cached (5-7s), the Docker orchestration overhead (62s) represents 83-87% of total job time.
2. **~29s phantom gap in setup step**: Last log at 07:21:27, step ends at 07:21:56 (run 24301345691). No log output during this period. Likely Blacksmith builder initialization or cache warmup.
3. **~30s phantom gap in teardown step**: Similar pattern — cleanup logs finish in ~1s but step takes 30-31s. Likely sticky disk commit to Blacksmith infrastructure.
4. **Post Docker Builder teardown is bimodal**: Run 24298889645 has 1s teardown vs 31s in others. May depend on whether sticky disk needs committing.
5. **Build-push-action pulls `dockereng/export-build:latest` every time**: This image pull adds ~2s to every Cargo Check step. Could be cached.
6. **Docker info is logged twice**: Once in setup-docker-builder and again in build-push-action. Redundant ~0.3s.
7. **When fully cached, actual useful work (cargo check) takes 5-7s** out of a 75s total job.

#### Reference Links

- Example run: https://github.com/pythoninthegrass/mt/actions/runs/24301345691/job/70955164956
- Workflow reference: https://github.com/pythoninthegrass/mt/actions/runs/24300669188"}

### Optimization: Hash-based skip (implemented)

Strategy: Compute a hash of all files that affect `cargo check` output in the Docker `check` target, and skip the entire Docker build if the hash matches a previous successful run.

**Files included in hash:**
- `Cargo.toml`, `Cargo.lock` (workspace manifest and lockfile)
- `crates/**/*.rs` (all Rust source)
- `crates/**/Cargo.toml` (crate manifests)
- `crates/**/.cargo/**` (cargo config, linker settings)
- `docker/linux/Dockerfile` (build definition)

**Why these files:** The Dockerfile's `check` target only copies `Cargo.toml`, `Cargo.lock`, and `crates/` — changes to `app/`, `taskfiles/`, or `.github/` don't affect the Linux cargo check.

**Mechanism:** `actions/cache@v4` with key `linux-cargo-check-${{ hashFiles(...) }}`. A sentinel file (`.cargo-check-sentinel`) is written after a successful Docker build. On subsequent runs, if the cache hits, Docker setup/build/teardown are all skipped.

**Expected improvement:**
- Cache hit (no Rust changes): ~75s -> ~5s (93% reduction)
- Cache miss (Rust changes): no change (full Docker build runs as before)
- release.yml: unaffected (always runs full build)

**Files changed:**
- `.github/workflows/test.yml` — added cache check + conditional Docker steps
- `.gitignore` — added `.cargo-check-sentinel`
- `docs/builds.md` — documented the optimization

### After-Optimization Measurements (2026-04-12)

#### Run 1: Cache miss (first run with optimization, run 24301703842)

Sentinel cache does not exist yet. Full Docker build executes, sentinel is saved.

| Step | Duration |
|------|----------|
| Set up job + runner | 2s |
| Checkout | 1s |
| Check cargo-check cache | 1s (miss) |
| Setup Docker builder | 31s |
| Cargo check (Docker) | 7s |
| Write sentinel | 0s |
| Post Docker builder | 30s |
| Post cache (save sentinel) | 1s |
| **Total** | **77s** |

Overhead from optimization on miss path: ~1s (cache check + save). Negligible.

#### Run 2: Cache hit (workflow_dispatch, run 24301740940)

Sentinel cache exists with matching hash. Docker setup/build/teardown all skipped.

| Step | Duration |
|------|----------|
| Set up job + runner | 3s |
| Checkout | 1s |
| Check cargo-check cache | 1s (hit) |
| Skip notice | 0s |
| Post cache | 0s |
| **Total** | **8s** |

#### Before/After Summary

| Scenario | Before | After | Change |
|----------|--------|-------|--------|
| Cache hit (no Rust changes) | 75s | 8s | **-89%** |
| Cache miss (first run) | 75s | 77s | +3% (negligible) |
| Cache miss (Rust changes) | 104-540s | ~same | +1s overhead |
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented hash-based skip optimization for the Linux containerized `cargo check` job in `test.yml`.

**Mechanism**: Before spinning up Docker, compute a hash of all files that affect `cargo check` output (Cargo.toml, Cargo.lock, crates/**/*.rs, crate manifests, cargo config, Dockerfile). Use `actions/cache@v4` to check if this hash was previously seen with a successful build. On cache hit, skip Docker setup/build/teardown entirely.

**Results**:
- Cache hit (no Rust changes): 75s -> 8s (89% reduction)
- Cache miss: +1s overhead (negligible)
- release.yml: unaffected

**Files changed**:
- `.github/workflows/test.yml` — cache check step + conditional Docker steps
- `.gitignore` — `.cargo-check-sentinel` exclusion
- `docs/builds.md` — documented the optimization

**Verified**: Run 24301740940 (cache hit) completed in 8s. Run 24301703842 (cache miss, first run) completed in 77s. All Docker steps correctly skipped on cache hit, correctly executed on cache miss.
<!-- SECTION:FINAL_SUMMARY:END -->
