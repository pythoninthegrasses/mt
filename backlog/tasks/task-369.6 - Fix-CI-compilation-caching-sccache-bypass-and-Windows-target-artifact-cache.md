---
id: TASK-369.6
title: >-
  Correct Rust build-cache configuration and documentation without a benchmark
  campaign
status: To Do
assignee: []
created_date: '2026-11-14T04:24:00Z'
updated_date: '2026-11-15T05:38:00Z'
labels:
  - build-hygiene
  - bugfix
dependencies:
  - TASK-369.4
documentation:
  - docs/builds.md
  - docs/development.md
parent_task_id: TASK-369
priority: medium
type: task
ordinal: 5000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Retained Rust/Tauri/library builds still need correct tooling during the Zig-first migration, but this is not a reason for an 18-24-job cache investigation. Existing research, including the originally uncommitted findings, is preserved in historical notes. Bound this task to effective RUSTC_WRAPPER behavior, available/missing cache binaries, CARGO_HOME/cache-path correctness and truthful build docs. No new cache service, Kache evaluation, speculative target-cache rollout or release/benchmark dispatch is authorized. Features are frozen under TASK-393; this configuration repair is allowed bugfix/build hygiene. Preserve Windows host-triple pinning and committed-schema safety rules in AGENTS.md.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Task-driven builds have an explicit tested wrapper policy: configured/available cache binaries work, intentionally disabled or unavailable caching is reported clearly, and a child Taskfile does not silently override unrelated root commands.
- [ ] #2 Configured Cargo/cache paths match the locations actually used by builds; any Windows path mismatch is corrected or explicitly documented as unresolved rather than claiming target caching is enabled.
- [ ] #3 Focused tests/probes cover default invocation, explicit wrapper opt-in/opt-out and missing binary without requiring a release build or a paid runner matrix.
- [ ] #4 Windows fully qualified RUSTUP_TOOLCHAIN/default-host safeguards and generated-schema cleanliness checks remain intact; changed workflows pass lint.
- [ ] #5 docs/builds.md and docs/development.md state actual wrapper behavior, provisioning requirements, cache persistence and runner types without unmeasured speedup claims.
- [ ] #6 No benchmark workflow, new remote-cache service, release upload/README mutation, repeated profile/cache comparison or committed raw timing directory is introduced.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
All prior work is stopped. Maintainer-approved replacement scope is configuration correctness and truthful documentation only. Historical research/plan is preserved in notes, not authorization to execute its benchmark phases. On resuming, inspect the existing ci/369-6-cache-bypass worktree and preserve any implementation work; record a fresh bounded plan before editing code. No new CI spending is authorized.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-11-14 Zig-first re-scope: feature freeze, bugfixes allowed. The old cache-bench.yml proposal, 18-24-job/platform/config/run matrix, new target-cache experiments and requests to spend runner-hours are canceled. Existing measured findings remain evidence, not instructions to rerun. Pre-existing uncommitted research is retained below.

Historical superseded cache research and proposal, part 1: --------------------------------------------------
Harness: instrument CI, then measure on the real runners and keep only what pays. Follows TASK-369.4's shape (a dedicated tag-triggered bench workflow + a committed `benchmarks/` results dir) rather than dispatching the real release workflow, because release.yml's dispatch path uploads assets to `latest` and its `update-readme` job pushes to main.

## Research findings (measured 2026-11-14, Task 3.49.1, sccache 0.18.0, profile lto=thin/cgus=4)

