---
id: TASK-393.11
title: Transfer listening history and statistics persistence to Zig
status: To Do
assignee: []
created_date: '2026-11-15T05:33:00Z'
labels:
  - zig-first
  - migration
dependencies:
  - TASK-393.6
  - TASK-393.3
  - TASK-393.5
references:
  - crates/mt-core/src/db/stats.rs
  - crates/mt-tauri/src/commands/stats.rs
  - app/frontend/js/api
documentation:
  - docs/tauri-architecture.md
  - docs/testing.md
parent_task_id: TASK-393
priority: high
type: task
ordinal: 92500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Listening history and current statistics queries must move independently of chart image rendering and queue/session orchestration. Preserve existing counts, date-range behavior and grouping, including existing chart semantics; TASK-390 remains a frozen feature/correction task unless separately approved as a bugfix. TASK-393.24 consumes the transferred stats for rendering. TASK-393 policy: feature freeze, bugfixes allowed; Zig owns application policy and mt.db access, Rust only justified library/platform capabilities. Preserve existing behavior/data; no new product feature or CI benchmark campaign. Read TASK-369.5's ownership ADR and prerequisites, then record a current implementation plan before coding. Transfer all callers of this capability and replace its Rust behavioral tests with focused Zig tests before deleting obsolete implementations. Keep this change to the named domain; record discovered gaps rather than silently port neighboring subsystems.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Existing play-history/count/date-range/statistics operations are authoritative in Zig and survive reopening the database.
- [ ] #2 Frontend statistics and playback history writers call the engine; no Rust SQL remains for this capability.
- [ ] #3 Zig tests cover date boundaries, empty history, missing metadata, local/Plex tracks, play-count updates and rollback; test timestamps use the contract's exact precision.
- [ ] #4 Dashboard/statistics behavior is exercised against the engine without introducing the deferred artist-chart ranking change.
- [ ] #5 Image generation is not reimplemented here; its adapter consumer and ownership boundary are documented for TASK-393.24.
<!-- AC:END -->
