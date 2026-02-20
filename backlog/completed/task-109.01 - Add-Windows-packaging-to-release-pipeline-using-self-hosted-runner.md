---
id: TASK-109.01
title: Add Windows packaging to release pipeline using self-hosted runner
status: Done
assignee: []
created_date: '2026-02-18 20:12'
updated_date: '2026-02-18 22:01'
labels:
  - windows
  - ci
  - infrastructure
dependencies: []
references:
  - .github/workflows/release.yml
  - .github/actions/setup-tauri-build/action.yml
  - crates/mt-tauri/tauri.conf.json
  - crates/mt-tauri/.cargo/config.toml
  - taskfiles/tauri.yml
  - docs/builds.md
  - 'https://github.com/louis-e/arnis/blob/main/.github/workflows/release.yml'
documentation:
  - 'https://v2.tauri.app/start/prerequisites/#windows'
  - 'https://tauri.app/distribute/windows-installer/'
parent_task_id: TASK-109
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Wire up CI/CD pipeline to produce Windows NSIS installers using the existing self-hosted Windows runner, with self-signed code signing to avoid Windows Defender false positives.

## Context

The project builds and packages for macOS (self-hosted ARM64 runner) and Linux (ubuntu-latest). Windows is a placeholder in `docs/builds.md` with zero implementation. A self-hosted Windows runner is already registered with labels `[self-hosted, Windows, X64]`.

## Scope

1. **Runner prerequisites** (already provisioned with labels `[self-hosted, Windows, X64]`):
   - Runner-level (one-time): `choco install visualstudio2022buildtools --package-parameters "--add Microsoft.VisualStudio.Workload.VCTools --add Microsoft.VisualStudio.Component.Windows11SDK.22621"` and WebView2 runtime
   - Action-level (in `setup-tauri-build`): `choco install cmake` (mirroring the macOS `brew install cmake` pattern)

2. **Cargo target**: Add `x86_64-pc-windows-msvc` to `.cargo/config.toml` with `rust-lld` linker

3. **Tauri bundle config**: Add `nsis` to `tauri.conf.json` bundle targets

4. **CI job**: New `build-windows` job in `release.yml` using `runs-on: [self-hosted, Windows, X64]`, mirroring `build-linux-amd64` pattern

5. **Composite action**: Extend `setup-tauri-build` with Windows step using Chocolatey

6. **Self-signed code signing** (mirroring [arnis](https://github.com/louis-e/arnis) approach):
   - Install Windows SDK via Chocolatey for `signtool.exe`
   - Generate self-signed CodeSigningCert at build time: `New-SelfSignedCertificate -Type CodeSigningCert -Subject 'CN=MT'`
   - Sign the NSIS installer exe with `signtool sign` + DigiCert timestamp server
   - Store cert password as `WINDOWS_CERT_PASSWORD` repository secret
   - Note: self-signed cert prevents Defender real-time protection flags but does NOT eliminate SmartScreen "unrecognized app" warnings (that requires EV cert + download reputation)

7. **Taskfile**: Add `task tauri:build:windows` command for local builds

8. **Documentation**: Update `docs/builds.md` Windows section with actual configuration

## Out of scope

- Authenticode/EV code signing (eliminates SmartScreen warnings) — follow-up task
- Code signing for macOS is handled separately

## Technical notes

- Tauri Windows prereqs: WebView2, Visual Studio Build Tools (MSVC v143+, Windows 11 SDK)
- Tauri NSIS bundle: generates `.exe` installer with `/S` silent install support
- Use Chocolatey for Windows dependency management (mirrors Homebrew on macOS)
- Self-signed signing reference: arnis `release.yml` uses `choco install windows-sdk-10.1`, `New-SelfSignedCertificate`, and `signtool sign /f cert.pfx /t http://timestamp.digicert.com`
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 release.yml has a build-windows job on [self-hosted, Windows, X64] that produces an NSIS .exe installer
- [x] #2 setup-tauri-build composite action uses Chocolatey for Windows deps (parallel to Homebrew on macOS)
- [x] #3 .cargo/config.toml has x86_64-pc-windows-msvc target with rust-lld
- [x] #4 tauri.conf.json bundle targets include nsis
- [x] #5 task tauri:build:windows works for local builds on a Windows machine
- [x] #6 NSIS .exe installer is self-signed with signtool (self-signed cert + DigiCert timestamp)
- [x] #7 Signed .exe installer attaches to the draft GitHub Release alongside macOS/Linux artifacts
- [x] #8 docs/builds.md Windows section updated from placeholder to actual config
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Changes

### Config files
- `crates/mt-tauri/.cargo/config.toml`: Added `x86_64-pc-windows-msvc` target with `rust-lld` linker
- `crates/mt-tauri/tauri.conf.json`: Added `nsis` to bundle targets, added `windows.nsis` config with `installMode: "both"`

### CI/CD
- `.github/actions/setup-tauri-build/action.yml`: Added Windows step using Chocolatey to install cmake (parallel to Homebrew on macOS and apt on Linux)
- `.github/workflows/release.yml`: Added `build-windows` job on `[self-hosted, Windows, X64]` with:
  - Windows SDK install for signtool.exe
  - Self-signed CodeSigningCert generation (CN=MT) exported to PFX
  - Config override file with `bundle.windows.signCommand` pointing to signtool + DigiCert timestamp
  - tauri-action builds NSIS installer with signing, uploads to draft release
  - Cleanup step removes cert, config override, and cert store entry

### Taskfile
- `taskfiles/tauri.yml`: Added `WINDOWS_X64_TARGET` var, `build:windows` task, and `windows/amd64` case in auto-detect

### Documentation
- `docs/builds.md`: Replaced Windows placeholder with full documentation covering prerequisites, bundle config, self-signed signing flow, environment variables, local builds, and CI job description
<!-- SECTION:FINAL_SUMMARY:END -->
