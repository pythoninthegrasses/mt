---
id: TASK-369.4
title: Benchmark release profile LTO and codegen-units settings
status: In Progress
assignee:
  - lance
created_date: '2026-11-14T04:24:00Z'
updated_date: '2026-11-14T07:59:00Z'
labels: []
dependencies: []
documentation:
  - docs/builds.md
parent_task_id: TASK-369
type: spike
ordinal: 4000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The release profile is the most aggressive setting in the repo: opt-level=s, panic=abort, strip, codegen-units=1 and lto=true (fat). Cargo's own docs note fat LTO costs substantially more link/compile time than thin LTO for similar gains, and codegen-units=1 serializes codegen. Since the release matrix is dominated by exactly these builds (Windows 399-464 s, Linux up to 598 s in the Feb-May 2026 release runs), and every cold local release build a developer runs pays this too, the profile deserves a benchmark sweep before any migration decision assumes it is irreducible. Baseline the current profile on one target (aarch64-apple-darwin plus one CI-parity run per platform if feasible), sweep lto in {fat, thin, false} x codegen-units in {1, 4, 16}, and keep the winner only if binary size and playback-related runtime regressions stay within agreed bounds. Document the accepted trade explicitly so future contributors do not re-tune blindly.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Hyperfine table of release build wall-clock for the lto x codegen-units matrix recorded in task notes, per platform where runners allow
- [ ] #2 Binary size and DMG/NSIS artifact size recorded for each profile candidate
- [ ] #3 A playback/perf smoke check (launch, load library, play a track) run on the candidate that wins
- [ ] #4 Chosen profile committed to Cargo.toml with a comment stating why, or an explicit decision to keep the current profile recorded in task notes
- [ ] #5 docs/builds.md performance section updated with the matrix results and the accepted trade-off
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Harness: `benchmarks/release-profile/` (`env.sh`, `sweep.sh`, `README.md`), same shape and conventions as TASK-369.1's `benchmarks/edit-to-run/`. Raw artifacts land in `benchmarks/release-profile/results-<date>/` and are committed so a later task can diff them.

## Measurement design

