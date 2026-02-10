---
id: TASK-108
title: 'P5: Add Linux platform support'
status: In Progress
assignee: []
created_date: '2026-01-12 04:09'
updated_date: '2026-02-10 06:18'
labels:
  - linux
  - platform
  - phase-5
milestone: Tauri Migration
dependencies:
  - task-094
  - task-098
priority: low
ordinal: 750
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
- Debian 13+
- Ubuntu 25.04+
- ~~Fedora 38+~~ [Future stretch goal]
- ~~Arch Linux (rolling)~~

**Build command:**
```bash
# Cross-compile from macOS (if possible) or build on Linux
cargo tauri build --target x86_64-unknown-linux-gnu
```
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 App launches on Debian 13+
- [ ] #2 App launches on Ubuntu 25.04+
- [ ] #3 Audio playback works (FLAC, MP3, M4A)
- [ ] #4 Basic functionality matches macOS
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Current Status (2026-02-10)

### Debian ARM64 (Raspberry Pi CM5) — Working
- Docker cross-build from macOS Apple Silicon produces `mt_0.1.0_arm64.deb` (5.1 MB)
- Base image: Debian 13 trixie-slim (`docker/Dockerfile.linux-arm64`)
- Build command: `task build:linux-arm64`
- Installs and runs on CM5 via `sudo dpkg -i mt_0.1.0_arm64.deb`
- Audio playback: works (ALSA backend via rodio/symphonia)
- PipeWire systems need `pipewire-alsa` runtime dep for audio
- Last.fm integration: working (API keys embedded at compile time via `build.rs`)
- Known issue: Last.fm settings buttons block main thread (task-260)

### Debian/Ubuntu amd64 — CI builds, untested on hardware
- CI release workflow builds `x86_64-unknown-linux-gnu` .deb via `tauri-action`
- Auto-installs system deps (`libwebkit2gtk-4.1-dev`, `libsoup-3.0-dev`, `libasound2-dev`, etc.)
- No physical hardware testing yet

### What works on Debian ARM64
- App launch and full UI rendering (WebKitGTK)
- Library scanning and SQLite database
- Audio playback (FLAC, MP3, M4A confirmed)
- Last.fm auth flow, scrobbling, loved tracks sync
- Settings persistence

### Outstanding items
- Media keys via D-Bus MPRIS: not yet implemented
- System tray: not yet tested
- No Fedora/Arch testing
- Watched folders empty on fresh install (task-259), affects Last.fm matching
<!-- SECTION:NOTES:END -->
