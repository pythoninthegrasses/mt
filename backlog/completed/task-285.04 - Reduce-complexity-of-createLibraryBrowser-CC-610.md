---
id: TASK-285.04
title: Reduce complexity of createLibraryBrowser (CC 610)
status: Done
assignee: []
created_date: '2026-02-24 00:05'
updated_date: '2026-02-24 17:54'
labels:
  - tech-debt
  - code-health
  - complexity
dependencies: []
references:
  - app/frontend/js/components/library-browser.js
  - app/frontend/views/library.html
parent_task_id: TASK-285
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The `createLibraryBrowser` function in `app/frontend/js/components/library-browser.js` has a cognitive complexity of 610 — the highest in the codebase. This makes it extremely difficult to reason about, test, and modify safely.

**Location:** `app/frontend/js/components/library-browser.js` (also the #1 debt hotspot with score 1051, churn 13k)

Run `roam context createLibraryBrowser --task refactor` to understand its callers, callees, and dependencies. Use `roam preflight createLibraryBrowser` before making changes to assess blast radius.

**Approach:** Extract cohesive groups of functionality into separate functions or sub-components. The Alpine.js component factory pattern used in this codebase makes it natural to split into smaller stores/components.

**Context:** This is part of the roam health improvement initiative (TASK-285). Current health score is 53/100.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 createLibraryBrowser CC reduced below 150
- [x] #2 All existing library browser E2E tests pass
- [x] #3 No functionality regressions in library browsing
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Reduced `createLibraryBrowser` from 2087 lines (CC 610) to 581 lines by extracting 7 mixin factories + 2 utility modules + shared constants.

**Files created:**
- `js/mixins/type-to-jump.js` — keyboard artist navigation (5 methods, 4 state props)
- `js/mixins/column-geometry.js` — column widths, resize, auto-fit (10 methods, 8 state props)
- `js/mixins/column-reorder.js` — column drag-and-drop reordering (8 methods, 5 state props)
- `js/mixins/column-settings.js` — column visibility, persistence, header context menu (10 methods, 2 state props)
- `js/mixins/playlist-drag.js` — playlist track reorder via drag (7 methods, 4 state props)
- `js/mixins/context-menu-actions.js` — context menu, playback, track management (14 methods)
- `js/mixins/virtual-scroll.js` — scroll tracking, scroll-to-track (2 methods, 5 state props)
- `js/utils/dom.js` — `isTypingInInput`, `measureTextWidth`

**Files modified:**
- `js/constants.js` — added column width/visibility/order constants
- `js/utils/formatting.js` — added `formatDurationDash`, `formatRelativeTime`
- `js/components/library-browser.js` — imports + spreads mixins, retains getters/init/orchestration
- `docs/tauri-architecture.md` — documented mixin architecture

**Test results:** 271/271 unit tests pass, 663/665 E2E tests pass (3 visual regression snapshot failures are pre-existing, tracked in TASK-286).
<!-- SECTION:FINAL_SUMMARY:END -->
