---
id: TASK-328
title: >-
  Backend queue state machine replacing frontend shuffle, navigation, and
  play-next logic
status: In Progress
assignee: []
created_date: '2026-04-13 03:19'
updated_date: '2026-04-13 04:00'
labels:
  - backend
  - queue
  - frontend
  - state-machine
milestone: m-2
dependencies:
  - TASK-325
references:
  - app/frontend/js/stores/queue.js
  - crates/mt-tauri/src/commands/queue.rs
  - crates/mt-tauri/src/db/queue.rs
  - crates/mt-tauri/src/commands/audio.rs
  - crates/mt-tauri/src/audio/engine.rs
  - crates/mt-tauri/src/events.rs
priority: high
ordinal: 4000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The queue store (`app/frontend/js/stores/queue.js`, 899 lines) currently owns the entire queue state machine: shuffle/unshuffle with Fisher-Yates, play-next pinning with offset tracking, loop/repeat-one mode transitions, play history stack, forward/backward navigation, and integrity checking. This is the densest business logic in the frontend.

### Current architecture (to be replaced)

**Shuffle/unshuffle** at `queue.js:325-400`:
- `_shuffleItems()` saves `_originalOrder`, copies current track to index 0, Fisher-Yates shuffles the rest
- `_unshuffleItems()` restores from `_originalOrder`, finds current track's position in original order
- After shuffle/unshuffle, calls `_syncQueueToBackend()` — a full queue clear+add cycle (multiple IPC calls)

**Play-next pinning** at `queue.js:234-280`:
- `_playNextOffset` tracks how many tracks have been pinned after the current track
- `addPlayNext(track)` inserts at `currentIndex + 1 + _playNextOffset`, increments offset
- This offset must be maintained across shuffle operations and track removals

**Loop mode** at `queue.js:180-215`:
- `toggleLoop()` cycles through none/all/one
- `playNextTrack()` at `queue.js:450` checks loop mode to decide wrap behavior
- Loop-one detection reloads current track instead of advancing

**Navigation** at `queue.js:440-520`:
- `playNextTrack()`: increments index, checks loop mode, handles end-of-queue
- `playPrevTrack()`: pops from `_playHistory` if available, otherwise decrements index
- History is maintained as a JS array that grows without bound

**Integrity** at `queue.js:700-800`:
- `detectAndRepairInconsistencies()` checks for duplicate track IDs, out-of-bounds currentIndex, orphaned queue state
- Runs on app init and after mutations

### Target architecture

All queue state transitions become backend commands. The frontend queue store becomes a thin reactive layer that:
1. Calls backend commands for state transitions
2. Receives state snapshots from backend events
3. Exposes computed UI properties (isShuffled, loopMode, currentTrack, upcomingTracks)

**New backend commands in `crates/mt-tauri/src/commands/queue.rs`:**

```rust
// Shuffle/unshuffle
#[tauri::command]
pub async fn queue_set_shuffle(enabled: bool, ...) -> Result<QueueStateSnapshot, ...>
// Atomically: if enabling, save original order + Fisher-Yates; if disabling, restore original order
// Returns full queue state snapshot

// Loop mode
#[tauri::command]
pub async fn queue_set_loop(mode: String, ...) -> Result<QueueStateSnapshot, ...>
// mode: "none" | "all" | "one"

// Navigation
#[tauri::command]
pub async fn queue_play_next(...) -> Result<QueueNavigationResult, ...>
// Advances index, respects loop mode, pushes current to history, triggers audio
// Returns: { track: Track, queue_state: QueueStateSnapshot }

#[tauri::command]
pub async fn queue_play_previous(...) -> Result<QueueNavigationResult, ...>
// Pops from history or decrements, triggers audio
// Returns: { track: Track, queue_state: QueueStateSnapshot }

// Play-next pinning
#[tauri::command]
pub async fn queue_add_play_next(track_id: i64, ...) -> Result<QueueStateSnapshot, ...>
// Inserts at currentIndex + 1 + playNextOffset, increments offset in DB

// Integrity
#[tauri::command]
pub async fn queue_check_integrity(...) -> Result<IntegrityReport, ...>
// Detects and repairs: duplicates, out-of-bounds index, orphaned state
```

**State snapshot structure:**
```rust
#[derive(serde::Serialize, Clone)]
pub struct QueueStateSnapshot {
    pub items: Vec<QueueItem>,
    pub current_index: i64,
    pub shuffle_enabled: bool,
    pub loop_mode: String,       // "none" | "all" | "one"
    pub play_next_offset: i64,
    pub history: Vec<i64>,       // Track IDs in play history
    pub revision: i64,
}
```

