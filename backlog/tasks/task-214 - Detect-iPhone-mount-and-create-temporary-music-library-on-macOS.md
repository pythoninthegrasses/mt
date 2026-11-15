---
id: TASK-214
title: Detect iPhone mount and create temporary music library on macOS
status: To Do
assignee: []
created_date: '2026-01-27 17:57'
updated_date: '2026-11-15T05:40:00Z'
labels:
  - feature
  - macos
  - library
  - usb
  - feature-freeze
dependencies:
  - TASK-393.28
priority: medium
ordinal: 3812.5
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add macOS attached-iPhone/mount detection and a temporary music-library source with configurable path, connection/disconnection handling and graceful fallback. A physically connected iPhone must not be assumed to expose an arbitrary readable mount; distinguish detection from usable source availability and document the supported workflow. Rust may wrap justified macOS/USB/filesystem capabilities; Zig owns temporary-source lifecycle, track identity, library overlay and playback fallback. TASK-341 consumes this task's usable-source/detach contract; it must not duplicate detection. Scheduling: feature work is frozen until TASK-393.28 verifies Zig-first completion; TASK-393 is the initiative. Do not start this task during the freeze or implement it as a side effect of a migration task. Bugfixes require their own explicit scope. When released, read TASK-369.5's ownership ADR and then-current APIs, research the current system and record a bounded plan. Zig owns domain policy and persistence; Rust is only the Tauri/native or named-library adapter. Existing behavior remains the migration baseline until this feature is scheduled.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 iPhone connection is detected via USB enumeration on macOS
- [ ] #2 Configurable mount path for music files (default: ~/Music/Doppler, expands $HOME at runtime)
- [ ] #3 Temporary library is created when iPhone is mounted
- [ ] #4 Temporary library merges/overlays with permanent library
- [ ] #5 iPhone disconnection is detected automatically
- [ ] #6 Missing track errors are suppressed for temporary library files when device is unplugged
- [ ] #7 Playback falls back gracefully to permanent library on disconnect
- [ ] #8 Feature is available only on macOS; native detection is isolated behind the justified platform adapter
- [ ] #9 Unit tests cover detection, mount, and fallback scenarios
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-11-14 maintainer approved a feature freeze until the Zig refactor is complete. TASK-393.28 is now an explicit scheduling dependency. Any earlier Rust-domain implementation guidance is superseded by Zig-first ownership; preserved native/Tauri/library integration remains Rust where justified.
<!-- SECTION:NOTES:END -->