- **Measured command (CI-parity build step):** `cargo build --release --target aarch64-apple-darwin -p mt-tauri` with default features (CI's macOS release leg is `task ci:build TARGET=aarch64-apple-darwin` -> `tauri build --no-bundle --target aarch64-apple-darwin --config '{"build":{"beforeBuildCommand":""}}'`, and tauri.conf.json declares no build features, so default features is the CI shape). The Rust compile+link is what the profile controls, so the matrix times cargo directly; `tauri bundle` only packages.
- **Matrix:** lto in {true(fat), thin, false} x codegen-units in {1, 4, 16} = 9 candidates. Set per-run via `CARGO_PROFILE_RELEASE_LTO` / `CARGO_PROFILE_RELEASE_CODEGEN_UNITS` (no Cargo.toml churn between candidates). `./sweep.sh doctor` proves the env override reaches rustc (a bogus value is rejected by rustc as `-C lto`).
- **Timing:** hyperfine, `--runs 2 --warmup 0`, `--prepare 'rm -rf $TARGET/release $TARGET/<triple>'` so every run is a cold release build; screening pass first, then `head2head` re-times baseline + top candidates in ONE hyperfine invocation (3 runs) so the relative column is directly comparable.
- **sccache off for the matrix** (TASK-369.1 finding 6: identical repeat builds come back from cache, which would measure cache lookups, not codegen). `./sweep.sh ci-parity` re-measures baseline + winner with `RUSTC_WRAPPER=sccache` to record what a warm-cache CI leg actually pays.
- **Scratch target dir** (`.cache/bench-369-4/target`), never the main checkout's `target/`.
- **Per candidate:** binary bytes, `size -m` `__TEXT`, `libmt_lib.a` bytes (the staticlib byproduct TASK-369.1 found dominates artifact cost), `du` of the triple + host target dirs, and a `tauri bundle --bundles dmg` DMG copied to `results-<date>/dmg/<candidate>.dmg` (filenames collide otherwise).
- **Runtime signals for baseline vs winner:** `MT_ENUMERATE_DEVICES=1 <bin>` launch proxy (hyperfine, 10 runs; exercises the real CoreAudio enumeration path in `audio/device_isolation.rs`) and `--timings` HTML archived per side.

## Known confounds to state in the record

1. `crate-type = ["staticlib","cdylib","rlib"]` (crates/mt-tauri/Cargo.toml:13) makes fat LTO run for artifacts nothing links; TASK-369.1 measured 150s -> 69s on the release build when they were removed. The matrix runs as committed, so absolute numbers include that cost; the LTO/codegen-units ordering is what is being decided here, and the crate-type change stays TASK-369.2's call.
2. Windows/Linux legs need their own runners. Plan: host (aarch64-apple-darwin) is authoritative; NSIS and .deb sizes for the *current* profile are taken from the published v1.6.0 release assets (DMG 5 406 641 B, deb 6 233 458 B, NSIS 4 102 200 B) as the reference; per-candidate Windows numbers are out of reach on this host and get recorded as a follow-up needing a runner.

## Steps

1. `./sweep.sh doctor` -- toolchain, sidecar staged, frontend dist, tauri CLI, profile-env-override proof. [done: pass]
2. `./sweep.sh probe` -- one cold build at the committed profile: validates the pipeline and prices a run.
3. `./sweep.sh matrix 2` -- 9 candidates x 2 cold runs, sizes + DMG each.
4. `./sweep.sh head2head true:1 <top2>` -- 3 runs head-to-head; pick the winner.
5. `./sweep.sh ci-parity` for baseline + winner; `timings` + `launch` for both.
6. AC#3 smoke on the winner: isolated `HOME` (fresh `com.mt.desktop` container, user's real `mt.db` untouched), `settings.json` seeded with `music_dirs` (frontend-only key, `js/stores/settings.js:77,100`) over a fixture library built from `crates/mt-tauri/tests/fixtures/test_sample.*`, winner profile built with `--features mcp` so the MCP bridge (port 9223, token from `MT_LOG=debug` startup line) can drive `/scan` then `/player` play and assert position advances + `audio_available`. The plain (no-feature) winner binary gets a launch + window-render screenshot pass.
7. Decide per the agreed bounds, then either commit the winning profile to Cargo.toml with a why-comment or record the keep-current decision.
8. Update `docs/builds.md` Performance with the matrix table + accepted trade-off; commit harness + results atomically with the docs change.

## Bounds proposed for "keep the winner" (awaiting user confirmation)

- Build time must improve by >= 15% over `lto=true, cgus=1` to justify a change at all.
- Release binary (and DMG) may not grow by more than 5% over baseline.
- Playback smoke must pass identically to baseline; launch-proxy mean within 10% of baseline.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Decisions from @lance (2026-11-14)

**Adoption bounds (AC#4 gate).** Adopt a candidate over `lto=true, codegen-units=1` only if ALL of: (1) cold release build is >= 15% faster than baseline; (2) release binary AND DMG grow by no more than 5% over baseline; (3) the playback smoke (launch, load library, play a track) passes identically to baseline. Otherwise keep the committed profile and document the matrix as the reason.

**Platform coverage (AC#1).** Beyond this host, also measure (a) the Linux x86_64 leg in the project Docker image on `mf` (the AlmaLinux 10.2, 16-core x86_64 host TASK-369.7 used), and (b) a Windows CI job on the real release runner (`blacksmith-4vcpu-windows-2025`), because Windows is the slowest release leg (399-464 s) and cannot be measured locally. The Windows column therefore needs a branch push plus a dispatched workflow; this task may not close until that run lands.

## Harness as built (2026-11-14)

`benchmarks/release-profile/` on branch `spike/369-4-release-profile-bench`, modelled on `benchmarks/edit-to-run/`. The three columns run on three machines because the profile has to be timed where it ships:

| Column | Command | Timed unit |
| --- | --- | --- |
| macOS (host, authoritative) | `./sweep.sh matrix 2` | `cargo build --release --target aarch64-apple-darwin -p mt-tauri`, default features |
| Linux x86_64 | `BRANCH=<branch> RUNS=2 ./linux-on-mf.sh` | `bash tauri-build.sh build` in `docker/linux`'s `deps` image on mf |
| Windows x64 | push tag `bench-profile-*` → `.github/workflows/profile-bench.yml` | `bash tauri-build.sh build` on `blacksmith-4vcpu-windows-2025` |

Deviations from the plan, and why:

- **Windows is triggered by a tag, not `workflow_dispatch`.** GitHub only offers dispatch for workflows that exist on the default branch, so a spike branch cannot dispatch. Inputs are empty on a tag push and `fromJSON('')` fails the matrix before any job starts, so the nine candidates are hard-coded in the matrix and only the run count is an input.
- **mf builds in a git worktree** (`~/git/mt-369-4` from `origin/<branch>`), per @lance's correction, not an rsync'd copy. The container runs as root to keep the image's `CARGO_HOME` (tauri-cli + a warm crates.io cache) and `chown`s the tree back afterwards.
- **All columns use `tauri-build.sh`.** Hyperfine hands its command to a second shell, which ate the `--config` JSON's quotes when the invocation was written inline in each driver.
- **The host column times the bare cargo invocation** (what `task ci:build` ultimately runs); `./sweep.sh cli-head2head true:1 <winner>` re-measures the shortlist through the Tauri CLI so the "what CI pays" claim rests on a measurement.
- **A candidate that fails no longer kills the pass.** Fat LTO with 16 codegen units is the memory-hungry corner; `set -e` used to turn one such failure into a lost 40-minute pass. The matrix now continues, and `run_candidate` skips candidates already measured (`FORCE=1` to re-measure).
- **AC#3 is `smoke.sh`, not the Playwright suite.** The `@tauri` Playwright specs only drive a vite preview and never launch the built binary, so they cannot answer "does the shipped artifact still play audio". `./smoke.sh <lto> <cgus>` builds the candidate plus the `audio_test` example, bundles the `.app` (so the sidecar sits where `externalBin` expects), and checks the CoreAudio enumeration subprocess, `mt.db` creation on first launch, a watched-folder scan of `crates/mt-tauri/tests/fixtures`, and playback whose reported position must advance. It runs under a private `HOME` so baseline and candidate see identical state, writes one summary file each, and AC#3 is met when the two files differ only in the candidate label.
- **`summary` groups by column.** A Blacksmith runner's seconds are not an M4 Max's seconds, so each platform gets its own table against its own `lto-fat-cgus1` baseline, with the 15%/5% bounds visible as ratios.

Baseline so far on the M4 Max (rustc/cargo 1.100.0, 14 jobs, sccache off, cold): `lto=true cgus=1` → 103.6 s ± 1.0, binary 10 742 960 B, `__TEXT` 9 469 952 B, DMG 6 101 334 B; `lto=true cgus=4` → 91.2 s ± 0.9, binary 10 942 752 B, DMG 6 082 790 B. First Linux data point (mf, 16 cores, container from `docker/linux` deps stage, Plex/Syncthing/vllm/honcho running concurrently): `linux-lto-fat-cgus1` → 188.1 s ± 16.4.

The Windows column took three attempts to reach the measured step: `GITHUB_PATH` does not apply within the step that writes it (hyperfine now resolves into `$HYPERFINE` via `GITHUB_ENV`), the frontend task is `ci:frontend-build` (namespaced), and `task zig:stage` locates zig through mise, whose Windows path resolution fails its own `[ -x ]` precondition under Git Bash — the workflow now builds the sidecar with the same flags zig:stage uses.
<!-- SECTION:NOTES:END -->
