---
id: TASK-317
title: Introduce a minimal Rust CI setup path for check-only jobs
status: Done
assignee: []
created_date: '2026-04-12 06:59'
updated_date: '2026-04-13 17:48'
labels:
  - ci
  - github-actions
  - rust
  - performance
milestone: m-1
dependencies:
  - TASK-316
references:
  - 'https://github.com/pythoninthegrasses/mt/actions/runs/24300669188'
documentation:
  - .github/actions/setup-tauri-build/action.yml
  - taskfiles/ci.yml
  - docs/builds.md
priority: high
ordinal: 2000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Reduce fixed setup cost in CI by separating the minimal environment needed for Rust-only verification from the full Tauri build environment. This should let check-only jobs avoid frontend dependency installation and cargo tool setup that are only required for bundling or full application builds.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A distinct CI setup path exists for Rust-only verification jobs that does not install Node.js, frontend dependencies, or Tauri-specific cargo tools unless they are actually required.
- [x] #2 The macOS and Windows check-only jobs use the minimal setup path without regressing target/toolchain correctness.
- [x] #3 Jobs that build, bundle, or otherwise require the full Tauri environment continue to use the full setup path.
- [x] #4 The repository documents which workflow jobs must use the minimal path versus the full path, and the updated setup is validated in CI or an equivalent local check.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementation

### Composite action: `.github/actions/setup-tauri-build/action.yml`
- Added `mode` input (default: `full`, accepts `check`)
- `mode: check` skips: Node.js setup, `npm ci`, cargo-binstall (Windows), and uses `ci:setup-check` instead of `ci:setup`
- `mode: full` (default) retains all existing behavior — release.yml is unaffected

### Taskfile: `taskfiles/ci.yml`
- Added `setup-check` task: runs `setup-system-deps`, `setup-rust`, `setup-rust-windows` (same deps as `setup`) but omits `setup-cargo-tools`
- No cargo-binstall or tauri-cli installation for check-only jobs

### Workflow: `.github/workflows/test.yml`
- `rust` job: passes `mode: check` to setup action
- `build` matrix (macOS, Windows): passes `mode: check` (Linux build uses Docker, unaffected)

### Documentation: `docs/builds.md`
- Added "CI Setup Modes" subsection documenting `full` vs `check` mode, their dependency differences, and which jobs use each

### Validation
- `actionlint` reports only pre-existing Blacksmith custom runner label warnings — no structural issues from these changes
- `release.yml` does not specify `mode`, defaulting to `full` — confirmed correct
<!-- SECTION:NOTES:END -->