1. **The bypass is wider than the task description says, and it is caused by that one line.** `taskfiles/ci.yml` line 23 sets file-level `env: RUSTC_WRAPPER: ""`. Task merges an *included* taskfile's file-level env over the root's, so this empties RUSTC_WRAPPER for **every task in the project**. Verified with a three-tree control matrix on copies of the repo's taskfiles (probe task in the root `tasks:` and in the included `ci.yml`), on both Task 3.49.1 (`.tool-versions` pin) and 3.54.0 (what CI installs):
   - tree with the repo as-is -> `RUSTC_WRAPPER=[]` for root tasks *and* `ci:*` tasks;
   - control, `ci:` include removed -> root tasks get `sccache`;
   - control, only the `RUSTC_WRAPPER: ""` line deleted from `ci.yml` -> `sccache` for root tasks *and* `ci:*` tasks.
   So docs/builds.md line 15/61 ("All `task tauri:*` commands use ... sccache") is false on any machine that does not already export the var. Not just a CI bug.
2. **An empty taskfile env value does NOT override the process environment** (Task docs + verified: `RUSTC_WRAPPER=sccache task ci:build` -> command sees `sccache`). Two consequences: a workflow step can opt in today with step-level `env:`, and any durable fix must print the *effective* value rather than trust the declared one. Also explains `docker/macos/entrypoint.sh`'s export winning on container runners.
3. **sccache pays on this crate set at the current profile.** Two cold-target release builds of mt-tauri (M4 Max, 14 jobs, `target/` wiped between them): cold sccache cache 70.1 s / 528 Rust misses; warm sccache cache **42.9 s / 530 hits / 0 misses (100%)** = **1.63x faster**. TASK-369.4's 50.19% figure was the fat-LTO profile and understates it.
4. **No stale-secret hazard from sccache + `option_env!`.** build.rs emits `cargo:rustc-env=LASTFM_API_KEY` and `crates/mt-tauri/src/lastfm/config.rs` reads it with `option_env!`. Two cold builds with different probe keys produced a binary containing only the *second* key (grep A=0, B=1). 107 calls/build are non-cacheable (95 `crate-type`), which is why the key-embedding units recompile rather than hit stale. Keep this as a guard, not an assumption.
5. **Windows registry cache may be pointed at the wrong directory.** The composite action caches with `Swatinem/rust-cache` (`cache-targets: false`) in a step whose environment has no `CARGO_HOME`, so it caches `~/.cargo`; but the build's cargo gets `CARGO_HOME={{.ROOT_DIR}}/.cache/cargo` from `taskfile.yml:19` -- inside the workspace `actions/checkout` wipes. Verify on the runner before spending runs on target-dir caching.
6. **Sizing for the Windows decision:** cold release `target/<triple>` at the committed profile = 1 674 875 KiB (~1.6 GB, TASK-369.4 windows-lto-thin-cgus4); host sccache cache 5.1 GiB against a 10 GiB default cap.
7. **Windows is not a self-hosted runner.** release.yml uses `blacksmith-4vcpu-windows-2025` (ephemeral Blacksmith); docs say `[self-hosted, Windows, X64]` (lines 11, 751, 790) -- stale. So AC#2's "persistent cache location on the ... Windows runner" can only be met through a cache service (rust-cache / Blacksmith sticky NVMe), not a host dir. macOS *is* persistent: the registered `mini` runner (labels self-hosted, macOS, ARM64, ios, tauri, mini).
8. **Before-baseline, per job (from the Actions API):** macOS 168-258 s, Windows 399-464 s, Linux 86-598 s. Older successful release runs agree there was never a cached macOS/Windows leg: `Build macOS (ARM64)` 167 s (2026-02-21), 238 s (2026-04-24), 178 s (2026-05-04, v1.6.0), 209 s (2026-09-12 dispatch); `Build Windows (x64)` 274-967 s over the same window; the one outlier 1528 s macOS is the first release run after a dependency jump (2026-04-12). Last release-tag run 2026-05-04 (v1.6.0); last dispatch run 2026-09-12 failed only at `Upload release assets` -- build, bundle, verify-signing and notarize all passed, so the path is sound.
9. **The bypass is not a recent regression** (checked 2026-11-14 against @lance's hypothesis that the ove

Historical superseded cache research and proposal, part 2: rride was added in the last 2-3 days):
   - `git log -G'RUSTC_WRAPPER' -- taskfiles/ci.yml` -> one commit, `c489fa7` (2026-03-26, "refactor(ci): adopt og_basketball CI patterns"). Nothing since; `git log --all --since=2026-11-08 -S RUSTC_WRAPPER` touches only `benchmarks/` and backlog docs.
   - The root `RUSTC_WRAPPER: sccache` line is from `413228e` (2026-02-23).
   - Not a Task version change either: probe results are identical on 3.48.0, 3.49.1, 3.50.0, 3.52.0, 3.53.1 and 3.54.0, and no Task release shipped in the last 3 days (latest stable 3.54.0, 2026-10-01).
   - The successful macOS release job log (run 34723576889, 2026-09-12) contains **zero** occurrences of `sccache` -- no install, no wrapper, no stats -- and its `Install Task` step reports `Successfully setup Task version v3.53.1`.
   - What *is* new in the last few days is only the surrounding story: `7f7aefd` (2026-11-13) rewrote the docs/builds.md sccache claim, TASK-369.1 measured the empty local cache the same day, and `222d40b`/`b814733` changed the toolchain (nightly -> stable 1.100.0) and profile (thin LTO, cgus 4), which moves wall-clock without touching caching.
