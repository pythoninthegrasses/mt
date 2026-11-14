---
id: TASK-369.10
title: Test Windows builds on the local libvirt VM before pushing to CI
status: In Progress
assignee:
  - lance
created_date: '2026-11-14T17:28:00Z'
labels: []
dependencies: []
references:
  - docs/builds.md
  - scripts/driver.ps1 (folds the old scripts/build.ps1)
  - .github/workflows/release.yml
parent_task_id: TASK-369
priority: medium
ordinal: 77500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Windows is the only release leg that cannot be built or run on the Mac, so every Windows problem (linker errors, sidecar placement, NSIS packaging, WebView2 runtime, Defender SmartScreen) is discovered only after CI minutes are spent. A Windows 11 LTSC guest under libvirt on the Fedora host is idle and has the resources to be the pre-CI gate: build with the same commands the release workflow runs, install the NSIS artifact, launch the app, and check the result -- all before pushing.

Scope: one-time guest provisioning (Chocolatey prerequisites, pinned Zig, repo tree), a driver script on the Mac that ships the tree and the artifact over SSH, a guest-side smoke (silent install, scheduled-task launch, process/log checks, clean exit), and documentation in docs/builds.md so the flow does not live only in this session.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Guest has the CI toolchain installed: git, cmake, nodejs-lts, go-task, rustup with the pinned toolchain and x86_64-pc-windows-msvc target, VS 2022 VC++ workload, and zig 0.16.0 exactly as pinned in .tool-versions (PATH fallback, not mise -- the guest has no mise)
- [ ] #2 task ci:build TARGET=x86_64-pc-windows-msvc and task ci:bundle TARGET=x86_64-pc-windows-msvc BUNDLES=nsis complete in the guest and produce an NSIS .exe under target/x86_64-pc-windows-msvc/release/bundle/nsis/
- [ ] #3 A driver script installs the artifact into the guest silently, launches the app via a console-session scheduled task (GUI apps over SSH die in the service session), and verifies the process tree (mt.exe alive, mt-zig-core sidecar child present)
- [ ] #4 The smoke fails on ERROR lines in the app log under AppData, and cleans up (process stopped, scheduled task deleted) so a re-run starts from a known state
- [ ] #5 docs/builds.md documents the VM as the Windows pre-CI gate: how to reach the guest, what the driver does, and what it cannot test (CI-only signing, blacksmith runner variance)
<!-- AC:END -->
