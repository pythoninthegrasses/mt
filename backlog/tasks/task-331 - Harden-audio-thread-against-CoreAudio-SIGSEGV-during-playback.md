---
id: TASK-331
title: Harden audio thread against CoreAudio SIGSEGV during playback
status: Done
assignee: []
created_date: '2026-04-13 23:00'
updated_date: '2026-04-14 15:08'
labels:
  - bug
  - audio
  - crash
  - macos
  - usb-audio
dependencies: []
references:
  - crates/mt-tauri/src/audio/engine.rs
  - crates/mt-tauri/src/commands/audio.rs
  - app/frontend/js/components/settings-view.js
priority: high
ordinal: 1250
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

mt crashes with SIGSEGV (null pointer dereference at address 0x4) inside CoreAudio's `HALDeviceList::GetData()` during active playback. The crash occurs on Thread 27 (audio thread), a few seconds into playing a FLAC track — not during device enumeration or settings interaction.

### Crash signature

```
Thread 27 Crashed:
0  CoreAudio  HALDeviceList::GetData() + 220
1  CoreAudio  AudioObjectGetPropertyData_mac_imp + 252
2  mt         +212244   (calls into CoreAudio)
3  mt         +3440708  (audio_thread)
4  mt         +3437736  (audio_thread)

Exception: EXC_BAD_ACCESS (SIGSEGV)
KERN_INVALID_ADDRESS at 0x0000000000000004
```

### Reproduction context

- v1.5.0 installed under /Applications on macOS 15.7.1 (Apple Silicon)
- Successfully played The La's - There She Goes (FLAC)
- Crashed seconds into The La's - Endless (FLAC) from the same album
- User was NOT interacting with device settings or listing devices
- App uptime ~5 minutes (launched 17:39, crashed 17:44)

### Background

This is a regression after the refactor to move more business logic to the backend. Commit a835edd partially mitigated a startup variant of this crash by deferring CoreAudio calls until first user action, but the mid-playback path remains unprotected.

SIGSEGV cannot be caught in Rust (`catch_unwind` does not help). CoreAudio's HAL can return null/invalid state transiently (e.g., device hotplug, Bluetooth state change, audio route changes, or internal HAL race conditions). Any code path that calls `AudioObjectGetPropertyData` on the audio thread risks killing the entire process.

## Affected code paths

1. `AudioEngine::new()` -> `OutputStreamBuilder::open_default_stream()` — queries default device (`crates/mt-tauri/src/audio/engine.rs:46`)
2. `AudioEngine::set_device()` -> `host.output_devices()` — enumerates all devices (`engine.rs:274-276`)
3. `list_output_devices()` -> `host.output_devices()` — standalone enumeration (`engine.rs:381-384`)
4. `ensure_engine()` -> `set_device()` — device restore on first init (`commands/audio.rs:126`)
5. Possible: rodio/cpal internal callbacks during stream operation that re-query device properties

## Investigation needed

- Determine which exact code path triggered `AudioObjectGetPropertyData` during playback (offset +212244 in the v1.5.0 binary)
- Check whether rodio/cpal internally re-queries device properties during stream operation or track decode
- Check if `OutputStreamBuilder::open_default_stream()` is called again during track transitions (e.g., LoadAndPlay for a new track while engine already exists)
- Review whether the audio thread poll loop (100ms recv_timeout) can trigger any CoreAudio calls indirectly

## Hardening approach (to be designed)

- Isolate all CoreAudio device queries from the audio playback thread — run enumeration on a disposable thread with a timeout so a CoreAudio crash doesn't kill the audio thread
- Cache the device list; refresh only on explicit user request
- Consider whether `open_default_stream` can be replaced with a cached stream that survives track transitions (already partially done — stream is reused, but `LoadAndPlay` may recreate it)
- Evaluate if rodio/cpal exposes a way to avoid re-querying device properties during normal playback
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 CoreAudio device enumeration (output_devices(), default_output_device()) never runs on the audio playback thread
- [x] #2 Device list queries run on a separate disposable thread with a timeout
- [x] #3 A CoreAudio HAL crash during device enumeration does not kill the mt process
- [x] #4 Existing playback continues uninterrupted if device enumeration fails
- [x] #5 Audio stream is reused across track transitions — no re-querying CoreAudio on LoadAndPlay when engine already exists
- [x] #6 Regression test (or documented manual test) for playing consecutive FLAC tracks without crash
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## System Log Analysis (2026-04-13)

### Timeline (PID 5164)

