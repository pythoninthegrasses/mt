---
id: TASK-393.19
title: Move media-file cache and download policy to Zig
status: To Do
assignee: []
created_date: '2026-11-15T05:34:00Z'
labels:
  - zig-first
  - migration
dependencies:
  - TASK-393.7
  - TASK-393.13
  - TASK-393.3
references:
  - crates/mt-core/src/cache
  - crates/mt-tauri/src/audio
  - TASK-295
documentation:
  - docs/tauri-architecture.md
  - docs/testing.md
parent_task_id: TASK-393
priority: high
type: task
ordinal: 100500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Current local/network-file caching and playback source resolution must remain usable after moving orchestration. Zig owns cache identity, eligibility, eviction, partial-download state and source selection. Retain a narrow mature networking/filesystem capability where justified, without handrolling TLS or leaving a parallel Rust cache policy. Plex-specific orchestration is TASK-393.22. TASK-393 policy: feature freeze with bugfixes allowed, Zig-first application ownership, no new product features or timing matrices. Read TASK-369.5's ownership ADR and dependency outputs before starting; research then record a bounded implementation plan. Rust may wrap named mature libraries/OS facilities but cannot retain database access or domain orchestration. Port the named capability with caller rewiring, focused behavioral tests, deletion of replaced Rust policy and updated ownership/API docs. Do not silently absorb neighboring subsystems.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Existing cache enablement, size/age policy, stable keys, hit/miss behavior and source selection are authoritative in Zig and respect saved settings.
- [ ] #2 Interrupted/canceled downloads cannot masquerade as complete cache hits; temporary files are scoped and cleaned without deleting source media or arbitrary user paths.
- [ ] #3 Rust audio receives a resolved playable source and does not choose caches or query the DB; retained byte-transfer capabilities are narrowly justified.
- [ ] #4 Tests cover hit/miss, eviction, partial failure, restart, concurrent requests for one item and unavailable sources using local fake I/O/network fixtures.
- [ ] #5 Real cached/network-file playback still works through the Rust audio adapter; docs record remaining Plex-specific handoff and eliminate superseded Rust policy.
<!-- AC:END -->
