---
id: TASK-319
title: Reduce repeated Windows CI bootstrap overhead
status: Done
assignee: []
created_date: '2026-04-12 06:59'
updated_date: '2026-04-12 07:17'
labels:
  - ci
  - github-actions
  - windows
  - performance
milestone: m-1
dependencies:
  - TASK-317
references:
  - 'https://github.com/pythoninthegrasses/mt/actions/runs/24300669188'
documentation:
  - .github/workflows/test.yml
  - .github/workflows/release.yml
  - .github/actions/setup-tauri-build/action.yml
  - docs/builds.md
priority: medium
ordinal: 750
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Lower fixed cost in Windows CI jobs by removing or centralizing repeated bootstrap work that happens before the real verification or build steps begin. Keep the workflow reliable on the current runner image while reducing duplicated setup across test and release workflows.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Repeated Windows bootstrap steps used across workflows are consolidated, removed, or shifted to a more appropriate reusable layer.
- [x] #2 The test and release workflows still succeed on the current Windows runner image without requiring interactive setup.
- [x] #3 Any remaining pre-checkout bootstrap is justified in workflow comments or task notes.
- [x] #4 The resulting workflow change is validated in CI or an equivalent local/static workflow validation step.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementation

### Problem
The "Bootstrap Windows prerequisites" step (installs git + pwsh via Chocolatey, adds git to PATH) was copy-pasted identically in both `test.yml` (build job) and `release.yml` (build-windows job). This ran before `actions/checkout` because it installs git.

### Solution
Moved the bootstrap into the composite action `.github/actions/setup-tauri-build/action.yml` as the first step (conditional on `runner.os == 'Windows'`). Uses `shell: powershell` (not `pwsh`) so it works on bare images where PowerShell 7 isn't yet installed.

Since `actions/checkout@v6` falls back to REST API download when Git 2.18+ isn't in PATH, checkout can safely run before the composite action. The bootstrap then installs git/pwsh for use by subsequent steps.

### Changes
- `.github/actions/setup-tauri-build/action.yml`: Added "Bootstrap Windows prerequisites (git, pwsh)" as the first step, gated on `runner.os == 'Windows'`
- `.github/workflows/test.yml`: Removed standalone bootstrap step from build job
- `.github/workflows/release.yml`: Removed standalone bootstrap step from build-windows job
- `docs/builds.md`: Added note about Windows bootstrap centralization in "CI Setup Modes" section

### Validation
- `actionlint` reports only pre-existing Blacksmith runner label warnings — no new issues
- `actions/checkout` REST API fallback confirmed in upstream docs
- Bootstrap is idempotent (skips install when tools present)
- Release workflow unaffected (still uses `mode: full` default)
<!-- SECTION:NOTES:END -->
