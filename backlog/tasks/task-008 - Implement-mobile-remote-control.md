---
id: TASK-008
title: Implement mobile remote control
status: To Do
assignee: []
created_date: '2025-09-17 04:10'
updated_date: '2026-11-15T05:39:00Z'
labels:
  - feature-freeze
dependencies:
  - TASK-393.28
ordinal: 49500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add a separately designed mobile/web remote for existing playback operations after the Zig-first migration is complete. Zig owns remote-command application policy; the desktop shell and audio adapters retain their existing boundaries. Define the supported client and authentication/network threat model before implementation; reusing the local sidecar server is not authorization to bind it to a LAN interface or expose its bearer token. Discovery/pairing, transport, mobile UI and deployment need a bounded follow-up breakdown when this feature becomes eligible, not during the engine migration. Scheduling: feature work is frozen until TASK-393.28 verifies Zig-first completion; TASK-393 is the initiative. Do not start this task during the freeze or implement it as a side effect of a migration task. Bugfixes require their own explicit scope. When released, read TASK-369.5's ownership ADR and then-current APIs, research the current system and record a bounded plan. Zig owns domain policy and persistence; Rust is only the Tauri/native or named-library adapter. Existing behavior remains the migration baseline until this feature is scheduled.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Design mobile remote control interface
- [ ] #2 Implement network communication protocol
- [ ] #3 Add remote control server component
- [ ] #4 Create mobile client app
- [ ] #5 Test remote control functionality
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-11-14 maintainer approved a feature freeze until the Zig refactor is complete. TASK-393.28 is now an explicit scheduling dependency. Any earlier Rust-domain implementation guidance is superseded by Zig-first ownership; preserved native/Tauri/library integration remains Rust where justified.
<!-- SECTION:NOTES:END -->
