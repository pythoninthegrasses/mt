---
id: TASK-363
title: >-
  Stage Zig sidecar before cargo clippy/test in the Rust Lint, Format, and Test
  CI job
status: To Do
assignee: []
created_date: '2026-11-13T19:06:00Z'
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
- [ ] #1 Rust Lint, Format, and Test job gets past the mt-tauri build script on macOS, Linux and Windows
- [ ] #2 Chosen approach (real staged sidecar vs placeholder) is documented in docs/builds.md or taskfiles/ci.yml with its rationale
- [ ] #3 The rust job does not gain a hard dependency on Zig-side failures (Zig work must still not extend the critical path unless intended)
- [ ] #4 A failed or skipped sidecar step cannot leave modified crates/mt-tauri/gen/schemas/*.json in the working tree
<!-- AC:END -->
