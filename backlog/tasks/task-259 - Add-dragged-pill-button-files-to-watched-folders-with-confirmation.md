---
id: task-259
title: Add dragged/pill-button files to watched folders with confirmation
status: In Progress
assignee: []
created_date: '2026-02-10 06:01'
updated_date: '2026-02-10 06:20'
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
- [ ] #1 Dragging files into the app prompts to add parent directory to watched folders
- [ ] #2 Adding files via the bottom bar pill button prompts to add parent directory to watched folders
- [ ] #3 Confirmation dialog clearly shows which directory will be watched
- [ ] #4 User can decline without affecting the library import
- [ ] #5 Watched folders is populated after confirmation, no longer null
- [ ] #6 Last.fm synced favorites can match tracks when watched folders are set
<!-- AC:END -->
