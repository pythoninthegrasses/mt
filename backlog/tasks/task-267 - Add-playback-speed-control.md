---
id: TASK-267
title: Add playback speed control
status: Done
assignee: []
created_date: '2026-02-16 15:08'
updated_date: '2026-02-21 00:19'
labels:
  - audio
  - feature
  - musicat-comparison
dependencies: []
ordinal: 40500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add variable playback speed control (0.5x - 2.0x) to the audio engine and player UI. Musicat comparison revealed this as a gap.

Rodio's `Sink::set_speed(f32)` provides built-in support. Add `speed: f32` field to `AudioEngine`, new `AudioCommand::SetSpeed` variant following the `SetVolume` pattern, a new `audio_set_speed` Tauri command, and a speed selector in player controls.

Note: rodio's set_speed changes pitch proportionally. Pitch-invariant time-stretching would require additional DSP and can be deferred.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Speed presets available in player controls (0.5x, 0.75x, 1.0x, 1.25x, 1.5x, 2.0x)
- [ ] #2 AudioEngine tracks speed state and applies via Sink::set_speed()
- [ ] #3 New audio_set_speed Tauri command exposed to frontend
- [ ] #4 Speed resets to 1.0x on new track load
- [ ] #5 PlaybackStatus includes current speed for UI sync
- [ ] #6 Rust unit tests for speed command handling
- [ ] #7 Playwright E2E test for speed selector interaction
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Won't do
<!-- SECTION:FINAL_SUMMARY:END -->
