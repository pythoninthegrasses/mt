---
id: TASK-352
title: Measure CI and build baseline; determine the critical path
status: To Do
assignee: []
created_date: '2026-09-11 00:38'
labels: []
dependencies:
  - TASK-351
type: spike
ordinal: 54500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A recorded, trustworthy baseline is needed to tell whether a Zig core-engine migration can move CI wall-clock at all. This is the gate for TASK-357 (the Zig POC). playwright-tests runs against Vite preview at localhost:4173 with grepInvert /@tauri/ and mocked IPC, so no backend rewrite of any kind can speed it up. If it dominates the critical path after TASK-351 lands, the Zig migration's Phases 3-6 must be re-justified on dev-loop and code-ownership grounds rather than CI wall-clock, and that recommendation should be made explicit here rather than assumed later.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Per-job wall-clock captured from a real PR run after TASK-351 lands
- [ ] #2 task build:timings output captured for both a cold and a warm build
- [ ] #3 cargo tree -e normal | wc -l recorded as the dependency-count baseline
- [ ] #4 The critical path (which job/chain actually bounds total CI time) is named explicitly in the task notes
- [ ] #5 A written go/no-go recommendation for proceeding to TASK-357 is recorded on this task
<!-- AC:END -->
