---
id: TASK-285.10
title: 'Address debt hotspot: settings.html (score 811)'
status: Done
assignee: []
created_date: '2026-02-24 00:05'
updated_date: '2026-02-24 22:01'
labels:
  - tech-debt
  - code-health
dependencies: []
references:
  - app/frontend/views/settings.html
  - app/frontend/js/components/settings-view.js
parent_task_id: TASK-285
priority: low
ordinal: 11000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Roam identified `app/frontend/views/settings.html` as the #5 debt hotspot (score 811, complexity 21.9, churn 3.7k). High template complexity (21.9) indicates significant logic embedded in the settings view.

**Location:** `app/frontend/views/settings.html`

Run `roam file app/frontend/views/settings.html` to see the structure. Examine Alpine.js directives for complex inline logic.

**Approach:** Extract complex Alpine.js expressions into `settings-view.js` component methods. Consider splitting settings into sub-sections (general, audio, library, last.fm, etc.) as separate partial templates or components.

**Context:** This is part of the roam health improvement initiative (TASK-285).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Template complexity reduced below 10 (per roam metrics)
- [x] #2 Inline logic extracted to settings-view.js methods
- [x] #3 Settings page renders and all settings function correctly
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Changes

### settings.html (864 -> 269 lines, cognitive_load 21.9 -> 5.4)
- Converted 8 repeated nav buttons to data-driven `x-for` loop using `navSections` array
- Extracted Library section (198 lines) to `settings-library.html` partial
- Extracted Columns section (119 lines) to `settings-columns.html` partial
- Extracted Last.fm section (212 lines) to `settings-lastfm.html` partial
- Replaced all `$store.ui.settingsSection === 'xxx'` with `isSection('xxx')` method calls

### settings-view.js (new methods)
- `navSections`: data array for navigation buttons
- `isSection(id)`: checks active settings section
- `navItemClass(sectionId)`: returns active/inactive nav button classes
- `lastfmStatusColor()`: returns connection status indicator color
- `lastfmStatusText()`: returns connection status display text
- `reconcilePhaseText()`, `reconcileProgressText()`, `reconcileProgressWidth()`: scan progress display
- `canResetColumns()`: column reset button enabled state
- `themeButtonClass(preset)`: theme button active/inactive classes
- `scanButtonText()`: scan button loading state text
- `rescanIconClass(folderId)`: rescan icon spin animation class
- `toggleTrackClass()`, `toggleThumbClass()`: Last.fm toggle switch classes
- `connectButtonText()`, `completeAuthButtonText()`: auth button loading text
- `cacheLovedButtonText()`, `matchLovedButtonText()`, `importLovedButtonText()`, `resetLovedButtonText()`: loved tracks button loading text
<!-- SECTION:NOTES:END -->
