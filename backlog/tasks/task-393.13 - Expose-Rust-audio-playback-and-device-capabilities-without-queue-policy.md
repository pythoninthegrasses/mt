---
id: TASK-393.13
title: Expose Rust audio playback and device capabilities without queue policy
status: To Do
assignee: []
created_date: '2026-11-15T05:34:00Z'
labels:
  - zig-first
  - migration
dependencies:
  - TASK-393.3
references:
  - crates/mt-tauri/src/audio
  - crates/mt-tauri/src/commands/audio.rs
  - crates/mt-tauri/src/media_keys.rs
  - TASK-392
documentation:
  - docs/tauri-architecture.md
  - docs/testing.md
parent_task_id: TASK-393
priority: high
type: task
ordinal: 94500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Keep rodio/Symphonia/CPAL and native media integration rather than handrolling playback or codecs. The engine needs play/pause/seek/volume/speed/device primitives and reliable observed state, not a Rust queue manager. This task extracts and wires that capability while preserving current behavior; queue/session transfer is separate. Do not delay CoreAudio bug TASK-392 or accidentally undo its fixes. TASK-393 policy: feature freeze with bugfixes allowed, Zig-first application ownership, no new product features or timing matrices. Read TASK-369.5's ownership ADR and dependency outputs before starting; research then record a bounded implementation plan. Rust may wrap named mature libraries/OS facilities but cannot retain database access or domain orchestration. Port the named capability with caller rewiring, focused behavioral tests, deletion of replaced Rust policy and updated ownership/API docs. Do not silently absorb neighboring subsystems.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Zig can invoke the existing playback/device primitives through the private adapter boundary; actual audio decoding/device ownership stays in Rust with documented named-library justification.
- [ ] #2 Track-ended, position, playback error and device state reach Zig with request/track identity so stale events cannot advance a newer track.
- [ ] #3 Rust audio adapters do not query mt.db, choose next tracks, shuffle queues or decide scrobble eligibility; any temporary old policy is isolated and assigned to TASK-393.14/329 rather than copied into the adapter.
- [ ] #4 Adapter tests cover invalid source, seek/pause/resume, stale events, device failure and cancellation; one real playback/seek/end flow is recorded with explicit environment limits.
- [ ] #5 Native media controls continue to work through the current authority during transition and have a documented final routing path to Zig.
- [ ] #6 No new audio backend, decoder, device enumeration implementation or release-profile experiment is introduced; capability docs include errors and shutdown ordering.
<!-- AC:END -->
