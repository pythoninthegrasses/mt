---
id: TASK-268
title: Add audio output device selection
status: To Do
assignee: []
created_date: '2026-02-16 15:08'
updated_date: '2026-02-16 21:10'
labels:
  - audio
  - feature
  - musicat-comparison
dependencies: []
priority: low
ordinal: 43500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Allow users to enumerate and switch audio output devices without restarting the app. Musicat comparison revealed this as a gap.

Use cpal (already in dependency tree via rodio) to enumerate devices via `cpal::default_host().output_devices()`. Add `AudioCommand::SetDevice` variant, recreate OutputStream on selected device (preserving playback position), persist selection in settings with fallback to default, and add device selector dropdown in settings view.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Device selector dropdown in settings view lists available output devices
- [ ] #2 Switching device preserves current playback position
- [ ] #3 Selected device persisted in settings and restored on startup
- [ ] #4 Falls back to default device if saved device unavailable
- [ ] #5 New audio_list_devices and audio_set_device Tauri commands
- [ ] #6 Rust unit tests for device enumeration and switching
- [ ] #7 Playwright E2E test for device selector in settings
<!-- AC:END -->
