---
id: task-263
title: Fix shuffle icon desyncs from actual state after hitting next
status: In Progress
assignee: []
created_date: '2026-02-11 06:50'
updated_date: '2026-02-11 06:53'
labels:
  - bug
  - frontend
  - queue
dependencies: []
priority: high
ordinal: 10000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Bug

After pressing "next" to advance tracks, the shuffle icon visually appears toggled on, but shuffle is not actually enabled. To actually enable shuffle, you have to toggle it two more times.

## Repro Steps

1. Start mt
2. Play any track in the music library
3. Hit next

The shuffle button in the footer now appears active (highlighted) but `queue.shuffle` is still `false`. Toggling shuffle requires two clicks to actually sync up.

## Root Cause

Race condition between `skipNext()` and the `queue:state-changed` backend event handler.

- `toggleShuffle()` (`queue.js:535`) sets `_updating = true` to prevent backend events from overwriting the in-flight state change
- `skipNext()` (`queue.js:497`) does **not** set `_updating`, so any `queue:state-changed` event emitted by the backend during the skip operation can overwrite the frontend shuffle state
- The `queue:state-changed` handler in `events.js:146-161` checks `queue._updating` before writing, but since `skipNext()` doesn't set it, the event freely overwrites `queue.shuffle` with the backend value

Timeline:
1. `skipNext()` calls `playIndex()` → triggers backend IPC
2. Backend emits `queue:state-changed` with `shuffle_enabled: false`
3. Event handler sees `_updating === false`, overwrites `queue.shuffle`
4. But the shuffle button's CSS class binding already evaluated, leaving the UI desynchronized

## Fix

Wrap `skipNext()` (and `_doSkipNext()`) with the same `_updating = true` protection pattern used by `toggleShuffle()`, so backend state events during skip operations don't clobber the frontend state.

## Key Files

- `app/frontend/js/stores/queue.js` — `skipNext()` (line 497), `_doSkipNext()` (line 519), `toggleShuffle()` (line 535)
- `app/frontend/js/events.js` — `queue:state-changed` handler (line 146)
- `app/frontend/js/components/player-controls.js` — `isShuffleActive` getter (line 131)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Pressing next does not visually toggle the shuffle icon
- [ ] #2 queue.shuffle frontend state stays in sync with backend shuffle_enabled after skip operations
- [ ] #3 toggleShuffle() still works correctly on first click after a skip operation
<!-- AC:END -->
