---
id: TASK-285.11
title: Reduce 22 critical-complexity symbols (CC > threshold)
status: Done
assignee: []
created_date: '2026-02-24 00:05'
updated_date: '2026-02-25 21:51'
labels:
  - tech-debt
  - code-health
  - complexity
dependencies: []
parent_task_id: TASK-285
priority: low
ordinal: 12000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Roam complexity analysis found 22 symbols at critical complexity and 22 at high complexity (44 total flagged). The top 3 are tracked as separate tasks (createLibraryBrowser CC 610, initTauriDragDrop CC 438, createLibraryStore CC 291). This task covers the remaining 19 critical-complexity symbols.

Run `roam complexity` to get the full list. Use `roam complexity --threshold 50` to see all symbols above CC 50. For each, use `roam preflight <name>` before refactoring.

**Approach:** Work through the list by descending CC score. Extract helper functions, simplify control flow, and reduce nesting. Average CC across the codebase is 8.3 — aim to bring critical symbols below 50.

**Context:** This is part of the roam health improvement initiative (TASK-285).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 No symbols with CC > 300 remain (top 3 handled by dedicated tasks)
- [ ] #2 Critical-complexity count reduced from 22 to under 10
- [x] #3 All tests pass after each refactoring batch
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Progress (2026-02-24)

### Symbols refactored (CC before -> after):
- **createArtistsBrowser**: 286 -> below 50 (extracted artist-utils, single-track-context-menu mixin, queue-builder utility)
- **createSidebar**: 229 -> 87 (extracted playlist-crud and playlist-reorder mixins)
- **createLibraryBrowser**: 300 -> 163 (replaced inline queue building with shared queue-builder utility)
- **createNowPlayingView**: 63 -> below 50 (extracted queue-drag-reorder mixin)
- **initEventListeners**: 54 -> below 50 (extracted 8 named handler functions)
- **handleKeydown**: 65 -> below 50 (split into handleModifierShortcut + handlePlaybackShortcut)
- **promptToAddWatchedFolders**: 65 -> below 50 (extracted addWatchedFoldersBatch + showWatchedFolderResultToast)
- **openAddMusicDialogOp**: 59 -> below 50 (extracted showScanResultToast)

### New files created:
- `app/frontend/js/utils/artist-utils.js`
- `app/frontend/js/utils/queue-builder.js`
- `app/frontend/js/mixins/single-track-context-menu.js`
- `app/frontend/js/mixins/playlist-crud.js`
- `app/frontend/js/mixins/playlist-reorder.js`
- `app/frontend/js/mixins/queue-drag-reorder.js`

### Current state:
- Critical symbols >= CC 50: 16 (down from 22 original, though some new ones from extractions)
- All 281 unit tests pass
- AC #2 not yet met (target: under 10). Remaining high-CC symbols need further work:
  createQueueStore (214), createSettingsView (211), createMetadataModal (206),
  createLibraryBrowser (163), createPlayerStore (131), createUIStore (121),
  createAlbumsBrowser (103), contextMenuActionsMixin (89), createSidebar (87),
  playlistCrudMixin (80), playlistReorderMixin (62), columnSettingsMixin (61),
  columnGeometryMixin (60), createLibraryStore (50)

Commits: 9a8ce15

## Analysis (2026-02-24)

CC extraction alone won't reach the health score target. The score dropped from 53 to 43 because extractions added files and import edges without addressing the structural issues roam weighs most heavily:
- 1 dependency cycle (CRITICAL)
- 7 actionable god components
- 7 actionable bottlenecks

Further CC reduction on the remaining 16 symbols is still valuable but has diminishing returns on the health score. The cycle, api bottleneck, and god component issues need dedicated subtasks under TASK-285.
<!-- SECTION:NOTES:END -->
