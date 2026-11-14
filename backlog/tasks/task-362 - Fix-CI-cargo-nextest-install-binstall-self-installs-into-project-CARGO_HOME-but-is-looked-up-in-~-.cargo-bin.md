---
id: TASK-362
title: >-
  Fix CI cargo-nextest install: binstall self-installs into project CARGO_HOME
  but is looked up in ~/.cargo/bin
status: Done
assignee:
  - claude
created_date: '2026-11-13T19:06:00Z'
updated_date: '2026-11-14T02:34:00Z'
labels:
  - ci
dependencies: []
references:
  - 'https://github.com/pythoninthegrasses/mt/actions/runs/43487738027'
  - 'https://github.com/pythoninthegrasses/mt/actions/runs/38488090690'
  - taskfiles/ci.yml
priority: high
type: bug
ordinal: 65500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The Rust/Zig Shadow-Diff Parity job (and any job using ci:setup-test) fails with `error: no such command: binstall` in ci:_install-cargo-nextest. Cause: the root taskfile.yml sets CARGO_HOME to the project-local .cache/cargo, so `cargo-binstall --self-install` (run by ci:_install-cargo-binstall) installs into .cache/cargo/bin and only appends that dir to GITHUB_PATH for later steps. taskfiles/ci.yml then runs `cargo binstall` with CARGO_HOME="" and PATH={{.CARGO_BIN}} (~/.cargo/bin), where cargo-binstall does not exist. The same pattern affects _install-tauri-cli. Reproduced identically on the pre-toolchain-change run 38488090690 (2026-10-14) and on run 43487738027 (2026-11-13), so it is not caused by the Rust 1.100 pin (TASK-361).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 ci:_install-cargo-binstall and the tasks that call cargo binstall agree on where cargo-binstall is installed and looked up
- [x] #2 ci:setup-test completes on the Linux Blacksmith runner and cargo nextest --version succeeds afterwards
- [x] #3 ci:_install-tauri-cli has the same fix or is confirmed unaffected
- [x] #4 Rust/Zig Shadow-Diff Parity job gets past setup (it may still fail later for other tracked reasons)
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Set CARGO_HOME="" in ci:_install-cargo-binstall env so the installer (which uses ${CARGO_HOME:-$HOME/.cargo}/bin) installs into {{.CARGO_BIN}}, matching the status check and the _install-cargo-nextest/_install-tauri-cli lookups. 2. Verify locally with task --dry and a sandboxed HOME run of the installer. 3. Push to main and confirm CI.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Fix landed in e591a21 (CARGO_HOME="" on ci:_install-cargo-binstall). Run 43492238392 (sha 4636ac1, contains e591a21): Rust/Zig Shadow-Diff Parity job succeeded; log shows cargo-binstall self-install then cargo-nextest 0.9.151 installed to /home/runner/.cargo/bin. AC3 pending: _install-tauri-cli shares the same env/lookup path so should be fixed, but no job in that run exercised it; needs a run that goes through ci:setup (setup-tauri-build).

Mini runner for pythoninthegrasses (launchd actions.runner.pythoninthegrasses.mini) had been stopped since 2026-11-11 06:13Z (clean shutdown after a broker TLS error), leaving [macOS, ARM64] jobs queued; restarted with launchctl kickstart. Run 43492298017 (23be54a, contains e591a21) then completed: Rust Lint/Format/Test, Shadow-Diff Parity, Build (linux/windows/macos) succeeded; Zig, Vitest, Playwright failed for the tracked reasons (TASK-364/365 fixes are on local main, not yet pushed). AC3: ci:_install-tauri-cli only runs via ci:setup-cargo-tools, reached only by setup-tauri-build mode=full (the default, used by release.yml). test.yml and coverage.yml use mode test/check, and the Linux build uses Docker with its own binstall, so no CI run exercises it. It uses the same CARGO_HOME="" env and ~/.cargo/bin lookup as _install-cargo-nextest, which is now proven; direct verification needs a release run.

AC3 checked by equivalence per Lance: _install-tauri-cli uses the same CARGO_HOME="" env and ~/.cargo/bin lookup as _install-cargo-nextest; not exercised by any current CI run (only release.yml mode=full reaches it).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Set CARGO_HOME="" on ci:_install-cargo-binstall (e591a21) so cargo-binstall self-installs into ~/.cargo/bin, matching the lookups in _install-cargo-nextest and _install-tauri-cli. Verified on runs 43492238392 and 43492298017: ci:setup-test installed cargo-nextest 0.9.151 to ~/.cargo/bin and Shadow-Diff Parity passed. _install-tauri-cli is covered by equivalence only; no current CI path runs it (release.yml mode=full only). Separate finding: the mini self-hosted runner for this repo had been stopped since 2026-11-11 and was restarted with launchctl kickstart; cause of the stop is unknown.
<!-- SECTION:FINAL_SUMMARY:END -->
