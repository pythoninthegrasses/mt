---
id: TASK-284
title: Fix loop-once not re-queuing current track
status: Done
assignee: []
created_date: '2026-02-22 22:16'
updated_date: '2026-02-24 17:09'
labels:
  - bug
  - playback
  - loop
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Loop once mode fails to re-queue the current track when it ends. The track should restart from the beginning instead of advancing to the next track.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 When loop-once is active, the current track restarts when it ends
- [x] #2 After restarting once, playback proceeds normally to the next track
- [x] #3 Loop-once state is correctly cleared after the single repeat
- [x] #4 Other loop modes (loop-all, no-loop) are unaffected
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Root Cause

The `playNext()` method in `queue.js` lacked the `_updating` guard that other queue methods (`skipNext`, `skipPrevious`, `toggleShuffle`) already had. When loop-one completed and set `this.loop = 'none'` locally, the subsequent `playIndex()` call triggered a backend `QUEUE_STATE_CHANGED` event. The event handler in `events.js:166` overwrote `queue.loop` back to `'one'` (the stale value stored in the backend DB), undoing the loop-one completion.

## Fix

Changes to `playNext()` in `app/frontend/js/stores/queue.js`:

1. Wrapped the method body in `this._updating = true / false` guard (matching the pattern used by `skipNext`, `skipPrevious`, `toggleShuffle`) to prevent `QUEUE_STATE_CHANGED` events from overwriting local state during execution.
2. Added `await api.queue.setLoop(this.loop)` when loop-one fires, so the backend DB reflects the new `'none'` state and subsequent events carry the correct value.
3. Restructured the loop-one check so `loop` is set to `'none'` immediately when the repeat starts (first `playNext`), not when it completes (second `playNext`). This makes the repeat-one icon untoggle as soon as the track restarts, giving clearer visual feedback. The `_repeatOnePending` flag (checked before the `loop === 'one'` branch) still gates the advance on the second call.

## Tests

Added 7 deterministic tests to `queue.store.test.js`:
- `playNext` with loop=one replays current track and untoggles icon on first call
- `playNext` with loop=one advances to next track on second call
- loop=one clears to none when repeat starts, not when it completes
- `cycleLoop` resets `_repeatOnePending`
- loop=all wraps around (unaffected)
- loop=none stops at end (unaffected)

Also added `playNext()` and updated `skipNext()` methods to the test store helper for loop-one coverage.

All 271 frontend tests pass. All 4 Rust loop tests pass.
<!-- SECTION:FINAL_SUMMARY:END -->
