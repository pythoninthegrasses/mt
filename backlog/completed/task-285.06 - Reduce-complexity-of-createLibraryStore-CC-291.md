---
id: TASK-285.06
title: Reduce complexity of createLibraryStore (CC 291)
status: Done
assignee: []
created_date: '2026-02-24 00:05'
updated_date: '2026-02-24 20:53'
labels:
  - tech-debt
  - code-health
  - complexity
dependencies: []
references:
  - app/frontend/js/stores/library.js
parent_task_id: TASK-285
priority: medium
ordinal: 7000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The `createLibraryStore` function in `app/frontend/js/stores/library.js` has a cognitive complexity of 291 — the third highest in the codebase.

**Location:** `app/frontend/js/stores/library.js` (churn 6.9k, 43 commits, coupled to 55 files)

Run `roam context createLibraryStore --task refactor` to understand its role. It's a key abstraction (high PageRank, fan-out 18). Use `roam preflight createLibraryStore` before making changes.

**Approach:** Extract distinct responsibilities (sorting, filtering, pagination, selection, search) into composable sub-stores or utility modules. The Alpine.js store pattern supports composition.

**Context:** This is part of the roam health improvement initiative (TASK-285). Current health score is 53/100.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 createLibraryStore CC reduced below 100
- [x] #2 All existing library-related tests pass
- [x] #3 No regressions in library store behavior (sorting, filtering, search, etc.)
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Summary

Reduced `createLibraryStore` cognitive complexity from **291 to 50** (target was <100).

### Changes

**Phase 1 (CC 291→216):**
- Created `app/frontend/js/utils/library-cache.js` (98 lines) — extracted `buildCacheEntry()`, `loadCacheFromSettings()`, `createCacheSaver()` as pure functions
- Created generic `_loadSection()` and `_backgroundRefreshSection()` methods replacing 5 duplicated section loaders each

**Phase 2 (CC 216→50):**
- Created `app/frontend/js/utils/library-operations.js` (~440 lines) — extracted all heavy method bodies as top-level exported functions: `loadSection()`, `backgroundRefreshSection()`, `loadLibraryData()`, `backgroundRefreshLibrary()`, `scanPaths()`, `openAddMusicDialogOp()`, `removeTracksLocallyOp()`, `removeFromQueue()`, `getInitialSection()`, `applySectionData()`
- Rewrote `library.js` store (~490 lines, down from 1053) with thin 1-line wrapper methods delegating to library-operations.js

### Verification
- **CC**: 291 → 50 (83% reduction, well below 100 target)
- **vitest**: 55 tests pass, 0 regressions (28 pre-existing fast-check/Playwright failures unchanged)
- **deno lint**: Clean on both new files and library.js
- **deno fmt**: Clean
- **Codebase health**: Improved from 44 to 51/100

### Architecture
- Top-level functions in `library-operations.js` take `store` (Alpine proxy) as first parameter
- Store methods are thin wrappers: `load(opts) { return loadLibraryData(this, opts); }`
- All public API signatures preserved — zero breaking changes
<!-- SECTION:FINAL_SUMMARY:END -->
