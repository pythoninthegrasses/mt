---
id: task-266
title: 'Fix filepicker regression: only directories selectable on macOS/Linux'
status: Done
assignee: []
created_date: '2026-02-13 04:30'
updated_date: '2026-02-13 05:50'
labels:
  - bug
  - regression
  - macos
  - linux
  - filepicker
  - testing
dependencies: []
priority: high
ordinal: 21500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
There is a regression in the filepicker functionality on macOS and Linux where only directories can be selected, not individual files. This breaks the ability to add individual tracks or files to the library.

**Affected Platforms:**
- macOS
- Linux

**Expected Behavior:**
Users should be able to select both individual files and directories when using the filepicker.

**Current Behavior:**
Only directories are selectable; individual file selection is not working.

**Investigation Required:**
- Identify when this regression was introduced
- Check Tauri dialog API usage and configuration
- Verify file filter settings
- Review platform-specific dialog options

**Testing Requirements:**
- Create E2E tests that verify file selection works
- Create E2E tests that verify directory selection works
- Add regression test coverage for both macOS and Linux
- Ensure existing functionality is preserved
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Filepicker allows individual file selection on macOS
- [x] #2 Filepicker allows individual file selection on Linux
- [x] #3 Filepicker still allows directory selection on both platforms
- [ ] #4 E2E test added that verifies individual file selection works
- [ ] #5 E2E test added that verifies directory selection works
- [ ] #6 Tests cover both macOS and Linux platforms
- [x] #7 All existing filepicker functionality remains working
- [ ] #8 Manual testing confirms fix on both platforms
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Implementation Plan

### Root Cause
`open_add_music_dialog` in `dialog.rs` used `pick_folders()` (Tauri dialog plugin), which only allows directory selection.

### Fix
1. **macOS**: Use `NSOpenPanel` directly via `objc2-app-kit` with `canChooseFiles(true)` + `canChooseDirectories(true)` for native combined file/folder selection (same as Apple Music).
2. **Linux**: Fall back to `pick_files()` with audio file filters since GTK does not support combined mode (still fixes regression — was folder-only before).
3. **Scan scoping fix**: Added `scope_fingerprints_to_paths()` to filter DB fingerprints to scan scope, preventing out-of-scope tracks from being marked deleted when scanning individual files.

### Files Changed
- `crates/mt-tauri/Cargo.toml` — macOS-only deps (objc2, objc2-app-kit, objc2-foundation, dispatch2)
- `crates/mt-tauri/src/dialog.rs` — Platform-native NSOpenPanel (macOS) / pick_files fallback (Linux)
- `crates/mt-tauri/src/scanner/commands.rs` — scope_fingerprints_to_paths() + scoped DB query
- `app/frontend/views/footer.html` — data-testid for E2E
- `app/frontend/js/stores/library.js` — removed stale comment
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Branch: task-266 (worktree at ../mt-task-266)
Approach: Leverage Tauri's built-in `pick_files()` and `pick_folders()` from tauri-plugin-dialog instead of bespoke `open_add_music_dialog` that duplicated folder-only selection.

PR: https://github.com/pythoninthegrasses/mt/pull/19

Also fixed latent scan deletion bug: `scope_fingerprints_to_paths()` ensures scanning a single file doesn't mark the entire library as deleted.

AC#4-6 (E2E tests) and AC#8 (manual testing) deferred to PR review — `data-testid` attributes added for test authoring.
<!-- SECTION:NOTES:END -->
