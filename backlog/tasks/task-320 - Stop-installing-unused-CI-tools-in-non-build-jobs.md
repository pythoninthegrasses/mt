---
id: TASK-320
title: Stop installing unused CI tools in non-build jobs
status: Done
assignee: []
created_date: '2026-04-12 06:59'
updated_date: '2026-04-13 17:48'
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
ordinal: 11000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Trim CI setup further by ensuring jobs only install cargo and frontend tooling they actually consume. This follow-up focuses on unnecessary tool installation that remains after the minimal-vs-full setup split, especially in lint, check, and other non-bundling jobs.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Non-build CI jobs do not install cargo or frontend tools that they never invoke.
- [x] #2 Any job that still installs extra tools has a documented reason in workflow comments, task notes, or related docs.
- [x] #3 The change does not remove required tooling from release, bundle, or full-build jobs.
- [x] #4 The reduced installation scope is validated with the affected workflow jobs or an equivalent local/static verification step.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Implementation Plan

### Analysis Result
TASK-317's `mode: check` split already eliminated the main waste. After review, no non-build CI jobs install cargo or frontend tools they never invoke. The only "extra" installs are in the `rust` job (cargo-binstall + cargo-tarpaulin), which are legitimately needed for coverage.

### Steps
1. Add workflow comments to `test.yml` `rust` job documenting why cargo-binstall and cargo-tarpaulin are installed after check-mode setup
2. Validate with actionlint
3. Mark ACs as met with notes
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Audit Results (2026-04-12)

After TASK-317 introduced `mode: check` vs `mode: full`, all non-build CI jobs already avoid installing unused tools:

- **rust** (test.yml): uses `mode: check` (skips Node.js, npm ci, cargo-binstall via composite, tauri-cli). Installs cargo-binstall + cargo-tarpaulin separately — justified by coverage step. Comment added to workflow.
- **deno-lint** (test.yml): installs only Deno. No Rust/cargo/frontend tooling.
- **build macOS/Win** (test.yml): uses `mode: check`. No extra tools.
- **build Linux** (test.yml): Docker-based, no composite action.
- **vitest-tests** (test.yml): Node.js only.
- **playwright-tests** (test.yml): Node.js only.
- **release jobs** (release.yml): use `mode: full` (default) — correct for build+bundle.

No unnecessary tool installations found. Added documentation comment to the `rust` job explaining the cargo-binstall/tarpaulin installs.

Validated with `actionlint` — only pre-existing shellcheck warnings in release.yml, no new issues.
<!-- SECTION:NOTES:END -->
