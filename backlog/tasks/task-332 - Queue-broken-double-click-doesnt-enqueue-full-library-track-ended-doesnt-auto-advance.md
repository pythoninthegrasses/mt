---
id: TASK-332
title: >-
  Queue broken: double-click doesn't enqueue full library, track-ended doesn't
  auto-advance
status: Done
assignee: []
created_date: '2026-04-14 15:23'
updated_date: '2026-04-14 16:08'
labels:
  - bug
  - queue
  - playback
  - frontend
dependencies: []
references:
  - app/frontend/js/utils/queue-builder.js
  - app/frontend/js/components/library-browser.js
  - app/frontend/js/stores/library.js
  - app/frontend/js/stores/player.js
  - app/frontend/js/stores/queue.js
  - crates/mt-tauri/src/audio/engine.rs
  - crates/mt-tauri/src/commands/audio.rs
priority: high
ordinal: 1250
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

Two related queue/playback regressions observed on 2026-04-14:

### Bug 1: Double-clicking a track in library view doesn't enqueue subsequent tracks

When double-clicking a track (e.g. LCD Soundsystem - Losing My Edge) in the main music library view, only the clicked track plays. The rest of the library is not enqueued as context.

**Root cause (likely):** `library-browser.js:456` passes `this.library.filteredTracks` to `handleDoubleClickPlay()`. The library uses pagination (500 tracks/page, 9641 total). The `filteredTracks` getter (`library.js:284-298`) only returns currently loaded pages — it does NOT load all pages first.

Compare with the "Add All to Queue" flow (`library.js:628-631`) which explicitly calls `_loadAllPages()` before queueing. The double-click path in `queue-builder.js:27` skips this step, so only tracks from loaded pages are passed to `queue_play_context`.

If the user scrolled to a track in the middle of the library but earlier/later pages aren't loaded, the queue would be incomplete or the `index` parameter would be wrong relative to the partial track list.

### Bug 2: Playback doesn't auto-advance to next track (stuck at last ~2 seconds)

