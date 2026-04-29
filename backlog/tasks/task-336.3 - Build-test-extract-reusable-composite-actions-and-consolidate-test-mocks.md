---
id: TASK-336.3
title: 'Build/test: extract reusable composite actions and consolidate test mocks'
status: Done
assignee: []
created_date: '2026-04-29 04:21'
updated_date: '2026-04-29 19:48'
labels:
  - refactor
  - ci
  - tests
  - complexity
dependencies: []
references:
  - 'https://github.com/pythoninthegrass/mt/commit/4ba8be8'
parent_task_id: TASK-336
priority: low
ordinal: 8500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Lower-LOC but high-maintenance-value cleanup of build/test scaffolding. Estimated ~80 LOC reduction.

**Scope:**

1. **`.github/actions/resolve-release-tag/action.yml`** — extract the release-tag-resolution block that is duplicated 4 times in `.github/workflows/release.yml` (currently around lines 54-66, 149-161, 204-217 in bash and 324-336 in pwsh). The composite action must support both `bash` and `pwsh` shells. Replace the 4 inline blocks with `uses: ./.github/actions/resolve-release-tag`.

2. **`.github/actions/setup-frontend/action.yml`** — extract the `actions/setup-node@v6` + `npm ci` block duplicated 3 times across `.github/workflows/test.yml` (around lines 163-172, 213-221) and `.github/workflows/test-local.yml` (around lines 43-52, 94-96). Replace inline blocks with `uses: ./.github/actions/setup-frontend`.

3. **`taskfiles/tauri.yml`** — add an internal task `_deps-base-build` that runs `:deno:install`, `:cargo:_setup-cargo-home`, `:cargo:install-sccache`. Replace the 7 places where this dependency triple is inlined (around lines 103, 127, 140, 173, 186, 196, 204) with `deps: [_deps-base-build]`.

4. **`app/frontend/__tests__/`** — consolidate the 3× duplicated `global.window.__TAURI__ = { core: { invoke: vi.fn(...) }, event: { listen: vi.fn(...) } }` mock and the 3× duplicated `vi.mock('../js/api.js', ...)` factory found in `player.props.test.js`, `playback-regression.test.js`, and `setup-player-mocks.js`. Move into shared modules under `app/frontend/__tests__/mocks/` (e.g. `mocks/tauri.js`, `mocks/api.js`) or the vitest setup file. Each test imports the shared factory and overrides only the parts it needs.

**Files to create:**
- `.github/actions/resolve-release-tag/action.yml`
- `.github/actions/setup-frontend/action.yml`
- `app/frontend/__tests__/mocks/tauri.js`
- `app/frontend/__tests__/mocks/api.js`

**Files to modify:**
- `.github/workflows/release.yml`
- `.github/workflows/test.yml`
- `.github/workflows/test-local.yml`
- `taskfiles/tauri.yml`
- `app/frontend/__tests__/player.props.test.js`
- `app/frontend/__tests__/playback-regression.test.js`
- `app/frontend/__tests__/setup-player-mocks.js`
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 resolve-release-tag composite action exists and is used by all 4 prior inline blocks in release.yml
- [x] #2 setup-frontend composite action exists and is used by all 3 prior inline blocks in test.yml/test-local.yml
- [x] #3 taskfiles/tauri.yml has a _deps-base-build internal task; the 7 inlined dep triples are replaced
- [x] #4 Tauri/API test-mock factories live in app/frontend/__tests__/mocks/ and are imported by the 3 affected test files — no duplicated inline mock blocks remain
- [x] #5 actionlint .github/workflows/ passes
- [ ] #6 task lint passes
- [x] #7 cd app/frontend && npx vitest run passes
- [ ] #8 Trigger a workflow_dispatch run of release.yml in dry-run mode (or local act run) to confirm the resolve-release-tag action works end-to-end on bash + pwsh
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Created .github/actions/resolve-release-tag/action.yml (bash + pwsh steps, runner.os condition) and .github/actions/setup-frontend/action.yml (setup-node@v6 + npm ci). Replaced all 4 inline resolve-release-tag blocks in release.yml and all 3 setup-node+npm-ci blocks across test.yml and test-local.yml. Added _deps-base-build internal task to taskfiles/tauri.yml and replaced all 7 inlined dep triples. Created app/frontend/__tests__/mocks/tauri.js (createTauriMock factory with configurable invokeReturns and voidCmds) and mocks/api.js (createApiMock factory with overrides). Updated player.props.test.js, playback-regression.test.js, and setup-player-mocks.js to import from shared mocks. actionlint passes clean. vitest 515/515 pass. AC #6 (task lint): one pre-existing require-await failure in api/queue.js unrelated to this task. AC #8 (workflow_dispatch dry-run): pending CI run.
<!-- SECTION:FINAL_SUMMARY:END -->
