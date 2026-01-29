---
id: task-248
title: Debug and stabilize Zig CI workflow for self-hosted macOS runner
status: In Progress
assignee: []
created_date: '2026-01-29 08:31'
updated_date: '2026-01-29 08:31'
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

## Current State
- Workflow file: `.github/workflows/test.yml`
- Last commit: `8a92762` - Added Homebrew to PATH
- PR: https://github.com/pythoninthegrass/mt/pull/18

## Tasks
- [ ] Verify CI passes after PATH fix
- [ ] Consider pre-installing dependencies on runner vs installing in workflow
- [ ] Add Playwright tests job PATH fix if needed
- [ ] Document runner requirements (Zig, TagLib, pkg-config)
- [ ] Consider caching Homebrew packages for faster CI
<!-- SECTION:DESCRIPTION:END -->
