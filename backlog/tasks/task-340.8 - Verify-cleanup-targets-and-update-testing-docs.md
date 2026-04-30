---
id: TASK-340.8
title: Verify cleanup targets and update testing docs
status: In Progress
assignee: []
created_date: '2026-04-30 19:29'
updated_date: '2026-04-30 19:30'
labels:
  - testing
  - docs
dependencies:
  - TASK-340.1
  - TASK-340.2
  - TASK-340.3
  - TASK-340.4
  - TASK-340.5
  - TASK-340.6
  - TASK-340.7
parent_task_id: TASK-340
priority: low
ordinal: 14500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Final verification task after all sibling cleanup tasks (340.1–340.6) and config tuning (340.7) are complete.

**Verify**:
- Run `task test:e2e` and confirm total test count ≤ 480 (was 566)
- Confirm wall-clock runtime ≤ 60s on M4 Max local (was 84s)
- Run `cd app/frontend && npx vitest run` and confirm green
- Run `task lint && task format` and confirm clean
- Run `cargo nextest run --workspace` to confirm no Rust regressions

**Document**:
- Update `docs/testing.md` Test Boundaries section if it needs reinforcement (add explicit "do not use page.evaluate-only tests in Playwright" note with examples)
- Note final test count and runtime in commit message for traceability

Critical file:
- `docs/testing.md`
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 task test:e2e count <= 480 and runtime <= 60s
- [ ] #2 npx vitest run green
- [ ] #3 task lint clean
- [ ] #4 docs/testing.md updated if needed
<!-- AC:END -->
