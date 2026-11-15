---
id: TASK-393.29
title: Make Zig the shared artwork resolver and cache-policy owner
status: To Do
assignee: []
created_date: '2026-11-15T05:37:00Z'
labels:
  - zig-first
  - migration
dependencies:
  - TASK-393.15
  - TASK-393.7
  - TASK-393.5
references:
  - crates/mt-tauri/src/scanner
  - crates/mt-core/src/cache
  - TASK-391
  - TASK-329
  - TASK-393.24
documentation:
  - docs/tauri-architecture.md
  - docs/testing.md
parent_task_id: TASK-393
priority: high
type: task
ordinal: 110500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Playback and chart generation must not grow separate artwork caches during migration. Give Zig one resolver for embedded/external/placeholder fallback, local/remote availability and bounded positive/negative caching; Rust retains only the metadata/image primitives from TASK-393.15. This is existing behavior plus preservation of the offline-recovery fix in TASK-391, not a new artwork source or UI feature. TASK-329 consumes the resolver for session snapshots and TASK-393.24 consumes it for charts. TASK-393 feature freeze applies; research the current tree and record an implementation plan when starting. Scope is resolution and cache policy only, excluding playback session assembly, chart ranking and image rendering.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Zig owns one artwork selection/fallback and bounded cache policy used by all existing artwork consumers; retained Rust extraction/decoding primitives do not implement a competing policy.
- [ ] #2 Negative entries cannot pin placeholders after storage returns; repeated genuine misses remain bounded and metadata updates invalidate positive and negative results, preserving TASK-391 behavior.
- [ ] #3 Tests cover embedded/external/placeholder ordering, missing/unreadable then restored file, repeated negative lookup, positive hit, invalidation, eviction and concurrent requests using isolated fixtures.
- [ ] #4 Artwork payload/path lifetimes and frontend display URLs are valid across the process boundary without leaking credentials or accepting arbitrary unvalidated file operations.
- [ ] #5 Playback/chart/library callers use the shared resolver; superseded Rust resolver/cache policy and duplicate frontend fallback code are removed when no longer referenced.
- [ ] #6 One real artwork load and offline-recovery flow are recorded; API/ownership docs explain cache bounds and any justified retained Rust library.
<!-- AC:END -->
