---
id: TASK-329
title: Make Zig authoritative for playback-session snapshots and scrobble timing
status: To Do
assignee: []
created_date: '2026-04-13 03:20'
updated_date: '2026-11-15T05:37:00Z'
labels:
  - zig-first
  - migration
  - playback
milestone: m-2
dependencies:
  - TASK-393.14
  - TASK-393.29
  - TASK-393.20
  - TASK-393.11
references:
  - TASK-393
  - TASK-393.14
  - TASK-393.29
  - TASK-393.20
  - app/frontend/js/stores/player.js
  - app/frontend/js/stores/queue.js
  - crates/mt-tauri/src/commands/audio.rs
priority: high
ordinal: 1429.6875
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
This existing refactor is part of TASK-393 migration, not a frozen product feature. After Zig owns queue state, audio primitives, artwork resolution, Last.fm submission and history storage, consolidate current frontend playback-session assembly into one Zig-owned snapshot. Rust reports observed playback through its adapter and Tauri may forward commands/events, but Rust must not own a competing PlaybackSessionManager or scrobble state machine. Preserve current user-facing behavior. Artwork fallback/cache is delivered by TASK-393.29, Last.fm network/outbox behavior by TASK-393.20, queue authority by TASK-393.14; consume these rather than reimplement them.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 One Zig-owned session snapshot supplies current track metadata/artwork, queue position/total/shuffle/loop, observed playback state/position/duration and scrobble status through the agreed engine API.
- [ ] #2 Frontend player state applies snapshots/events and keeps presentation-only state; it no longer reconstructs session truth or runs scrobble eligibility timing across queue/audio listeners.
- [ ] #3 Zig tracks actual eligible listened time under the current Last.fm rules, including pause/seek/repeat/track-change cases; submission uses the Last.fm worker and outbox without duplicate eligibility authorities.
- [ ] #4 Session updates carry identity/revision so late audio, metadata or artwork replies cannot overwrite a newer track; update frequency is bounded and reconnect can resynchronize from a snapshot.
- [ ] #5 Restore/relaunch uses Zig-owned persisted session/queue data and a single authoritative hydration path; it does not resume unwanted audio or require frontend DB assembly.
- [ ] #6 Zig tests cover track changes, pause/resume/seek, scrobble thresholds, stale events and restore; frontend tests verify snapshot application and preservation of UI-only drag/volume state.
- [ ] #7 Real Tauri playback, queue update, pause/seek, artwork display and relaunch hydrate correctly; Rust retains only audio/native capabilities and obsolete session assembly/policy is deleted.
- [ ] #8 Architecture, playback and Last.fm docs identify the final session authority and event contract; no new product feature or Rust session-manager implementation is introduced.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-11-14 approved migration re-scope: prior Rust PlaybackSessionManager code examples/paths in the old description are superseded. This task is exempt from feature freeze because it completes engine ownership, not because session features in general are unfrozen.
<!-- SECTION:NOTES:END -->
