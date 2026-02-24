---
id: TASK-285.08
title: 'Address debt hotspot: index.html (score 992)'
status: To Do
assignee: []
created_date: '2026-02-24 00:05'
labels:
  - tech-debt
  - code-health
dependencies: []
references:
  - app/frontend/index.html
parent_task_id: TASK-285
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Roam identified `app/frontend/index.html` as the #3 debt hotspot (score 992, complexity 4.9, churn 20.2k — highest churn in the entire codebase at 79 commits, coupled to 69 files).

**Location:** `app/frontend/index.html`

The extremely high churn suggests this file changes with nearly every feature. Run `roam file app/frontend/index.html` to understand its structure.

**Approach:** Extract inline scripts, event wiring, and component initialization into separate modules. Reduce coupling by moving feature-specific markup into view partials/components. The goal is to reduce how often this file needs to change.

**Context:** This is part of the roam health improvement initiative (TASK-285).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Coupling partners reduced from 69 (target: under 40)
- [ ] #2 Inline scripts extracted to JS modules
- [ ] #3 Application loads and functions correctly
<!-- AC:END -->
