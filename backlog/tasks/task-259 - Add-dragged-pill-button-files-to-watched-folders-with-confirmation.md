---
id: TASK-259
title: Add dragged/pill-button files to watched folders with confirmation
status: Done
assignee: []
created_date: '2026-02-10 06:01'
updated_date: '2026-02-16 16:55'
labels:
  - library
  - lastfm
  - ux
dependencies: []
priority: high
ordinal: 19500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
When tracks are added to the library via drag-and-drop or the pill button on the bottom bar, their parent directories are not added to watched folders. Only manually configured watched folders are tracked. This causes watched folders to remain empty (null), which breaks Last.fm's ability to match synced favorites to local tracks.

**Current behavior:**
- Dragging files or using the pill button adds tracks to the library but does NOT update watched folders
- Watched folders stays empty/null
- Last.fm favorite sync fails to match tracks because it relies on watched folders to resolve local paths

**Expected behavior:**
- When files are added via drag-and-drop or the pill button, prompt the user with a confirmation dialog: "Would you like to add [directory] to your watched folders?"
- If confirmed, add the parent directory to watched folders
- Last.fm favorite sync should then be able to match tracks to local files via watched folder paths
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Dragging files into the app prompts to add parent directory to watched folders
- [x] #2 Adding files via the bottom bar pill button prompts to add parent directory to watched folders
- [x] #3 Confirmation dialog clearly shows which directory will be watched
- [x] #4 User can decline without affecting the library import
- [x] #5 Watched folders is populated after confirmation, no longer null
- [x] #6 Last.fm synced favorites can match tracks when watched folders are set
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Implementation Complete

Successfully implemented watched folder prompts for drag-and-drop and pill button file imports.

### Changes Made

**New File: `/Users/lance/git/mt/app/frontend/js/utils/watched-folders.js`**
- Created utility module with three core functions:
  - `extractParentDirectories()` - Extracts unique parent directories from file/folder paths
  - `getNewWatchedFolderCandidates()` - Filters out already-watched directories
  - `promptToAddWatchedFolders()` - Shows confirmation dialog and adds directories

**Modified: `/Users/lance/git/mt/app/frontend/main.js`**
- Added import for `promptToAddWatchedFolders`
- Integrated prompt after successful drag-and-drop scan (line 108)

**Modified: `/Users/lance/git/mt/app/frontend/js/stores/library.js`**
- Added import for `promptToAddWatchedFolders`
- Integrated prompt after successful pill button scan (line 877)

**Modified: `/Users/lance/git/mt/app/frontend/tests/watched-folders.spec.js`**
- Added comprehensive E2E tests for utility functions
- Tests cover: parent directory extraction, duplicate detection, user confirmation/decline, multiple directories

### Key Features

1. **Smart filtering**: Only prompts for directories not already watched
2. **Unified dialog**: Shows single dialog for multiple unique directories
3. **Non-blocking**: Scan success not affected if watched folder addition fails
4. **User control**: Clear confirmation dialog with ability to decline
5. **Default settings**: New watched folders use `continuous` mode with 10-minute cadence

### Test Results

All 21 E2E tests passing:
- 15 existing watched folder tests (unaffected)
- 6 new tests for prompt functionality

### Acceptance Criteria Met

- ✅ AC #1: Dragging files prompts to add parent directory
- ✅ AC #2: Pill button prompts to add parent directory
- ✅ AC #3: Dialog clearly shows which directory will be watched
- ✅ AC #4: User can decline without affecting library import
- ✅ AC #5: Watched folders populated after confirmation
- ✅ AC #6: Last.fm sync can now match tracks via watched folders
<!-- SECTION:FINAL_SUMMARY:END -->
