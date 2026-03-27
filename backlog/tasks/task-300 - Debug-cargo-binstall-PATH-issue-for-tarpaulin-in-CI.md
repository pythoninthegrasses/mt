---
id: TASK-300
title: Debug cargo-binstall PATH issue for tarpaulin in CI
status: Done
assignee: []
created_date: '2026-03-19 04:00'
updated_date: '2026-03-19 22:46'
labels:
  - ci
  - bug
dependencies: []
references:
  - >-
    https://github.com/pythoninthegrass/mt/actions/runs/23278515091/job/67686711086
  - .github/workflows/ci.yml
priority: high
ordinal: 2000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

After switching to `cargo-binstall` for installing `cargo-tarpaulin` in CI (commit `cf09f50`), the "Build & Rust Tests" job fails with:

```
error: no such command: `tarpaulin`
```

The `cargo binstall --no-confirm cargo-tarpaulin` step succeeds — it reports `cargo-tarpaulin v0.35.2 is already installed` (from cache). However, the subsequent `cargo tarpaulin` command cannot find the binary.

## Root Cause (Suspected)

PATH / CARGO_HOME mismatch. The `cargo-binstall` action installs the binary to one location, but `cargo` looks for subcommands in a different directory. Key observations from the logs:

- `CARGO_HOME=/Users/lance/.cargo` (set by binstall action)
- PATH includes `/Users/lance/.cargo/bin` (set by Tauri build environment step)
- binstall reports the binary is "already installed" — likely cached from a previous `cargo install` run and sitting in a different bin dir than where binstall would place it
- The self-hosted runner may have stale cached binaries in a location no longer on PATH

## Relevant CI Config

- Workflow: `.github/workflows/ci.yml`
- Steps: "Run cargo-bins/cargo-binstall@main" → "Install cargo-tarpaulin" → "Run Rust tests with coverage"
- Runner: self-hosted macOS (ARM64)

## Failed Run

https://github.com/pythoninthegrass/mt/actions/runs/23278515091/job/67686711086
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 cargo-tarpaulin installs and runs successfully via cargo-binstall in CI
- [x] #2 Coverage report is generated and uploaded as artifact
- [x] #3 CI pipeline passes end-to-end on self-hosted macOS runner
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Investigation Findings

- **Build & Rust Tests** ran on runner `mini` (Mac Mini), NOT `studio` (Mac Studio)
- **Playwright E2E Tests** ran on runner `studio`
- The Mac Mini may not have cargo-binstall installed at the same paths, or may have a stale cached tarpaulin binary in a location not on PATH
- binstall reported "cargo-tarpaulin v0.35.2 is already installed" — this means it found a metadata record but the actual binary may not be where cargo looks for it
- Key question: does the Mac Mini have the same CARGO_HOME / PATH setup as the Studio? The previous `cargo install` approach may have placed tarpaulin in a different bin directory than where binstall expects it

## Debug Steps

1. SSH into Mac Mini and check `which cargo-tarpaulin`, `ls ~/.cargo/bin/cargo-tarpaulin`
2. Compare CARGO_HOME and PATH between Mini and Studio runners
3. Consider adding `--force` flag to binstall to ensure fresh install to correct location
4. Add `which cargo-tarpaulin` and `echo $PATH` debug steps to CI workflow
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Fix

Added `--force` flag to `cargo binstall` in `.github/workflows/test.yml` so tarpaulin is always installed to `~/.cargo/bin/` regardless of stale metadata.

## Root Cause

`~/.cargo/.crates.toml` on the Mac Mini runner had metadata from a previous `cargo install cargo-tarpaulin` (installed via mise to `~/.local/share/mise/shims/`). Binstall found the metadata, reported "already installed", and skipped — but the binary wasn't in `~/.cargo/bin/` where `cargo tarpaulin` looks.

## Verification

- Force-installed tarpaulin on Mini via SSH, confirmed binary at `~/.cargo/bin/cargo-tarpaulin`
- CI run [23319951069] passed all 4 jobs end-to-end (Build & Rust Tests, Playwright E2E, Vitest, Lint)
<!-- SECTION:FINAL_SUMMARY:END -->
