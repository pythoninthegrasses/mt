---
id: TASK-369.6
title: 'Fix CI compilation caching: sccache bypass and Windows target-artifact cache'
status: To Do
assignee: []
created_date: '2026-11-14T04:24:00Z'
updated_date: '2026-11-14T04:24:00Z'
labels: []
dependencies:
  - TASK-369.4
documentation:
  - docs/builds.md
  - docs/development.md
parent_task_id: TASK-369
type: task
ordinal: 5000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
docs/builds.md advertises sccache as the shared compile cache across worktrees, but taskfiles/ci.yml sets RUSTC_WRAPPER: "" at file level, so no CI task in that file ever invokes sccache; the Windows release job additionally runs Swatinem/rust-cache with cache-targets: false, caching only the registry (downloads) and not compiled targets. The Linux release path instead relies on cargo-chef layers in Docker via Blacksmith. Which of these gaps actually costs wall-clock is unknown because no CI run reports sccache --show-stats. This task instruments the release workflow to report cache hit/miss state per job, then enables the caches that demonstrate hits (sccache in ci.yml tasks with a persistent dir on the self-hosted macOS/Windows runners, and rust-cache target artifacts on Windows), and records the per-job before/after from at least two release-tag or workflow_dispatch runs each. Care: sccache must not be enabled for jobs whose build scripts write gen/schemas files that are committed (see TASK-361 note about failed build scripts rewriting crates/mt-tauri/gen/schemas).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Each release job emits sccache stats (or an explicit statement it is disabled) so cache effectiveness is visible per run
- [ ] #2 sccache enabled for ci:build/ci:bundle paths with a persistent cache location on the self-hosted macOS and Windows runners, or a documented reason it cannot be
- [ ] #3 Windows rust-cache target-artifact caching evaluated and enabled or rejected with measured before/after times
- [ ] #4 Before/after per-job wall-clock for at least two runs per configuration recorded in task notes
- [ ] #5 docs/builds.md sccache section corrected to describe what CI actually does
<!-- AC:END -->
