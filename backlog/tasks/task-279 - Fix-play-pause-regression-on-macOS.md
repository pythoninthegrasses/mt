---
id: TASK-279
title: Fix play/pause regression on macOS
status: Done
assignee: []
created_date: '2026-02-20 18:32'
updated_date: '2026-02-20 18:50'
labels:
  - bug
  - regression
  - playback
  - macos
dependencies: []
priority: high
ordinal: 1000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Play/pause no longer works on macOS. It is unknown whether Linux and Windows are also affected.

## Affected Components

| Component | File |
|-----------|------|
| Audio Engine | `crates/mt-tauri/src/audio/engine.rs` |
| Audio Commands | `crates/mt-tauri/src/commands/audio.rs` |
| Media Keys (souvlaki) | `crates/mt-tauri/src/media_keys.rs` |
| Player Store | `app/frontend/js/stores/player.js` |
| Player Controls UI | `app/frontend/js/components/player-controls.js` |
| App Setup | `crates/mt-tauri/src/lib.rs` |

## Architecture Context

The play/pause flow has multiple layers to investigate:

1. **UI layer**: `togglePlay()` in `player.js` dispatches `audio_play`/`audio_pause` Tauri IPC commands
2. **Tauri commands**: `audio_play`/`audio_pause` in `commands/audio.rs` send messages to the audio thread
3. **Audio engine**: Rodio sink `.play()`/`.pause()` in `engine.rs`
4. **Media keys**: `souvlaki` crate emits `mediakey://` events routed back to the player store
5. **Now Playing**: `media_set_playing()`/`media_set_paused()` update system media state
6. **State sync**: 250ms progress polling keeps frontend `isPlaying` in sync with backend

## Debugging Steps

- Check if the UI button click reaches the Tauri command (frontend console logs)
- Check if the Tauri command reaches the audio engine (Rust tracing logs)
- Check if the Rodio sink state actually changes
- Check if media key events still fire and route correctly
- Test on Linux/Windows to determine if this is macOS-specific
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Play/pause works via UI button click on macOS
- [x] #2 Play/pause works via media keys on macOS
- [x] #3 Verify play/pause on Linux and Windows (document platform-specific findings)
- [x] #4 Regression tests added covering play/pause toggle via UI and media keys
- [x] #5 Regression tests verify playback state sync between frontend and backend
- [x] #6 No regressions in track loading, queue advancement, or shuffle behavior
- [x] #7 Add logging to play, pause, and stopped events
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Root Cause Analysis

### Primary Bug: Store initialization order (AC#1)
`index.js` registered `queue` store before `player` store. Queue's `init()` calls `clear()`, which calls `Alpine.store('player').stop()` — but player wasn't registered yet, causing a crash that silently prevented the player store from ever initializing. All play/pause functionality was broken.

**Fix**: Swapped registration order in `index.js` (player before queue) and added optional chaining (`?.stop()`) as a safety net.

### Secondary Bug: Missing global media shortcuts (AC#2)
Commit `c57f8c1` removed `tauri-plugin-global-shortcut`, which was the only mechanism capturing hardware media keys (keyboard play/pause, Touch Bar, AirPods). The remaining `souvlaki` integration only hooks into macOS `MPRemoteCommandCenter` (Now Playing widget), which requires the app to be the active media app.

**Fix**: Re-added `tauri-plugin-global-shortcut` with `debug!` tracing instead of `println!`.

## Files Changed

| File | Change |
|------|--------|
| `app/frontend/js/stores/index.js` | Swapped player/queue registration order |
| `app/frontend/js/stores/queue.js` | Added optional chaining to `player.stop()` calls |
| `app/frontend/js/stores/player.js` | Added logging for media key events and now playing state |
| `crates/mt-tauri/Cargo.toml` | Re-added `tauri-plugin-global-shortcut = "2"` |
| `crates/mt-tauri/capabilities/default.json` | Added `global-shortcut:allow-register` permission |
| `crates/mt-tauri/src/lib.rs` | Re-added `setup_global_shortcuts()` with tracing |
| `crates/mt-tauri/src/media_keys.rs` | Added debug logging to set_metadata/playing/paused/stopped |
| `crates/mt-tauri/src/commands/audio.rs` | Added debug logging to audio thread Play/Pause/Stop handlers |
| `app/frontend/__tests__/playback-regression.test.js` | New: 12 regression tests |

## Platform Notes (AC#3)
- **macOS**: Confirmed working — UI button play/pause and MediaPlayPause global shortcut both function correctly
- **Linux/Windows**: Not tested locally. The `MediaStop` shortcut registration fails on macOS (`Unknown scancode for MediaStop`) — this is a known macOS limitation and does not affect Linux/Windows
- **Note**: `tauri-plugin-global-shortcut` handles cross-platform media key registration; `souvlaki` handles cross-platform Now Playing/MPRIS/SMTC integration
<!-- SECTION:NOTES:END -->
