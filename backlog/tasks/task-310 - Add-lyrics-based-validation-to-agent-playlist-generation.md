---
id: TASK-310
title: Add lyrics-based validation to agent playlist generation
status: To Do
assignee: []
created_date: '2026-04-04 08:54'
updated_date: '2026-11-15T05:39:00Z'
labels:
  - agent
  - quality
  - bug
  - feature-freeze
dependencies:
  - TASK-393.28
references:
  - src-tauri/src/agent.rs
  - docs/agent.md
priority: medium
ordinal: 51500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Improve instrumental-only agent recommendations by consulting existing local lyrics evidence before requesting uncached evidence from the lyrics service. Zig owns intent-specific validation and candidate decisions using its lyrics and library services; SDK/provider transport is only a retained capability if justified. Run validation only for instrumental/no-vocals requests and allow additional candidate search when too many are rejected. Preserve an explicit unknown/error state: absence of lyrics is not proof of instrumental audio. Do not silently treat offline/timeout/not-found responses as verified instrumental evidence. Scheduling: feature work is frozen until TASK-393.28 verifies Zig-first completion; TASK-393 is the initiative. Do not start this task during the freeze or implement it as a side effect of a migration task. Bugfixes require their own explicit scope. When released, read TASK-369.5's ownership ADR and then-current APIs, research the current system and record a bounded plan. Zig owns domain policy and persistence; Rust is only the Tauri/native or named-library adapter. Existing behavior remains the migration baseline until this feature is scheduled.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 When the agent prompt implies instrumental-only tracks, each candidate track is checked for lyrics before inclusion
- [ ] #2 Check the local SQLite db for cached lyrics first -- if the track has been played before, lyrics should already be stored
- [ ] #3 Only call the lrclib API for tracks with no cached lyrics in the db
- [ ] #4 Tracks with lyrics found (cached or fetched) are excluded from the final playlist
- [ ] #5 Tracks where no lyrics exist (or lrclib returns instrumental flag) are kept
- [ ] #6 The validation does not run for non-instrumental prompts (no performance penalty for normal playlists)
- [ ] #7 If filtering removes too many tracks, the agent is informed and can search for more candidates
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-11-14 maintainer approved a feature freeze until the Zig refactor is complete. TASK-393.28 is now an explicit scheduling dependency. Any earlier Rust-domain implementation guidance is superseded by Zig-first ownership; preserved native/Tauri/library integration remains Rust where justified.
<!-- SECTION:NOTES:END -->
