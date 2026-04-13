---
id: TASK-316
title: Decouple cross-platform build checks from test-suite completion
status: Done
assignee: []
created_date: '2026-04-12 06:59'
updated_date: '2026-04-13 17:48'
labels:
  - ci
  - github-actions
  - performance
milestone: m-1
dependencies: []
references:
  - 'https://github.com/pythoninthegrasses/mt/actions/runs/24300669188'
documentation:
  - .github/workflows/test.yml
  - docs/builds.md
priority: high
ordinal: 1000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Reduce GitHub Actions wall-clock time by allowing the cross-platform build verification matrix to start as soon as its own prerequisites are ready instead of waiting for unrelated frontend and Rust test jobs. Preserve the current verification coverage while shortening the critical path on push and pull request CI.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The test workflow no longer requires the build matrix to wait for Vitest, Playwright, and Rust coverage jobs when those jobs do not produce build inputs.
- [x] #2 Push and pull request CI still execute the same build verification coverage for macOS, Linux, and Windows.
- [x] #3 Workflow dependencies are documented in YAML comments or step naming where the execution order is non-obvious.
- [x] #4 The updated workflow is validated with a workflow linter or an equivalent dry-run/check command, and the verification result is recorded in task notes or PR summary.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementation\n\n### Change\nUpdated `.github/workflows/test.yml` line 100-104: changed `build.needs` from `[rust, deno-lint, vitest-tests, playwright-tests]` to `[deno-lint]`.\n\n### Rationale\nThe build matrix runs `cargo check` per platform — a compilation-only check that does not consume artifacts from test jobs. The test jobs (`rust`, `vitest-tests`, `playwright-tests`) are independent quality gates that do not produce build inputs. Keeping `deno-lint` as the sole gate ensures frontend source is validated before spending runner time on cross-platform checks, while allowing the build matrix to start ~15-20 minutes earlier.\n\n### New dependency graph\n```\ndeno-lint --> build(macos, linux, windows)\nrust              (independent)\nvitest-tests      (independent)\nplaywright-tests  (independent)\n```\n\n### Validation\n`actionlint .github/workflows/test.yml` — only pre-existing Blacksmith custom runner label warnings. No structural or dependency errors.\n\n### Documentation\n- YAML comment on `build.needs` explaining the dependency rationale\n- New \"Test Workflow Dependency Graph\" subsection in `docs/builds.md`"
<!-- SECTION:NOTES:END -->
