---
id: TASK-301
title: 'Global playback control shortcuts (stop after current, etc.) from all views'
status: To Do
assignee: []
created_date: '2026-03-31 03:36'
updated_date: '2026-11-15T05:39:00Z'
labels:
  - enhancement
  - ux
  - playback
  - feature-freeze
dependencies:
  - TASK-393.28
priority: medium
ordinal: 2859.375
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Make existing playback controls, including Stop After Current Track, reachable from Now Playing and other views through consistent discoverable shortcuts/UI. This is new UI accessibility work, not a replacement queue or audio state machine. The frontend/Tauri shell dispatches actions to the Zig queue/session authority; Rust audio remains a primitive adapter. Preserve focus/text-entry shortcut behavior and avoid duplicating action policy across views. Scheduling: feature work is frozen until TASK-393.28 verifies Zig-first completion; TASK-393 is the initiative. Do not start this task during the freeze or implement it as a side effect of a migration task. Bugfixes require their own explicit scope. When released, read TASK-369.5's ownership ADR and then-current APIs, research the current system and record a bounded plan. Zig owns domain policy and persistence; Rust is only the Tauri/native or named-library adapter. Existing behavior remains the migration baseline until this feature is scheduled.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Stop After Current Track is accessible from Now Playing view
- [ ] #2 Stop After Current Track is accessible via keyboard shortcut globally
- [ ] #3 Playback controls (play/pause, next, prev, stop after current) work from any view
- [ ] #4 Keyboard shortcuts are documented or discoverable
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-11-14 maintainer approved a feature freeze until the Zig refactor is complete. TASK-393.28 is now an explicit scheduling dependency. Any earlier Rust-domain implementation guidance is superseded by Zig-first ownership; preserved native/Tauri/library integration remains Rust where justified.
<!-- SECTION:NOTES:END -->
