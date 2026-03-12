---
id: TASK-268
title: Add audio output device selection
status: Done
assignee:
  - claude
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

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Implementation Plan

### Overview
Add device selector dropdown under Settings > Audio that lists available output devices (with "Default" first), switches output immediately, persists choice, falls back to default if saved device unavailable.

### Key Files

**Rust backend:**
1. `crates/mt-tauri/src/audio/audio_error.rs` - Add `Device` error variant
2. `crates/mt-tauri/src/audio/engine.rs` - Add `set_device()` method, device enumeration
3. `crates/mt-tauri/src/commands/audio.rs` - Add `AudioCommand::ListDevices` / `SetDevice`, new Tauri commands
4. `crates/mt-tauri/src/lib.rs` - Register new commands

**Frontend:**
5. `app/frontend/js/api/audio.js` (new) - `listDevices()` and `setDevice()` API calls
6. `app/frontend/js/api/index.js` - Re-export audio API
7. `app/frontend/js/components/settings-view.js` - Audio section state/methods
8. `app/frontend/views/settings.html` - Audio section HTML with dropdown

**Tests:**
9. `crates/mt-tauri/src/commands/audio.rs` (tests module) - Unit tests for new types
10. `app/frontend/tests/settings-audio.spec.js` - Playwright E2E

### Steps

#### Step 1: Rust - AudioError + AudioEngine device support
- Add `Device(String)` to `AudioError`
- Add `set_device(&mut self, name: Option<&str>)` to `AudioEngine` that enumerates devices via `rodio::cpal`, finds match, creates new OutputStream, re-attaches playback
- Add `list_devices()` standalone fn returning Vec<String>

#### Step 2: Rust - AudioCommand + Tauri commands
- Add `ListDevices(Sender<Vec<String>>)` and `SetDevice(Option<String>, Sender<Result<(), String>>)` to AudioCommand
- Handle in audio_thread match
- Add `audio_list_devices` and `audio_set_device` Tauri command fns
- Register in lib.rs invoke_handler
- Persist selection via AppHandle settings store on SetDevice
- On audio_thread startup: read saved device, apply if available

#### Step 3: Rust unit tests
- Test AudioCommand new variants
- Test device list response serialization
- Test PlaybackStatus serialization unchanged

#### Step 4: Frontend - API + Settings UI
- New `api/audio.js` with listDevices/setDevice
- Add "Audio" nav section in settings-view.js
- Add Audio section in settings.html with select dropdown
- On mount: fetch device list + saved setting
- On change: call setDevice, update settings store

#### Step 5: Playwright E2E test
- Navigate to Settings > Audio
- Verify dropdown with "Default" option
- Mock device list, verify selection triggers command

### Design Decisions
- No cpal dep needed: rodio re-exports cpal types
- Device switch = capture position, new stream, reload track, seek (brief gap acceptable)
- Settings key: `audio_output_device` in Tauri Store via existing settings_get/set
- "default" sentinel string to distinguish from unconfigured
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementation Notes (2026-03-07)

- Used rodio's re-exported cpal types (`rodio::cpal::traits::{DeviceTrait, HostTrait}`) for device enumeration rather than adding cpal as a separate dependency
- Device switching preserves playback position by capturing state (position_ms, was_playing, track_info), creating new OutputStream, reloading the track on new stream's mixer, seeking to saved position
- Settings persistence uses the existing Tauri Store plugin (`mt-settings.json`) with key `audio_output_device` - the same store used by all other settings
- Audio thread restores saved device on startup with fallback to default if the saved device is unavailable
- The `setAudioDevice` frontend method passes `null` for "Default" (maps to `None` in Rust), which triggers `OutputStreamBuilder::open_default_stream()`
- Added 'audio' to the UI store's `setSettingsSection` whitelist to enable navigation
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Audio Output Device Selection\n\nAdd Settings > Audio section with device selector dropdown that enumerates available output devices via cpal (through rodio), switches output immediately while preserving playback position, and persists the selection across restarts.\n\n### Changes\n\n**Rust backend (4 files modified):**\n- `audio/audio_error.rs`: Added `Device(String)` error variant\n- `audio/engine.rs`: Added `list_output_devices()` function and `AudioEngine::set_device()` method that creates new OutputStream on selected device, reloads current track preserving position/state\n- `commands/audio.rs`: Added `AudioCommand::ListDevices`/`SetDevice` variants, `audio_list_devices`/`audio_set_device` Tauri commands, `DeviceListResponse` struct, saved device restoration on audio thread startup\n- `lib.rs` + `commands/mod.rs`: Registered and re-exported new commands\n\n**Frontend (5 files modified/created):**\n- `api/audio.js` (new): `listDevices()` and `setDevice()` API functions\n- `api/index.js`: Re-exported audio API module\n- `components/settings-view.js`: Audio section state, `loadAudioDevices()`/`setAudioDevice()` methods, \"Audio\" nav entry\n- `views/settings.html`: Audio section with labeled `<select>` dropdown, Default + enumerated devices\n- `stores/ui.js`: Added 'audio' to settings section whitelist\n\n### Tests\n\n- **Rust**: 10 new tests (3 in engine_test.rs for device enumeration/switching, 7 in commands/audio.rs for command variants and DeviceListResponse serialization). Total: 621 pass.\n- **Playwright E2E**: 6 new tests in `settings-audio.spec.js` covering nav visibility, section navigation, dropdown rendering, mocked device list, device selection invoke, and default selection. Full suite: 612 pass, 0 fail.\n- **Linting**: `cargo clippy`, `cargo fmt`, `deno lint`, `deno fmt` all clean (5 pre-existing collapsible_if clippy warnings unchanged).
<!-- SECTION:FINAL_SUMMARY:END -->
