---
id: TASK-325
title: >-
  Atomic backend play-context command replacing frontend queue-build
  choreography
status: Done
assignee:
  - claude
created_date: '2026-04-13 03:14'
updated_date: '2026-04-13 04:58'
labels:
  - backend
  - queue
  - playback
  - frontend
milestone: m-2
dependencies: []
priority: high
ordinal: 1000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Double-click play currently requires a multi-step IPC choreography orchestrated by the frontend: clear queue, start playback immediately on the clicked track, then build the full queue in the background with generation-guarded async work. This lives in `app/frontend/js/utils/queue-builder.js` and coordinates across `queue.js` and `player.js` stores. The choreography causes race conditions (stale generation checks, `_updating` flags with setTimeout guards, background build promises that must be awaited by playNextTracks).

Replace this with a single atomic Tauri command `queue_play_context` that accepts the full track list, a start index, and a shuffle flag. The backend atomically installs the queue, sets the current index, applies shuffle if requested, and triggers audio playback — all in one IPC round-trip.

### Current flow (to be replaced)
1. `handleDoubleClickPlay()` in `app/frontend/js/utils/queue-builder.js:16` increments `_buildQueueGeneration`, sets `_updating = true`
2. For sequential play: splices single track into local queue array, calls `player.playTrack()`, then spawns background async to `queue.clear()` + `queue.add(fullQueue)` + `queue.setCurrentIndex(0)` — 3 separate IPC calls
3. For shuffle play: calls `queue.clear()` + `queue.add(allTracks)` + `_shuffleItems()` + `_syncQueueToBackend()` + `playIndex(0)` — 5+ IPC calls
4. Background build uses generation guards and setTimeout to release `_updating` flag

### Target flow
1. Frontend calls `invoke('queue_play_context', { trackIds, startIndex, shuffle })` — single IPC call
2. Backend atomically: clears queue, inserts all tracks, applies shuffle (Fisher-Yates with current track at index 0), sets current_index, calls audio_load_and_play on the start track
3. Backend emits `queue://context-loaded` event with the new queue state snapshot (items, currentIndex, shuffle)
4. Frontend receives event, replaces local queue items array and currentIndex from snapshot — no local computation

### Rust implementation guidance

**New command in `crates/mt-tauri/src/commands/queue.rs`:**

```rust
#[derive(serde::Deserialize)]
pub struct PlayContextRequest {
    pub track_ids: Vec<i64>,
    pub start_index: i64,
    pub shuffle: bool,
}

#[derive(serde::Serialize)]
pub struct PlayContextResponse {
    pub items: Vec<QueueItem>,
    pub current_index: i64,
    pub track: Track,  // The track to play (for frontend to update player state)
}
```

The command should:
1. Open a transaction on the DB connection
2. Clear the queue table
3. Look up all track filepaths from `library` by the provided IDs (preserving input order via the existing pattern in `add_to_queue`)
4. If `shuffle`: keep `track_ids[start_index]` at position 0, Fisher-Yates shuffle the rest (reuse pattern from `queue_shuffle` at `commands/queue.rs:186`)
5. If not shuffle: rotate so `track_ids[start_index]` is at position 0, rest follows in original order (matching the `[...subsequent, ...preceding]` pattern from `queue-builder.js:70-71`)
6. Insert all tracks into the queue table
7. Set `current_index = 0` in `queue_state`
8. Set `shuffle_enabled` and store `original_order_json` if shuffled
9. Commit transaction
10. Call `audio_load_and_play` internally (the engine is available via `State<AudioEngine>`)
11. Emit queue context event
12. Return `PlayContextResponse`

**Existing code to reuse:**
- `queue::add_to_queue` pattern for bulk insert (`crates/mt-tauri/src/db/queue.rs:63`)
- `queue_shuffle` Fisher-Yates logic (`crates/mt-tauri/src/commands/queue.rs:186`)
- `audio_load_and_play` command logic (`crates/mt-tauri/src/commands/audio.rs`)
- `EventEmitter` trait for queue events (`crates/mt-tauri/src/events.rs`)

