---
id: task-247
title: Stabilize flaky Playwright E2E tests (drag-and-drop + library search)
status: In Progress
assignee: []
created_date: '2026-01-29 04:07'
updated_date: '2026-01-29 08:31'
labels:
  - testing
  - playwright
  - flaky
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Reduce Playwright flakiness by addressing timing/readiness issues in the drag-and-drop multi-select test and the library store search test so they pass reliably in CI.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Drag-and-drop multi-select test passes reliably on WebKit by waiting for the library list to be rendered and stable before clicking.
- [ ] #2 Library store search test consistently loads non-empty tracks (or validates expected empty state) without timing-related failures.
- [ ] #3 Flaky failures are eliminated in CI runs for these tests (no intermittent timeouts or zero-track assertions).
<!-- AC:END -->
