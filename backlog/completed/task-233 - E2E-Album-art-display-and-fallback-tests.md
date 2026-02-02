---
id: task-233
title: 'E2E: Album art display and fallback tests'
status: Done
assignee: []
created_date: '2026-01-28 05:40'
updated_date: '2026-01-29 22:10'
labels:
  - e2e
  - library
  - ui
  - P2
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add Playwright E2E tests for album art display including fallback handling for missing or broken images.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Track with album art displays image correctly
- [x] #2 Track without album art shows placeholder/fallback
- [x] #3 Album art loads lazily if applicable
- [x] #4 Broken image URL shows fallback gracefully
<!-- AC:END -->
