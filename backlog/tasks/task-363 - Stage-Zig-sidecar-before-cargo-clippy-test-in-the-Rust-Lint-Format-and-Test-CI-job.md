---
id: TASK-363
title: >-
  Stage Zig sidecar before cargo clippy/test in the Rust Lint, Format, and Test
  CI job
status: Done
assignee: []
created_date: '2026-11-13T19:06:00Z'
updated_date: '2026-11-14T02:56:00Z'
labels:
  - ci
  - zig
dependencies: []
references:
  - 'https://github.com/pythoninthegrasses/mt/actions/runs/38488090690'
  - taskfiles/zig.yml
  - taskfiles/ci.yml
  - crates/mt-tauri/tauri.conf.json
priority: high
type: bug
ordinal: 66500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The Rust Lint, Format, and Test job fails in the mt-tauri build script with `resource path binaries/mt-zig-core-aarch64-apple-darwin doesn't exist` (run 38488090690). tauri.conf.json declares the Zig core as an externalBin, so tauri-build requires crates/mt-tauri/binaries/mt-zig-core-<rust-triple> to exist for any cargo check/clippy/test. Locally this is satisfied by `task zig:stage TARGET=<triple>`; the main rust job deliberately carries no Zig toolchain (see taskfiles/ci.yml ci:shadow-diff notes and TASK-355.4/355.5), so nothing stages it. Run 43487738027 had this job still queued when cancelled; expect the same failure. Reproduced locally while working on TASK-361: cargo check fails with the same message until the sidecar is staged, and a failed build script also rewrites crates/mt-tauri/gen/schemas/*.json. Decide between installing Zig in the rust job and staging, or staging a placeholder file for non-Zig jobs.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Rust Lint, Format, and Test job gets past the mt-tauri build script on macOS, Linux and Windows
- [x] #2 Chosen approach (real staged sidecar vs placeholder) is documented in docs/builds.md or taskfiles/ci.yml with its rationale
- [x] #3 The rust job does not gain a hard dependency on Zig-side failures (Zig work must still not extend the critical path unless intended)
- [x] #4 A failed or skipped sidecar step cannot leave modified crates/mt-tauri/gen/schemas/*.json in the working tree
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Research findings:
- tauri-build resolves externalBin eagerly; any cargo check/clippy/test needs crates/mt-tauri/binaries/mt-zig-core-<rust-triple>[.exe] to exist.
- The rust job (macOS ARM64) runs `cargo clippy` and `cargo nextest run --workspace` with no Zig. build matrix macOS/Windows runs `task ci:check`, which also has no zig:stage dep (same failure expected); Linux uses Docker that stages the real sidecar.
- crates/mt-tauri/src/shadow_diff_parity_test.rs (2 tokio tests, not #[ignore]) spawns the REAL sidecar and panics if absent, so a placeholder alone leaves `cargo nextest run --workspace` red. The shadow-diff job (Zig + continue-on-error) already covers these tests.

Proposed approach (placeholder, not real stage):
1. Add task `zig:stage-placeholder` (TARGET required, same triple handling and .exe suffix as zig:stage): writes an empty stub only if the target file is absent, so a real staged binary is never clobbered. No Zig dependency.
2. rust job: run the placeholder task before fmt/clippy/nextest; nextest excludes `shadow_diff_parity_test::` via filter expr (covered by shadow-diff job).
3. ci:check: depend on the placeholder so build-matrix macOS/Windows get past the build script too.
4. Because the stub step runs before any cargo invocation and is a plain file write, a failure there means cargo never runs, so gen/schemas/*.json cannot be rewritten (AC#4).
5. Document rationale in docs/builds.md (Sidecar Packaging section) and the taskfile summary.

Real-stage alternative rejected: installs Zig in the rust job, adds Zig build time and Zig-side failure modes to the critical path (AC#3).

Verification: locally remove the staged binary, run the placeholder task + `cargo check`/clippy; run nextest with the exclusion filter; confirm git status shows no gen/schemas changes; actionlint on test.yml.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented (uncommitted): taskfiles/zig.yml zig:stage-placeholder; taskfiles/ci.yml ci:check depends on it (TARGET now required); test.yml rust job stages placeholder and nextest excludes shadow_diff_parity_test::; docs/builds.md Sidecar Packaging documents rationale.
Local verification (macOS arm64): with the staged binary removed, cargo check failed with the reported error; after the placeholder step the build script passes, nextest (excluding parity tests) 890 passed, gen/schemas unchanged, actionlint clean.
Blocker for a green rust job, out of scope: `cargo clippy --workspace --all-features -- -D warnings` now fails with 7 pre-existing lints in commands/plex.rs:208, db/removed.rs:152, plex/downloader.rs:138,239, lib.rs:691.
Not verified locally: Windows ci:check leg and Linux; needs a CI run.

CI verification: Test workflow_dispatch run 43547837354 on f40a2c5. Rust Lint, Format, and Test passed; Build macos, windows and linux passed; Vitest, Zig and shadow-diff passed. Playwright failed on 5 webkit tests (lastfm auth errors, type-to-jump debounce, 3 plex cloud-badge tests), unrelated to sidecar staging.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added zig:stage-placeholder, which writes an empty sidecar stub only when absent, and wired it into the rust job and ci:check so the mt-tauri build script passes without a Zig toolchain. The rust job excludes shadow_diff_parity_test:: from nextest (covered by the shadow-diff job). Rationale is documented in docs/builds.md. Verified in CI run 43547837354: the rust job and the macOS, Windows and Linux build legs all pass.
<!-- SECTION:FINAL_SUMMARY:END -->