10. **Nothing in CI installs sccache at all.** `grep -rn sccache .github/workflows .github/actions` matches only a comment in `profile-bench.yml`; the composite action has no sccache step (its Windows cache step is `Swatinem/rust-cache@v2` with `cache-targets: "false"`, `cache-on-failure: "true"`). The installer exists only as `task cargo:install-sccache`, which no workflow calls. So AC#1's "or an explicit disabled statement" is the current truth on every platform, and AC#2 needs provisioning plus a cache location, not just unwrapping the wrapper.
11. **CI's Task version is unpinned.** `.github/actions/setup-tauri-build/action.yml` and `test.yml` call `go-task/setup-task@v1` with no `version:` input, so CI tracks upstream latest (v3.53.1 observed, v3.54.0 today) while `.tool-versions` pins 3.49.1 and `scripts/runner.sh` defaults to 3.49.1. Any env-merge fix must be verified on both, and pinning the input (from `.tool-versions`, as the action already does for Rust/Zig) is a cheap in-scope hardening.

## Phase 1 -- instrumentation (AC#1), lands with no behaviour change

- `scripts/ci-cache-report.sh` (bash; macOS + Git Bash): prints effective `RUSTC_WRAPPER` and whether that binary resolves, `SCCACHE_DIR` + `SCCACHE_MAX_CACHE_SIZE` + on-disk cache size, `CARGO_HOME`, `CARGO_TARGET_DIR`, target-dir size, `sccache --show-stats` when the wrapper is active **or an explicit `sccache DISABLED: <reason>`** (no wrapper / binary missing / platform by design); plus `git status --porcelain crates/mt-tauri/gen/schemas` as the TASK-361 build-script guard; appends a one-line JSON record to `$GITHUB_STEP_SUMMARY`.
- `task ci:cache-report` (+ `ci:cache-zero` to `sccache --zero-stats` before the build so the after-stats are per-job).
- Wire into `release.yml` for all three jobs: zero+report before `ci:build`, report after `ci:bundle` (`if: always()`). Linux prints the explicit "cargo-chef layers, sccache not used here" statement.

## Phase 2 -- enable the caches that demonstrate hits (AC#2, AC#3 enablers)

