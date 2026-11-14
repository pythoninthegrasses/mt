---
id: TASK-369.10
title: Test Windows builds on the local libvirt VM before pushing to CI
status: Done
assignee:
  - lance
created_date: '2026-11-14T17:28:00Z'
updated_date: '2026-11-14T18:24:00Z'
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
- [x] #1 Guest has the CI toolchain installed: git, cmake, nodejs-lts, go-task, rustup with the pinned toolchain and x86_64-pc-windows-msvc target, VS 2022 VC++ workload, and zig 0.16.0 exactly as pinned in .tool-versions
- [x] #2 The CI build sequence (de-tasked in guest mode -- go-task is bypassed on Windows because its shell model breaks this taskfile; see driver.ps1 header) completes in the guest and produces an NSIS .exe under target/x86_64-pc-windows-msvc/release/bundle/nsis/
- [x] #3 A single driver script (scripts/driver.ps1, dual-mode: macOS driver + guest build/smoke) installs the artifact silently, launches the app via a console-session scheduled task, and verifies the process tree (mt.exe alive, mt-zig-core sidecar child present)
- [x] #4 The smoke fails on ERROR lines in the app log under AppData, and cleans up (process stopped, scheduled task deleted, uninstalled) so a re-run starts from a known state
- [x] #5 docs/builds.md documents the VM as the Windows pre-CI gate: how to reach the guest, what the driver does, and what it cannot test (CI-only signing, blacksmith runner variance)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Three go-task failure modes on Windows are documented in driver.ps1's header (Go LookPath vs npm, embedded shell vs zig paths, stale sshd machine-PATH) -- if CI ever moves off the GH runner image, the guest's de-tasked path is the reference. Smoke's /ST warning from schtasks is benign (documented in-line). A GUI launch needs an active console session on the guest; autologon provides it.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Proven end-to-end on 2026-11-14. One file (scripts/driver.ps1) is both the macOS driver and the guest build+smoke; it also folds the old scripts/build.ps1 as guest mode 'release' (with the zig sidecar step that script lacked, and the toolchain pin read from .tool-versions). Guest build: npm ci 10 s, vite 1.1 s, zig sidecar 0.16.0 staged, cargo tauri build 7m03s on 8 vCPU, NSIS mt_1.6.0_x64-setup.exe 4,711,740 bytes (unsigned; CI's signed artifact was 4.31-4.48 MB in the TASK-369.4 bench). Smoke: RESULT PASS on all checks -- silent install exit 0, per-machine install at C:\Program Files\mt, mt-zig-core.exe staged next to the binary, mt.exe + sidecar alive after 30 s, 12 msedgewebview2 processes, 0 ERROR lines in the app log, uninstall verified. Connectivity by tailnet IP with the host key pinned project-locally (no ssh-config entry); the ~/.ssh/config change from earlier in the session was reverted at the user's request.
<!-- SECTION:FINAL_SUMMARY:END -->
