---
id: task-109
title: 'P5: Add Windows platform support'
status: Done
assignee: []
created_date: '2026-01-12 04:09'
updated_date: '2026-02-20 18:32'
labels:
  - windows
  - platform
  - phase-5
milestone: Tauri Migration
dependencies:
  - task-094
  - task-098
priority: low
ordinal: 37500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Extend the Tauri app to support Windows.

**Audio backend:**
- symphonia + rodio should work on Windows via WASAPI
- Test audio output device selection

**PEX sidecar:**
- Build PEX for `x86_64-pc-windows-msvc`
- May need to bundle Python runtime or use py2exe alternative
- Test on Windows 10/11

**Platform-specific considerations:**
- Media keys: Windows Media Transport Controls
- File paths: Handle backslashes and UNC paths
- Installer: Generate MSI or NSIS installer

**Build command:**
```bash
# Cross-compile from macOS or build on Windows
cargo tauri build --target x86_64-pc-windows-msvc
```
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 App launches on Windows 10/11
- [ ] #2 Audio playback works (FLAC, MP3, M4A)
- [ ] #3 PEX sidecar runs correctly
- [ ] #4 Installer generated (.msi or .exe)
<!-- AC:END -->
