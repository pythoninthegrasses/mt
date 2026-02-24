---
id: TASK-285.07
title: 'Address debt hotspot: views/library.html (score 1005)'
status: To Do
assignee: []
created_date: '2026-02-24 00:05'
labels:
  - tech-debt
  - code-health
dependencies: []
references:
  - app/frontend/views/library.html
  - app/frontend/js/components/library-browser.js
parent_task_id: TASK-285
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Roam identified `app/frontend/views/library.html` as the #2 debt hotspot (score 1005, complexity 23.8, churn 4.2k). High template complexity in HTML views typically indicates too much logic embedded in the template layer.

**Location:** `app/frontend/views/library.html`

Run `roam file app/frontend/views/library.html` to see the file skeleton. Examine Alpine.js directives for complex inline expressions that should be extracted to the component JS.

**Approach:** Move complex Alpine.js expressions and inline logic from the template into `library-browser.js` component methods. Keep templates declarative with simple bindings.

**Context:** This is part of the roam health improvement initiative (TASK-285). Closely related to the createLibraryBrowser complexity task.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Template complexity reduced (roam reports lower complexity for this file)
- [ ] #2 Inline Alpine.js expressions extracted to named methods
- [ ] #3 Library view renders and functions correctly
<!-- AC:END -->
