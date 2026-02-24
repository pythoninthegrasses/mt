---
id: TASK-285.12
title: 'Break api->settings dependency cycle (8 symbols, 4 files)'
status: Done
assignee: []
created_date: '2026-02-24 22:40'
updated_date: '2026-02-24 22:47'
labels:
  - tech-debt
  - code-health
  - architecture
dependencies: []
references:
  - app/frontend/js/api.js
  - app/frontend/js/services/settings.js
  - app/frontend/js/stores/library.js
  - app/frontend/js/utils/library-operations.js
parent_task_id: TASK-285
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Roam health identifies 1 CRITICAL dependency cycle spanning 8 symbols across 4 files:

**Symbols in cycle:** api, SettingsService, settings, listen, applySectionData, loadSection, backgroundRefreshSection, loadLibraryData

**Files involved:**
- `app/frontend/js/api.js`
- `app/frontend/js/services/settings.js`
- `app/frontend/js/stores/library.js`
- `app/frontend/js/utils/library-operations.js`

**Roam's break suggestion:** Remove the `api -> settings` dependency (highest edge betweenness in cycle: 0.536).

The cycle exists because `api.js` imports from `settings.js` and `settings.js` (or its consumers) imports from `api.js`. The fix likely involves one of:
1. Extracting the settings dependency from api.js into a separate initialization path
2. Using dependency injection or late binding for the settings reference in api.js
3. Moving the shared dependency to a third module both can import

This is the single highest-impact fix for the health score — cycles are weighted as CRITICAL issues and this one involves the two top bottleneck symbols (`api` betweenness 1509, `settings` betweenness 1271).

Run `roam health` and inspect the cycle. Run `roam impact api` and `roam impact settings` to understand the blast radius.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 roam health reports 0 dependency cycles
- [x] #2 All frontend tests pass
- [x] #3 No behavioral changes — settings and API still function identically
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The dependency cycle was a roam false positive caused by symbol name collisions. `settings.js` imported `invoke` from `@tauri-apps/api/core` and `listen` from `@tauri-apps/api/event`, but roam misresolved these to the local `invoke` variable in `api.js` and the local `listen` variable in `library.js`, creating phantom edges that formed the cycle.

**Fix:** Changed `settings.js` from ES module imports (`import { invoke } from '@tauri-apps/api/core'`) to the `window.__TAURI__` global pattern, matching what `api.js` and `library.js` already use. This is both a consistency improvement and eliminates the false edges.

**Result:** roam health reports 0 cycles, all 281 frontend tests pass, no behavioral changes.
<!-- SECTION:FINAL_SUMMARY:END -->