After manually adding a "Play Next" track (The La's - Endless), playback doesn't advance when the first track finishes. The UI shows the track stuck at approximately the last 2 seconds.

**Possible causes (investigation needed):**

1. **`is_finished()` never returns true** — `engine.rs:272-279` checks `sink.empty() && self.state == Playing`. If the sink doesn't fully drain (rodio/symphonia decoder issue), or if there's a timing race where `self.state` changes before the check, the condition never triggers.

2. **`audio://track-ended` event emitted but not handled** — The frontend listener (`player.js:45-48`) calls `queue.playNext()` which invokes `queue_play_next_track` on the backend. If the queue has only 1 item and no next track, `playNext` may silently stop.

3. **Progress polling stops before track ends** — The progress emission (`audio.rs:309`) only fires when `is_playing` is true. But `get_state()` returns `Stopped` when `is_finished()` is true, so progress emission stops the same tick `is_finished` first triggers. If the last progress update showed ~2s remaining, the UI would freeze there.

### Reproduction

1. Launch mt, open main library view (All tracks, sorted by artist)
2. Scroll to LCD Soundsystem - Losing My Edge, double-click
3. Open Now Playing / queue panel — observe only 1 track (or a small subset) is queued
4. Right-click The La's - Endless, select "Play Next"
5. Wait for Losing My Edge to finish — observe playback doesn't advance

### Log evidence

```
2026-04-14T15:12:56.168887Z  INFO mt_lib::commands::audio: Lazily initializing audio engine on first use
2026-04-14T15:12:56.341239Z  INFO mt_lib::audio::engine: Track loaded path=".../01 - Losing My Edge.mp3" duration_ms=473066
2026-04-14T15:13:20.826571Z  WARN symphonia_bundle_mp3::layer3: mpa: invalid main_data_begin, underflow by 218 bytes
```

No `audio://track-ended` event visible in logs (backend doesn't log it). The symphonia warning about MP3 main_data underflow may be related to Bug 2 — decoder issues could prevent the sink from fully draining.

## Investigation needed

- Add `debug!` logging around `is_finished()` transitions and `audio://track-ended` emission to confirm whether the event fires
- Check if symphonia MP3 decode errors prevent `sink.empty()` from ever returning true
- Verify `filteredTracks` page coverage when double-clicking from different scroll positions
- Check if `queue_play_context` receives the full track list or a partial one (log the count)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Double-clicking a track in the main library view enqueues the full library (all pages) as context, not just loaded pages
- [x] #2 Playback auto-advances to the next queued track when the current track finishes
- [x] #3 Play Next tracks are played when the preceding track ends
- [x] #4 No regression in shuffle, loop, or other queue navigation modes
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Investigation Results (2026-04-14)

### Bug 1: Root Cause Confirmed

`library-browser.js:452` passes `this.library.filteredTracks` to `handleDoubleClickPlay()`. The `filteredTracks` getter only returns tracks from loaded pages (pagination with 500 tracks/page). When a user double-clicks a track at global index 2500 but only pages 0 and 5 are loaded, `filteredTracks` has ~1000 entries and the index 2500 is out of bounds. The guard in `queue-builder.js:16` (`index >= allTracks.length`) triggers, falling back to single-track playback via `playTrack()`.

### Bug 2: Root Cause Analysis

`is_finished()` in `engine.rs:271-279` checks `sink.empty() && self.state == Playing`. The symphonia MP3 decode error (`invalid main_data_begin, underflow by 218 bytes`) near the end of an MP3 file can prevent the sink from fully draining. If `sink.empty()` never returns true, `is_finished()` stays false, `audio://track-ended` never fires, and the frontend's `playNext()` is never called. The UI shows progress frozen at ~2s remaining because `is_playing` remains true but the position stops advancing.

## Fixes Applied

### Bug 1 Fix: `library-browser.js`
- Added `_loadAllPages()` call before `handleDoubleClickPlay()` in `handleDoubleClick()`, matching the pattern used by `addAllToQueue()`

### Bug 2 Fix: `audio.rs` (audio_thread)
- Added stall detection: if playback position hasn't advanced for ~1 second (10 poll cycles at 100ms) and the position is within 5 seconds of the track end, treat the track as finished
- Added debug logging on track-ended emission
- Reset stall counters on Load/LoadAndPlay commands
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Bug 1: Double-click doesn't enqueue full library\n\n**Root cause:** `library-browser.js` passed `filteredTracks` (only loaded pages) to `handleDoubleClickPlay()`. With 500 tracks/page pagination, tracks at high global indices were out of bounds, causing fallback to single-track playback.\n\n**Fix:** Added `_loadAllPages()` call before `handleDoubleClickPlay()` in `handleDoubleClick()`, matching the pattern used by `addAllToQueue()`.\n\n## Bug 2: Playback doesn't auto-advance (stuck at last ~2s)\n\n**Root cause:** Symphonia MP3 decode errors (`invalid main_data_begin`) near end-of-track prevent rodio sink from draining. `sink.empty()` never returns true, so `is_finished()` stays false and `audio://track-ended` never fires.\n\n**Fix:** Added `StallDetector` in `commands/audio.rs` that monitors playback position during the audio thread poll loop. If position hasn't advanced for 10 consecutive polls (~1s) and is within 5s of track end, treats the track as finished.\n\n## Files changed\n- `app/frontend/js/components/library-browser.js` — `_loadAllPages()` before double-click queue\n- `crates/mt-tauri/src/commands/audio.rs` — `StallDetector` struct + integration in audio_thread + 9 unit tests\n- `app/frontend/__tests__/queue-builder.test.js` — 2 regression tests for paginated double-click
<!-- SECTION:FINAL_SUMMARY:END -->
