---
id: TASK-340
title: E2E test suite cleanup and parallelism tuning
status: Done
assignee: []
created_date: '2026-04-30 19:28'
updated_date: '2026-05-02 00:23'
labels:
  - testing
  - e2e
  - vitest
  - performance
dependencies:
  - TASK-340.1
  - TASK-340.2
  - TASK-340.3
  - TASK-340.4
  - TASK-340.5
  - TASK-340.6
  - TASK-340.7
  - TASK-340.8
priority: high
ordinal: 6500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Audit found ~70 Playwright tests that violate the documented test boundaries in CLAUDE.md — they only call `page.evaluate()` to manipulate Alpine stores with no real DOM interaction, yet run in Playwright. Several duplicate existing Vitest coverage in `app/frontend/__tests__/ui.store.test.js`. Additionally, per-test fixture cost is high (158 `page.goto('/')` calls per test run), and cargo-culted `waitForTimeout` sleeps in lastfm.spec.js inflate individual test durations.

This parent task tracks 8 child tasks that can be worked in parallel.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Total Playwright test count drops from 566 to ~480 or fewer
- [x] #2 task test:e2e runtime under 60s on M4 Max local
- [x] #3 Vitest coverage preserved or extended for any moved logic
- [x] #4 All 8 child tasks completed and merged
<!-- AC:END -->
