---
id: TASK-320
title: Stop installing unused CI tools in non-build jobs
status: To Do
assignee: []
created_date: '2026-04-12 06:59'
labels:
  - ci
  - github-actions
  - performance
  - tooling
milestone: m-1
dependencies:
  - TASK-317
references:
  - 'https://github.com/pythoninthegrasses/mt/actions/runs/24300669188'
documentation:
  - .github/actions/setup-tauri-build/action.yml
  - taskfiles/ci.yml
priority: low
ordinal: 5000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Trim CI setup further by ensuring jobs only install cargo and frontend tooling they actually consume. This follow-up focuses on unnecessary tool installation that remains after the minimal-vs-full setup split, especially in lint, check, and other non-bundling jobs.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Non-build CI jobs do not install cargo or frontend tools that they never invoke.
- [ ] #2 Any job that still installs extra tools has a documented reason in workflow comments, task notes, or related docs.
- [ ] #3 The change does not remove required tooling from release, bundle, or full-build jobs.
- [ ] #4 The reduced installation scope is validated with the affected workflow jobs or an equivalent local/static verification step.
<!-- AC:END -->