- `taskfiles/ci.yml`: delete the leaked file-level `RUSTC_WRAPPER: ""`; set `RUSTC_WRAPPER: ""` explicitly on the tasks that must stay deterministic and where sccache cannot help (`check`, `unused-deps`, `shadow-diff` -- `--emit=metadata` compiles are non-cacheable); give `build`/`bundle` a resolved wrapper via `env.RUSTC_WRAPPER.sh` -> `sccache` only when opted in and the binary exists, else empty.
- `.github/actions/setup-tauri-build/action.yml`: new inputs `rust-cache-targets` and `rust-cache-sccache-dir` (both default off) so the release legs can opt in without changing test.yml.
- `.github/actions/setup-tauri-build/action.yml` + `.github/workflows/test.yml`: give `go-task/setup-task@v1` a `version:` read from `.tool-versions` (same pattern the action already uses for Rust and Zig) so the env-merge semantics the fix depends on stop drifting underneath it (finding 11).
- `release.yml`: install/verify sccache per platform (macOS `task cargo:install-sccache`; Windows pinned GitHub release zip), export `SCCACHE_DIR` + `SCCACHE_MAX_CACHE_SIZE`, opt in with the flag from step above. If sccache cannot be provisioned on a platform, that platform ships the documented-reason branch of AC#2.

## Phase 3 -- measure (AC#3, AC#4)

`.github/workflows/cache-bench.yml`, tag-triggered (`bench-cache-*`) like profile-be

Historical superseded cache research and proposal, part 3: nch.yml. Matrix platform x config x run; one build per job (hyperfine with `--prepare 'rm -rf target'` would defeat a restored target cache, so time `task ci:build` and `task ci:bundle` as separate measured steps and read the cache restore/save time from the step logs):

| platform | configs | runs |
| --- | --- | --- |
| macOS (`mini`) | baseline, sccache | 3 (run 1 warms the runner's cache, runs 2-3 measured) |
| Windows (Blacksmith) | baseline, sccache, target-cache, sccache+target-cache | 3 (first populates the key, last two measured) |

Each job records a TSV (build s, bundle s, target KiB, sccache hits/misses/rate), the cache-report JSON, artifact sizes, the Last.fm probe-key assertion, and the gen/schemas cleanliness check; artifacts uploaded per job. Collated into `benchmarks/ci-cache/results-<date>/SUMMARY.md` (committed) and the per-job before/after table copied into this task's notes (AC#4). Winners get enabled in release.yml; losers stay off with their numbers recorded.

## Phase 4 -- docs (AC#5)

Rewrite `docs/builds.md` `### sccache`: which taskfiles/tasks actually get the wrapper (and that the file-level empty string used to strip it repo-wide), cache location + persistence per platform, measured hit rate and benefit, how to disable, the `crate-type` non-cacheable ceiling pointing at TASK-369.2; fix the Windows runner label in Build Strategy (line 11), the `build-windows` section (line 751) and CI Runner Policy (line 790); add a "CI compile cache" table with the before/after numbers; record the CARGO_HOME/rust-cache path finding.

## Sequencing / risk

- Phases 1 and 3's baseline column are safe to land first: no build behaviour changes.
- Do not enable sccache on Windows until a run proves it installs and produces hits; Blacksmith runner variance is +-35% between passes at n=2 (TASK-369.4), so every comparison is run inside one matrix pass on identical inputs.
- Commits: atomic per phase (harness, then results, then docs), `task lint && task format` + `actionlint` + `hadolint` before each.

## Open decisions (awaiting @lance)

1. Measurement harness: dedicated `cache-bench.yml` (recommended, no release side effects) vs dispatching real `release.yml` (pollutes `latest` release assets + pushes README to main).
2. Approval to spend the CI: ~18-24 jobs, ~1.5-2 Blacksmith runner-hours plus ~12 release builds on the `mini` runner.
3. sccache opt-in shape: explicit `CI_ENABLE_SCCACHE=1` from the release workflow (recommended) vs auto-on-whenever-sccache-is-installed.
4. Scope of the env fix: Phase 2 removes the leaked line, which per the control matrix is also what silently turns sccache on for every local `task tauri:*` / `task build` on every dev machine (the documented behaviour). Acceptable as the intended fix, or gate the repo-wide change behind the same opt-in and leave the leak in place? And does finding 5 (Windows `CARGO_HOME={{.ROOT_DIR}}/.cache/cargo` vs the `~/.cargo` path `Swatinem/rust-cache` restores) get fixed here, or become a follow-up task?
<!-- SECTION:NOTES:END -->
