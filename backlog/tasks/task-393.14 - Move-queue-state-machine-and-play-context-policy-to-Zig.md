---
id: TASK-393.14
title: Move queue state machine and play-context policy to Zig
status: To Do
assignee: []
created_date: '2026-11-15T05:34:00Z'
labels:
  - zig-first
  - migration
dependencies:
  - TASK-393.13
  - TASK-393.9
  - TASK-393.10
  - TASK-393.5
references:
  - crates/mt-core/src/queue
  - crates/mt-core/src/db/queue.rs
  - app/frontend/js/stores/queue.js
  - docs/shuffle.md
  - TASK-328
  - TASK-325
documentation:
  - docs/tauri-architecture.md
  - docs/testing.md
parent_task_id: TASK-393
priority: high
type: task
ordinal: 95500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Queue order, context construction, shuffle/restore, repeat, play-next pins and navigation are existing application behavior, not Rust-library exceptions. Transfer the current authoritative state machine and queue persistence to Zig. TASK-329 subsequently consolidates session presentation/scrobble policy; this task must already play music through the Rust primitive adapter, not introduce a second live queue. TASK-393 policy: feature freeze with bugfixes allowed, Zig-first application ownership, no new product features or timing matrices. Read TASK-369.5's ownership ADR and dependency outputs before starting; research then record a bounded implementation plan. Rust may wrap named mature libraries/OS facilities but cannot retain database access or domain orchestration. Port the named capability with caller rewiring, focused behavioral tests, deletion of replaced Rust policy and updated ownership/API docs. Do not silently absorb neighboring subsystems.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Zig owns enqueue/replace/remove/reorder/clear, play-context construction, navigation, shuffle/original order, play-next pins and loop none/all/one using the existing semantics.
- [ ] #2 Current-track removal, end-of-track, empty queue, repeated IDs and late/stale audio events have deterministic tested outcomes; one live authority issues audio commands.
- [ ] #3 Queue state and order persist/restore through Zig storage; no Rust queue SQL, state machine or hidden frontend fallback remains.
- [ ] #4 Existing queue unit/property behavior is covered in Zig, including shuffle restoration and loop-all reshuffle; frontend tests verify snapshot application rather than reimplementing domain rules.
- [ ] #5 Real UI enqueue, play-next, shuffle/unshuffle, next/previous and loop/end flows work through the Rust audio adapter.
- [ ] #6 docs/shuffle.md, API documentation and the ownership table describe the final authority and list deleted Rust/frontend business logic; TASK-329's remaining session scope is explicit.
<!-- AC:END -->
