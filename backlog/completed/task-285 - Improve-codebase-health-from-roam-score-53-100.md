---
id: TASK-285
title: Improve codebase health from roam score 53/100
status: Done
assignee: []
created_date: '2026-02-24 00:04'
updated_date: '2026-02-25 21:51'
labels:
  - tech-debt
  - code-health
dependencies: []
references:
  - crates/mt-tauri/src/library/commands.rs
  - app/frontend/js/components/library-browser.js
  - app/frontend/js/stores/library.js
  - app/frontend/main.js
priority: medium
ordinal: 5000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Roam analysis (2026-02-24) identified a health score of 53/100 for the mt codebase. This parent task tracks all remediation work for the notable issues and debt hotspots identified.

**Notable issues:**
- 3 dependency cycles
- 11 god components (degree > 20)
- 247 dead exports
- 22 critical-complexity symbols

**Debt hotspots (churn x complexity):**
1. `app/frontend/js/components/library-browser.js` — debt score 1051
2. `app/frontend/views/library.html` — debt score 1005
3. `app/frontend/index.html` — debt score 992
4. `app/frontend/tests/library.spec.js` — debt score 815
5. `app/frontend/views/settings.html` — debt score 811

**Complexity hotspots:**
- `createLibraryBrowser` CC 610
- `initTauriDragDrop` CC 438
- `createLibraryStore` CC 291

Run `roam health` and `roam understand` to get current metrics. Target is health score >= 70.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Roam health score reaches 70 or above
- [ ] #2 All subtasks are completed or triaged
- [ ] #3 No critical-complexity symbols remain (CC > 300)
<!-- AC:END -->
