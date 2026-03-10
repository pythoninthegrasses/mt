---
id: TASK-268
title: Add audio output device selection
status: Done
assignee: []
created_date: '2026-02-16 15:08'
updated_date: '2026-03-10 05:55'
labels:
  - audio
  - feature
  - tauon-reference
dependencies: []
references:
  - >-
    screenshot:
    ~/Library/CloudStorage/Dropbox/mt/tauon/settings/audio/Screenshot 2026-03-07
    at 4.19.22 PM.png
  - 'https://github.com/taiko2k/tauon'
priority: low
ordinal: 5000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Allow users to enumerate and switch audio output devices without restarting the app. Located under Settings > Audio > "Set audio output device".

**Reference implementation**: Tauon Music Box (Settings > Audio). Tauon displays a device list with "Default" as the first entry (maps to system default output), followed by all enumerated output devices by name. Selecting a device switches output immediately.

Use cpal (already in dependency tree via rodio) to enumerate devices via `cpal::default_host().output_devices()`. Add `AudioCommand::SetDevice` variant, recreate OutputStream on selected device (preserving playback position), persist selection in settings with fallback to default, and add device selector dropdown in settings view. "Default" (system output) should be the default selection.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Device selector dropdown in settings view lists available output devices
- [x] #2 Switching device preserves current playback position
- [x] #3 Selected device persisted in settings and restored on startup
- [x] #4 Falls back to default device if saved device unavailable
- [x] #5 New audio_list_devices and audio_set_device Tauri commands
- [x] #6 Rust unit tests for device enumeration and switching
- [x] #7 Playwright E2E test for device selector in settings
<!-- AC:END -->
