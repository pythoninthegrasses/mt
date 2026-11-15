---
id: TASK-369
title: Finish bounded build hygiene; preserve prior performance findings
status: To Do
assignee: []
created_date: '2026-11-14T04:23:00Z'
updated_date: '2026-11-15T05:38:00Z'
labels:
  - build-perf
  - build-hygiene
dependencies:
  - TASK-369.6
  - TASK-369.5
  - TASK-369.12
references:
  - 'https://blog.rust-lang.org/2026-11-12/Rust-1.100.0/'
  - 'https://doc.rust-lang.org/cargo/reference/lints.html#unused_dependencies'
documentation:
  - docs/builds.md
  - zig-core/README.md
priority: medium
type: task
ordinal: 72500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-393 now owns the approved Zig-first migration and feature freeze; language selection is no longer conditional on CI/dev-loop matrices. This umbrella retains useful completed dependency/profile/baseline work and the narrowly scoped TASK-369.6 tooling repair. TASK-369.5 now records the Zig-first decision/ownership map, and TASK-369.12 supplies migration test isolation. Kache evaluation TASK-369.8 and optional profile experiment TASK-369.11 are canceled/superseded, not implemented. Preserve existing measurements, current selected release profile and factual limitations. No new benchmark campaign, throwaway Zig-vs-Rust implementation or new compiler-cache rollout is part of this umbrella.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Existing baseline, dependency-audit and release-profile results from completed children remain accurately referenced; no unmeasured Zig speedup is inferred from them.
- [ ] #2 TASK-369.6 completes bounded configuration/documentation correctness without the superseded cache timing matrix.
- [ ] #3 TASK-369.5 records the approved Zig-first architecture and maps domain ownership to TASK-393 rather than selecting a language by benchmark.
- [ ] #4 TASK-369.12 establishes appropriate engine/adapter/shell test separation without making a CI speedup an acceptance gate.
- [ ] #5 TASK-369.8 and TASK-369.11 have explicit cancellation/supersession records, not checked implementation criteria; completed historical tasks remain Done.
- [ ] #6 docs/builds.md reflects accepted changes, the retained release profile and remaining limitations; TASK-393 is the separate engine-migration completion gate.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-11-14 maintainer approved Zig as primary language and feature freeze until TASK-393 completes. This umbrella is build hygiene/history only; no further architecture-comparison or profile/cache matrices are required.
<!-- SECTION:NOTES:END -->
