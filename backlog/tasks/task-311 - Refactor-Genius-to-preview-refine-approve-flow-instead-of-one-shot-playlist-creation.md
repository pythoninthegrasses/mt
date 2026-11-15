---
id: TASK-311
title: >-
  Refactor Genius to preview/refine/approve flow instead of one-shot playlist
  creation
status: To Do
assignee: []
created_date: '2026-04-04 08:59'
updated_date: '2026-11-15T05:39:00Z'
labels:
  - genius
  - ux
  - refactor
  - feature-freeze
dependencies:
  - TASK-393.28
references:
  - docs/agent.md
  - docs/genius.md
  - crates/mt-tauri/src/agent/mod.rs
  - app/frontend/js/components/genius-browser.js
priority: medium
ordinal: 50500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Replace current one-shot Genius playlist persistence with generate, preview, iterative refinement, explicit approval and discard. Zig owns candidate/session policy, tool validation, shuffle-spread-at-approval and playlist persistence; the retained rig-core/provider capability only performs approved SDK work. Generation/refinement must not write a playlist, approval is the sole persistence point, and cancel/discard has no DB side effects. Frontend provides candidate preview/refinement/approve/discard UI. Reuse the final engine/agent boundary; do not create a Rust application orchestrator. Scheduling: feature work is frozen until TASK-393.28 verifies Zig-first completion; TASK-393 is the initiative. Do not start this task during the freeze or implement it as a side effect of a migration task. Bugfixes require their own explicit scope. When released, read TASK-369.5's ownership ADR and then-current APIs, research the current system and record a bounded plan. Zig owns domain policy and persistence; Rust is only the Tauri/native or named-library adapter. Existing behavior remains the migration baseline until this feature is scheduled.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Submitting a Genius prompt returns a candidate track list without creating a playlist in the database
- [ ] #2 Candidate tracks are displayed in a preview panel showing title, artist, album, and duration
- [ ] #3 User can enter refinement feedback that sends another agent turn with conversational context, updating the preview
- [ ] #4 Refinement can be repeated multiple times before approving
- [ ] #5 User can approve the candidate, which persists the playlist to the database and emits PlaylistsUpdatedEvent
- [ ] #6 User can discard/cancel a candidate without any database side effects
- [ ] #7 shuffle_spread_artists runs at approve time, not generate time
- [ ] #8 Existing one-shot behavior is fully replaced (no legacy path)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-11-14 maintainer approved a feature freeze until the Zig refactor is complete. TASK-393.28 is now an explicit scheduling dependency. Any earlier Rust-domain implementation guidance is superseded by Zig-first ownership; preserved native/Tauri/library integration remains Rust where justified.
<!-- SECTION:NOTES:END -->
