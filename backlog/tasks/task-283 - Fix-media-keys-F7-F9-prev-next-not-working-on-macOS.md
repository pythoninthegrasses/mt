---
id: TASK-283
title: Fix media keys (F7/F9 prev/next) not working on macOS
status: Done
assignee: []
created_date: '2026-02-22 22:16'
updated_date: '2026-02-24 16:58'
labels:
  - bug
  - macos
  - media-keys
  - playback
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The builtin macOS media keys F7 (previous track) and F9 (next track) are not functioning in the app. These should trigger prev/next track playback control.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 F7 key triggers previous track
- [x] #2 F9 key triggers next track
- [x] #3 Media keys work when app is in focus
- [x] #4 Media keys work when app is in background (if applicable to macOS media key behavior)
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
macOS keyboard F7/F9 send `NX_KEYTYPE_REWIND` (20) / `NX_KEYTYPE_FAST` (19), which `global_hotkey` maps to `Code::MediaRewind` / `Code::MediaFastForward`. The previous registration only covered `Code::MediaTrackPrevious` / `Code::MediaTrackNext` (NX_KEYTYPE 18/17), sent by AirPods/Bluetooth headphone buttons but not the keyboard. Registered both code families so prev/next work from keyboard media keys and external controllers.

Files changed:
- `crates/mt-tauri/src/lib.rs` — register `MediaRewind`/`MediaFastForward` shortcuts, map to same `mediakey://previous`/`mediakey://next` events
- `docs/tauri-architecture.md` — document NX_KEYTYPE mapping and dual registration
<!-- SECTION:FINAL_SUMMARY:END -->
