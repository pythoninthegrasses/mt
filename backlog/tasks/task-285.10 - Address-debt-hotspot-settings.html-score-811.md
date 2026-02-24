---
id: TASK-285.10
title: 'Address debt hotspot: settings.html (score 811)'
status: In Progress
assignee: []
created_date: '2026-02-24 00:05'
updated_date: '2026-02-24 20:13'
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
- [ ] #1 Template complexity reduced below 10 (per roam metrics)
- [ ] #2 Inline logic extracted to settings-view.js methods
- [ ] #3 Settings page renders and all settings function correctly
<!-- AC:END -->
