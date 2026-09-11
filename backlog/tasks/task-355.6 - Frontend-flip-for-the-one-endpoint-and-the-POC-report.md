---
id: TASK-355.6
title: 'Frontend flip for the one endpoint, and the POC report'
status: To Do
assignee: []
created_date: '2026-09-11 00:39'
labels: []
dependencies:
  - TASK-355.4
  - TASK-355.5
parent_task_id: TASK-355
type: task
ordinal: 63500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
This is the final subtask of the Zig sidecar POC: prove the frontend can call the new Zig-backed endpoint directly, and write up the POC's findings and recommendation. app/frontend/js/api/shared.js already contains the client-side pieces needed (an API_BASE constant, a request() helper, an ApiError class) as a leftover from a previously removed sidecar; this task activates that path for real rather than building it from scratch. The base URL and auth token the frontend needs must come from the running app (injected by the Rust side, which reads them from the port/token file the sidecar wrote in TASK-355.3), not from a hardcoded constant. Only one domain module should be flipped for this POC -- this is deliberately not the full frontend migration described in the parent plan's Phase 6, just proof that the pattern works end to end. This task also closes out the parent POC by synthesizing all measurements gathered across the other five subtasks into one recommendation.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 app/frontend/js/api/shared.js reads its base URL and bearer token from a value injected by the Rust side at runtime, not from a hardcoded constant
- [ ] #2 Exactly one frontend API domain module calls the sidecar endpoint directly with no tauriInvoke fallback
- [ ] #3 No file under app/frontend/js/stores/ is modified
- [ ] #4 Existing Vitest and Playwright suites both pass unmodified
- [ ] #5 A report is recorded on this task covering: cold and warm Zig build times, the CI wall-clock delta measured against the TASK-352 baseline, the Rust dependency-count delta, every unexpected obstacle encountered across all six subtasks, and an explicit go/no-go recommendation for proceeding to the larger migration (writes, queue, scanner, Last.fm, Plex, and the full frontend flip)
<!-- AC:END -->
