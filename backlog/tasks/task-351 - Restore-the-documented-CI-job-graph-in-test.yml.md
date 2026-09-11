---
id: TASK-351
title: Restore the documented CI job graph in test.yml
status: To Do
assignee: []
created_date: '2026-09-11 00:38'
labels: []
dependencies: []
type: bug
ordinal: 53500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Cross-platform build verification should start as soon as deno-lint finishes rather than waiting on the slowest test job. .github/workflows/test.yml:78 declares `build: needs: [deno-lint, rust, vitest-tests, playwright-tests]` and :200 declares `playwright-tests: needs: [changes, deno-lint, rust, vitest-tests]`, producing a serial rust(20m) -> playwright(20m) -> build(30m) chain. docs/builds.md:587 documents and justifies the intended graph: deno-lint alone gates build, with the three test jobs independent. The workflow has drifted from its own documented design, costing up to ~40 minutes of CI wall-clock per run.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 build job gates only on deno-lint
- [ ] #2 playwright-tests job gates only on changes and deno-lint
- [ ] #3 A PR run shows the build matrix starting within ~3 minutes of deno-lint completing
- [ ] #4 Total CI wall-clock recorded before and after the change in the task notes
- [ ] #5 docs/builds.md dependency graph re-verified as accurate against the workflow file
<!-- AC:END -->