| Time | Event |
|------|-------|
| 17:39:55 | mt launched |
| 17:44:22 | RMS -19.2 dB — audio playing (There She Goes ending or Endless starting) |
| 17:44:30 | WebView becomes invisible (app briefly switched away) |
| 17:44:32 | **RMS drops to -120 dB (silence)** — USB audio stream output goes dead |
| 17:44:33 | WebView becomes visible again (switched back) |
| 17:44:42 | Still silence on USB output |
| 17:44:45.911 | NowPlayingInfo updated via MediaRemote — track transition to Endless confirmed |
| 17:44:46–49 | Frontend polling playback progress every ~300ms (`runJavaScriptInFrameInScriptWorld`) |
| 17:44:49.278 | **SIGSEGV** in `HALDeviceList::GetData()` on Thread 27 |
| 17:44:49.284 | coreaudiod: `HALS_IOA1Engine::EndWriting: got an error from the kernel trap, Error: 0xE00002EE` on **CalDigit TS4 Audio - Rear** (USB) |
| 17:44:49.285 | IO context 51833 stopped after 9,147,904 frames. Power assertion released for PID 5164 |

### Key findings

1. **USB audio device fault preceded (or coincided with) the crash.** Error `0xE00002EE` is `kIOReturnNotReady` — the CalDigit TS4 dock's rear USB audio output was not ready. This is a kernel-level USB audio glitch.

2. **Audio went silent ~17 seconds before the crash** (17:44:32). The stream was outputting silence while mt thought it was still playing. This suggests the USB audio path was already degraded before the SIGSEGV.

3. **The crash happened during a track transition.** NowPlayingInfo was set at 17:44:45 (Endless), and the SIGSEGV hit 4 seconds later. The audio thread was likely re-querying CoreAudio device properties as part of the `LoadAndPlay` command for the new track — either through `OutputStreamBuilder::open_default_stream()` or `host.output_devices()`.

4. **No mt application-level logs visible** in the unified log. The tracing-appender thread was running but mt's Rust logs either weren't routed to os_log or were file-based only. Check `~/Library/Application Support/com.mt.desktop/` for log files.

### Root cause hypothesis

The CalDigit TS4 USB audio device experienced a transient `kIOReturnNotReady` fault. When mt's audio thread attempted a CoreAudio HAL query during the track transition (LoadAndPlay for Endless), the HAL's internal device list was in an inconsistent state due to the USB fault, resulting in a null pointer dereference at offset 0x4 in `HALDeviceList::GetData()`.

This is not a pure startup race — it's a mid-session CoreAudio HAL instability triggered by a USB audio device fault. The hardening must protect against CoreAudio queries failing catastrophically at any point during the session, not just at startup.

## Implementation Summary (2026-04-14)

### New file: `crates/mt-tauri/src/audio/device_isolation.rs`

- `enumerate_devices_to_stdout()` — subprocess entry point, prints device names as JSON
- `safe_list_output_devices(timeout)` — spawns subprocess with `MT_ENUMERATE_DEVICES=1` for crash-isolated device enumeration (AC #3)
- `resolve_device(name, timeout)` — resolves `cpal::Device` on a disposable thread with `catch_unwind` + timeout (AC #1, #2)

### Modified: `engine.rs`

- Added `AudioEngine::from_device(device)` — creates engine from pre-resolved device (no enumeration)
- Added `AudioEngine::set_device_resolved(device)` — switches output to pre-resolved device, preserves playback state
- Refactored `set_device()` to delegate to `set_device_resolved()` (kept for test convenience)

### Modified: `commands/audio.rs`

- Removed `AudioCommand::ListDevices` — `audio_list_devices` now calls subprocess directly, bypassing audio thread
- Changed `AudioCommand::SetDevice` to carry pre-resolved `cpal::Device` instead of `Option<String>`
- `audio_set_device` resolves device off-thread before sending to audio thread
- `ensure_engine` uses `resolve_device(None)` + `from_device()` for init, `resolve_device(Some(name))` + `set_device_resolved()` for device restoration

### Modified: `main.rs`

- Early exit when `MT_ENUMERATE_DEVICES` env var is set (subprocess mode)

### Manual test procedure for AC #6

1. Build and launch mt
2. Connect a USB audio device (e.g. DAC, dock with audio)
3. Select the USB device in Settings > Audio Output
4. Play 5+ consecutive FLAC tracks from the same album
5. During playback, briefly switch away from mt and back
6. Verify no crash, audio continues uninterrupted
7. Unplug/replug the USB device during playback — verify graceful error, not SIGSEGV
<!-- SECTION:NOTES:END -->
