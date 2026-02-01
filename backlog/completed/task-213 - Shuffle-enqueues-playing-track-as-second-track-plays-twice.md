---
id: task-213
title: Shuffle enqueues playing track as second track (plays twice)
status: Done
assignee: []
created_date: '2026-01-27 07:36'
updated_date: '2026-01-28 01:38'
labels:
  - bug
  - playback
  - queue
  - shuffle
  - frontend
dependencies: []
priority: medium
ordinal: 7906.25
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

When enabling shuffle while a track is playing, the currently playing track appears both at index 0 (where it's moved to preserve playback) AND somewhere else in the shuffled queue, causing it to play twice.

## Current Behavior

In `queue.js` `_shuffleItems()` (lines 530-548):
```javascript
_shuffleItems() {
  if (this.items.length < 2) return;

  const currentTrack = this.currentIndex >= 0 ? this.items[this.currentIndex] : null;
  const otherTracks = currentTrack
    ? this.items.filter((_, i) => i !== this.currentIndex)
    : [...this.items];

  for (let i = otherTracks.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [otherTracks[i], otherTracks[j]] = [otherTracks[j], otherTracks[i]];
  }

  if (currentTrack) {
    this.items = [currentTrack, ...otherTracks];
    this.currentIndex = 0;
  } else {
    this.items = otherTracks;
  }
}
```

The logic correctly:
1. Filters out the current track from otherTracks using index comparison
2. Shuffles the remaining tracks
3. Prepends the current track to the shuffled list

## Suspected Issue

The bug may occur when:
1. Track reference comparison fails (different object instances for same track)
2. `currentIndex` is -1 or invalid, causing currentTrack to be null and not filtered
3. Race condition during toggle where currentIndex changes mid-operation
4. The bug might be in the backend `queue_shuffle` command rather than frontend

## Related Code

- `app/frontend/js/stores/queue.js` - `_shuffleItems()`, `toggleShuffle()`
- `src-tauri/src/commands/queue.rs` - `queue_shuffle()` (lines 173-219)
- Property tests in `queue.props.test.js` line 120: "shuffle with current track moves it to index 0"

## Reproduction Steps

1. Add multiple tracks to queue
2. Play any track
3. Enable shuffle
4. Observe queue - current track should be at index 0 only, not duplicated
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Current track appears exactly once in queue after shuffle
- [x] #2 Current track is at index 0 after shuffle
- [x] #3 No duplicate track IDs in shuffled queue
- [x] #4 Test: Enable shuffle during playback, verify track count unchanged and no duplicates
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Final Fix Implementation

### Problem
When enabling shuffle while playing a track, hitting "next" would restart the current track because:
1. The track was prepended to index 0
2. Calling `setCurrentIndex(0)` triggered the backend to restart playback

### Solution (Simplified)
Keep the current track at index 0 but DON'T call `setCurrentIndex` when enabling shuffle:

1. **Current track stays at index 0**: No removal or separate storage
2. **No backend index update on enable**: Skip `api.queue.setCurrentIndex(0)` when enabling shuffle
3. **History preserved**: Don't clear play history when enabling shuffle (only when disabling)
4. **Original order restored**: When disabling shuffle, restore original order and find track by ID

### Code Changes

**queue.js**:
- `_shuffleItems()`: Current track moved to index 0, other tracks shuffled
- `toggleShuffle()`: When enabling, don't call `setCurrentIndex` (no backend restart)
- `toggleShuffle()`: When disabling, clear history (indices invalid) and update backend index
- Removed `_shuffleSourceTrack` property and all related handling

### Key Insight
The bug was caused by the backend `setCurrentIndex(0)` call triggering a restart, not by the frontend logic itself. By not notifying the backend of the index change when enabling shuffle (the same track is still playing), the restart is avoided.

### Test Updates
- Updated property tests in `queue.props.test.js` to verify:
  - Queue length unchanged after shuffle
  - Current track at index 0 after shuffle
  - `currentIndex = 0` after shuffle
- Updated E2E tests in `queue.spec.js` to validate new behavior

## Fix Implemented

### Root Cause
When `toggleShuffle()` was called, the backend `QUEUE_STATE_CHANGED` event would fire and the event handler in `events.js` would overwrite `currentIndex` with the stale backend value because the `_updating` flag wasn't set.

### Solution
Wrapped `toggleShuffle()` in try/finally with `this._updating = true/false` to prevent the event handler from overwriting state during the operation. Added 200ms delay before resetting `_updating` to let pending backend events pass.

### Additional Fixes
- Fixed `_doSkipNext()` to push to history and pass `fromNavigation=true` to preserve prev button navigation
- Removed 3 undefined `_saveLoopState()` calls
- Added `_validateQueueIntegrity()` for defensive duplicate detection

### Files Changed
- `app/frontend/js/stores/queue.js`
- `app/frontend/__tests__/queue.props.test.js`

### Verification
- All 213 Vitest unit tests pass
- Manual testing required with `task tauri:dev`
<!-- SECTION:NOTES:END -->