### Rust implementation guidance

**Extend DB schema** in `crates/mt-tauri/src/db/queue.rs`:
- Add `play_next_offset INTEGER DEFAULT 0` to `queue_state` table
- Add `play_history` table: `(id INTEGER PRIMARY KEY, track_id INTEGER, played_at TIMESTAMP)`
- Or store history as JSON in `queue_state` (simpler, bounded to last N entries)

**Shuffle logic** — reuse and consolidate:
- `queue_shuffle` at `commands/queue.rs:186` already has Fisher-Yates — extract into a shared function
- `queue_set_shuffle(true)`: save current order to `original_order_json`, apply Fisher-Yates with current track pinned to index 0
- `queue_set_shuffle(false)`: restore from `original_order_json`, find current track's position in restored order, set as current_index

**Navigation logic**:
- `queue_play_next`: current_index += 1; if index >= len: if loop_all -> index = 0 + re-shuffle if shuffle enabled; if loop_one -> keep index; if none -> return EndOfQueue
- `queue_play_previous`: pop from history table; if empty, current_index -= 1 (clamped to 0)
- Both push/pop the history and trigger `audio_load_and_play` internally

**Play-next pinning**:
- `queue_add_play_next`: insert track at position `current_index + 1 + play_next_offset` in DB, increment `play_next_offset`
- When current track changes (via navigation), reset `play_next_offset` to 0

**Events**: All state-changing commands emit `queue://state-changed` with the full `QueueStateSnapshot`.

**Frontend changes:**
- `app/frontend/js/stores/queue.js`: Remove ALL state machine logic (~500 lines):
  - Remove `_shuffleItems()`, `_unshuffleItems()`, `_originalOrder` management
  - Remove `_playNextOffset` tracking and insertion logic
  - Remove `playNextTrack()` and `playPrevTrack()` navigation logic
  - Remove `_playHistory` array and history management
  - Remove `detectAndRepairInconsistencies()` (replaced by backend command)
  - Remove `_syncQueueToBackend()` (no longer needed — backend IS the source of truth)
- Keep: event listener for `queue://state-changed` that updates local items/currentIndex/etc from snapshot
- Keep: computed getters like `currentTrack`, `upcomingTracks`, `previousTracks` (derived from items + currentIndex)
- Keep: UI-only state like scroll position, selection state

### Existing code to modify
- `_shuffleItems()` at `queue.js:325`
- `_unshuffleItems()` at `queue.js:370`
- `addPlayNext()` at `queue.js:234`
- `playNextTrack()` at `queue.js:450`
- `playPrevTrack()` at `queue.js:480`
- `detectAndRepairInconsistencies()` at `queue.js:700`
- `_syncQueueToBackend()` at `queue.js:600`
- `queue_shuffle` at `commands/queue.rs:186`
- `db/queue.rs` schema and operations
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Queue store's shuffle toggle calls a single invoke('queue_set_shuffle', { enabled }) and receives the reordered queue snapshot from the backend
- [ ] #2 Fisher-Yates shuffle and unshuffle (restore original order) logic is removed from app/frontend/js/stores/queue.js
- [ ] #3 Loop mode changes call invoke('queue_set_loop', { mode }) and receive the updated queue state including whether queue will wrap
- [ ] #4 playNext() and playPrevious() are backend commands that return the new current track and updated index — frontend no longer increments/decrements currentIndex locally
- [ ] #5 Play-next pinning (insertions at _playNextOffset) is handled by a backend command that maintains the offset and returns the updated items array
- [ ] #6 History tracking (_playHistory) moves to backend — playPrevious uses backend history instead of frontend array
- [ ] #7 Queue integrity check (detectAndRepairInconsistencies) runs in Rust via queue_check_integrity command and emits results
- [ ] #8 Frontend queue.js store is reduced to: event listeners for queue state snapshots, getters for computed UI properties, and invoke wrappers
- [ ] #9 Rust tests cover: shuffle/unshuffle preserves all tracks; shuffle puts current track at index 0; loop-all wraps to index 0; loop-one replays same index; play-next inserts at correct offset; playPrevious follows history stack; integrity check detects and repairs duplicate entries
- [ ] #10 Frontend Vitest tests verify queue store applies state snapshots from backend events correctly
<!-- AC:END -->
