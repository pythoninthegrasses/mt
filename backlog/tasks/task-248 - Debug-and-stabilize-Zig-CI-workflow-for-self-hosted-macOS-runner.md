---
id: task-248
title: Debug and stabilize Zig CI workflow for self-hosted macOS runner
status: Done
assignee: []
created_date: '2026-01-29 08:31'
updated_date: '2026-01-29 21:02'
labels:
  - ci
  - zig
  - infrastructure
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The CI workflow for the zig-migration branch is experiencing issues on the self-hosted macOS ARM64 runner. Several fixes have been applied but the workflow may still need additional debugging.

## Context
- Branch: `zig-migration`
- Runner: Self-hosted macOS ARM64 (M4 Mac Mini)
- SSH access: `ssh mini`

## Issues Encountered
1. **Path issue**: Workflow referenced `./src-tauri` which no longer exists after workspace restructuring → Fixed with `--workspace` flag
2. **Zig not installed**: Added `mlugg/setup-zig@v1` action
3. **TagLib not installed**: Added `brew install taglib` step
4. **pkg-config not found**: PATH didn't include `/opt/homebrew/bin` → Added to workflow env
5. **pkg-config not installed**: Had to manually install via `brew install pkg-config`
6. **Artifact upload timeout**: Self-hosted runner intermittent `ETIMEDOUT` errors → Added `continue-on-error: true` to all upload-artifact steps

## Current State
- Workflow file: `.github/workflows/test.yml`
- Last commit: `8a92762` - Added Homebrew to PATH
- PR: https://github.com/pythoninthegrass/mt/pull/18

## Tasks
- [x] Verify CI passes after PATH fix
- [x] Consider pre-installing dependencies on runner vs installing in workflow
- [x] Add Playwright tests job PATH fix if needed
- [x] Document runner requirements (Zig, TagLib, pkg-config)
- [x] Consider caching Homebrew packages for faster CI
- [x] Fix artifact upload timeouts with continue-on-error

## Resolution
All CI issues resolved. The self-hosted runner now has proper PATH configuration, dependencies are conditionally installed only when missing, and artifact uploads gracefully handle network timeouts.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 CI workflow passes on self-hosted macOS ARM64 runner
- [x] #2 Zig build dependencies (TagLib, pkg-config) available
- [x] #3 Homebrew PATH correctly configured
- [x] #4 Artifact upload failures don't fail the entire job
<!-- AC:END -->