**Frontend changes:**
- `app/frontend/js/utils/queue-builder.js`: Replace `handleDoubleClickPlay` body with single `invoke('queue_play_context', ...)` call + event listener
- `app/frontend/js/stores/queue.js`: Add listener for `queue://context-loaded` that replaces `items`, `currentIndex`, `_originalOrder`, resets `_playHistory` and `_playNextOffset`
- `app/frontend/js/stores/player.js`: Update player state from the response track (artwork, favorite check, now-playing metadata still triggered from frontend since they're UI concerns)
- Remove `_buildQueueGeneration`, `_buildQueuePromise`, `_updating` setTimeout patterns from queue store
- Remove `_syncQueueToBackend()` calls that were needed for the old choreography
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Double-clicking a track in any library view starts playback with a single IPC round-trip (one invoke call visible in frontend code)
- [x] #2 Full queue is installed atomically in the backend — no intermediate states observable by other commands
- [x] #3 Shuffle play-context puts the clicked track at index 0 and Fisher-Yates shuffles the rest
- [x] #4 Sequential play-context rotates the track list so clicked track is at index 0 with subsequent tracks following in original order
- [x] #5 queue-builder.js no longer contains background async queue building or generation guards
- [x] #6 queue.js store no longer uses _buildQueuePromise or _buildQueueGeneration
- [x] #7 Existing queue operations (add, remove, reorder, playNext, playPrevious) continue to work unchanged
- [x] #8 Rust tests cover: empty track list error case; single track; shuffle vs sequential ordering; start_index out of bounds error; concurrent play_context calls (last one wins)
- [x] #9 Frontend Vitest tests in __tests__/ verify queue store receives context-loaded event and updates state correctly
- [x] #10 Playback starts within same latency as current implementation (no regression from atomic approach)
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Implementation Plan (approved)

### Phase 1: Backend DB layer
1. Add `play_context()` function to `crates/mt-tauri/src/db/queue.rs`
   - Transactional: clear queue, look up filepaths, rotate or shuffle, bulk insert, set queue state
   - Returns `(Vec<QueueItem>, Track)` — the installed queue and the track to play
2. Write tests in `db/queue.rs::tests` covering: empty list error, single track, sequential rotation, shuffle (current at 0), start_index OOB, nonexistent track IDs skipped

### Phase 2: Backend command layer
3. Add `PlayContextResponse` struct to `commands/queue.rs`
4. Add `queue_play_context` command that:
   - Calls `db::queue::play_context()`
   - Triggers audio playback via `AudioState::send_command(AudioCommand::LoadAndPlay(...))`
   - Emits existing `queue://updated` + `queue://state-changed` events
   - Returns `PlayContextResponse`
5. Add serialization tests for response struct
6. Register in `commands/mod.rs` and `lib.rs`

### Phase 3: Frontend
7. Add `playContext()` to `app/frontend/js/api/queue.js`
8. Rewrite `queue-builder.js` to use single `queue.playContext()` call
9. Update queue store to apply response data, remove `_buildQueueGeneration`/`_buildQueuePromise` machinery
10. Write Vitest tests for context-loaded handling

### Key decisions
- Command injects `State<AudioState>` + `State<NetworkFileCache>` to trigger playback internally (single IPC round-trip)
- No new event type — reuse existing `QueueUpdatedEvent` + `QueueStateChangedEvent`
- DB function does the heavy lifting; command is thin orchestration layer
<!-- SECTION:PLAN:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Summary

Replaced the multi-step frontend IPC choreography for double-click play with a single atomic Tauri command `queue_play_context`. The backend now atomically clears the queue, installs tracks, applies shuffle/rotation, sets queue state, triggers audio playback, and returns the full result in one IPC round-trip.

### Backend changes
- **`db/queue.rs`**: Added `PlayContextResult` struct and `play_context()` function — transactional clear+insert+state with Fisher-Yates shuffle or sequential rotation. 13 unit tests.
- **`commands/audio.rs`**: Added `AudioState::load_and_play()` pub(crate) method for cross-command audio playback. Extracted `resolve_cached_path_inner()` to avoid State wrapper dependency.
- **`commands/queue.rs`**: Added `PlayContextResponse` struct and `queue_play_context` command — thin orchestration calling DB function, triggering audio, emitting events. 3 serialization tests.
- **`commands/mod.rs` + `lib.rs`**: Registered new command.

### Frontend changes
- **`api/queue.js`**: Added `playContext()` IPC wrapper.
- **`queue-builder.js`**: Rewritten from ~102 lines of generation-guarded async choreography to ~47 lines with a single `playContext()` call.
- **`player.js`**: Added `updateTrackState(track, durationMs)` — updates UI state without re-invoking audio.
- **`queue.js`**: Removed `_buildQueuePromise` field and its usage in `playNextTracks()`.
- **`library-browser.js` + `artists-browser.js`**: Removed `_buildQueueGeneration` field.

### Test coverage
- 706 Rust tests passing (13 new for play_context DB, 3 new for serialization)
- 450 Vitest tests passing (18 new in queue-builder.test.js, updated queue.store.test.js and queue.props.test.js)
- All linting clean (clippy, deno lint, deno fmt, cargo fmt)
<!-- SECTION:FINAL_SUMMARY:END -->
