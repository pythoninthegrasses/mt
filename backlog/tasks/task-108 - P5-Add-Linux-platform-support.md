---
id: TASK-108
title: 'P5: Add Linux platform support'
status: In Progress
assignee: []
created_date: '2026-01-12 04:09'
updated_date: '2026-02-07 01:05'
labels:
  - linux
  - platform
  - phase-5
milestone: Tauri Migration
dependencies:
  - task-094
  - task-098
priority: low
ordinal: 37250
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Extend the Tauri app to support Linux.

**Audio backend:**
- symphonia + rodio should work on Linux via ALSA/PulseAudio
- Test with common audio backends

**Platform-specific considerations:**
- Media keys: Use D-Bus MPRIS interface
- File dialogs: GTK integration
- System tray: May need additional configuration
- System dependencies: libwebkit2gtk, libgtk-3, libasound2, etc.

**Testing matrix:**
- Ubuntu 22.04 LTS
- Fedora 38+
- Arch Linux (rolling)

**Build command:**
```bash
# Cross-compile from macOS (if possible) or build on Linux
cargo tauri build --target x86_64-unknown-linux-gnu
```
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 App launches on Ubuntu 22.04
- [ ] #2 Audio playback works (FLAC, MP3, M4A)
- [ ] #3 Basic functionality matches macOS
<!-- AC:END -->
