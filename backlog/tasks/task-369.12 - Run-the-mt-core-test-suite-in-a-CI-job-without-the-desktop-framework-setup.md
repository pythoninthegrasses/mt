---
id: TASK-369.12
title: 'Separate engine, retained Rust and shell tests without benchmark matrices'
status: To Do
assignee: []
created_date: '2026-11-14T21:14:00Z'
updated_date: '2026-11-15T05:37:00Z'
labels:
  - zig-first
  - migration
  - ci
dependencies:
  - TASK-393.1
references:
  - >-
    backlog/tasks/task-353 -
    Extract-crates-mt-core-a-tauri-free-library-crate.md
  - >-
    backlog/tasks/task-352 -
    Measure-CI-and-build-baseline-determine-the-critical-path.md
documentation:
  - docs/builds.md
  - docs/testing.md
  - docs/act-guide.md
modified_files:
  - .github/workflows/test.yml
  - taskfiles/ci.yml
  - docs/builds.md
  - docs/testing.md
parent_task_id: TASK-369
priority: high
type: task
ordinal: 80500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-353 made existing Rust domain tests independent of Tauri; TASK-393 now moves those domains to Zig. Establish a simple test boundary that keeps current mt-core coverage runnable without desktop setup during transition, runs Zig domain/contract tests without a Tauri shell, and leaves actual shell integration in the desktop layer. This task is migration infrastructure, not a CI-wall-clock experiment. Do not duplicate domain assertions across Playwright, Rust and Zig forever; replacement mappings belong in each capability task. Repair the known fixture invocation/filter issue before relying on parity tests; a successful command that generated zero rows is not a valid fixture.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Task commands and the existing CI workflow run isolated Zig domain/contract tests, current temporary mt-core tests and desktop integration at the appropriate layer; engine tests require no Tauri staging or desktop framework setup.
- [ ] #2 Domain coverage is not silently dropped or repeatedly run in multiple jobs; the ownership/test map records how each subsequent Rust suite transfers to Zig and how retained adapter tests remain runnable.
- [ ] #3 Fixture generation uses the exact actual test/generator name, asserts a nonempty expected schema/data fixture and is deterministic under concurrent runs; isolated tests never modify the user's mt.db.
- [ ] #4 Contract tests fail for malformed messages and demonstrate actual engine behavior rather than only mocked browser/store calls; actual Tauri tests stay clearly identified.
- [ ] #5 Local focused tests and workflow lint pass; one normal existing CI validation may verify wiring, but no new timing/configuration matrix, benchmark workflow or paid run is required.
- [ ] #6 docs/testing.md and docs/builds.md describe commands, test boundaries, temporary mt-core coverage and the final retained-Rust/shell arrangement; lack of measured speedup does not require reverting useful isolation.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-11-14 supersession: original per-job wall-clock gates and revert-if-no-speedup criterion are removed. Work remains To Do. Current fixture filter may match zero tests; prove generated content before trusting tests. Final cleanup TASK-393.27 updates the test wiring after Rust domain deletion.
<!-- SECTION:NOTES:END -->
