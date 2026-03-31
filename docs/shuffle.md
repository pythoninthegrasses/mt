# Shuffle Implementation

This document describes the shuffle and queue ordering logic in mt, covering the data model, key algorithms, interaction with Play Next, and known invariants that tests enforce.

## Data Model

All shuffle state lives in the queue store (`app/frontend/js/stores/queue.js`).

| Field | Type | Purpose |
|-------|------|---------|
| `items` | `Array` | Tracks in **play order** — always reflects the order they will be played |
| `currentIndex` | `number` | Index of the currently playing track (-1 = none) |
| `shuffle` | `boolean` | Whether shuffle mode is active |
| `_originalOrder` | `Array` | Snapshot of `items` taken when shuffle is enabled; restored on disable |
| `_playNextTrackIds` | `Set` | Track IDs added via Play Next — pinned during shuffle |
| `_playHistory` | `Array` | Stack of previously played track objects (matched by ID, survives reorders) |
| `_updating` | `boolean` | Guards against backend events overwriting local state during async operations |

## Shuffle Algorithm

### Enabling shuffle (`toggleShuffle` -> `_shuffleItems`)

`queue.js:605-640` — `toggleShuffle()`
`queue.js:642-675` — `_shuffleItems()`

1. Save current items as `_originalOrder`
2. Partition non-current tracks into two groups:
   - **Pinned** — tracks whose ID is in `_playNextTrackIds` (added via Play Next)
   - **Regular** — everything else
3. Fisher-Yates shuffle **only** the regular tracks
4. Reassemble: `[currentTrack, ...pinnedTracks, ...regularTracks]`
5. Set `currentIndex = 0`

This ensures:

- The currently playing track stays at index 0 (no restart)
- Play Next tracks remain in their insertion order immediately after the current track
- All other tracks are randomized

### Disabling shuffle (`toggleShuffle`)

`queue.js:618-626`

1. Restore `items` from `_originalOrder`
2. Find the currently playing track by ID in the restored array
3. Set `currentIndex` to that position

Play Next tracks are already embedded in `_originalOrder` (it was snapshotted after they were inserted), so they return to their correct positions.

### Backend sync order

`queue.js:629-634`

After shuffle toggle, the backend is updated in this order:

1. `setShuffle()` — persist shuffle flag
2. `_syncQueueToBackend()` — clear and rebuild queue (emits `queue:updated`)
3. `setCurrentIndex()` — set index **after** rebuild to avoid stale state from `clear()`

The `setCurrentIndex` call was moved after `_syncQueueToBackend` to prevent a race where `clear()` could leave a stale index in the backend that late-arriving events would propagate back to the frontend.

## Play Next Pinning

### How it works

`queue.js:281-332` — `playNextTracks()`

When the user queues tracks via Play Next:

1. **Move semantics**: if the track already exists in the queue (common when the full library is loaded), the existing copy is removed first, then re-inserted at the play-next position. The currently playing track is excluded from moves.
2. Tracks are inserted at `currentIndex + 1 + _playNextOffset`
3. Their IDs are added to `_playNextTrackIds`
4. `_playNextOffset` increments so successive Play Next calls append in order

Move semantics prevent both silent drops (track already in queue so nothing happens) and duplicates (track appears twice).

### Lifecycle of a pinned track

| Event | What happens |
|-------|-------------|
| Track starts playing (`playIndex`) | ID removed from `_playNextTrackIds` — no longer pinned |
| Track removed from queue (`remove`) | ID removed from `_playNextTrackIds` |
| Queue cleared (`clear`) | Entire set cleared |
| App restart (`_initPlaybackState`) | Set reset to empty |

Once consumed (played), a track is no longer pinned and participates in future shuffles normally.

## Loop + Shuffle Interaction

### Loop All — reshuffle at boundary

`queue.js:677-698` — `_reshuffleForLoopRestart()`

When `loop=all` and shuffle is enabled, reaching the end of the queue triggers a reshuffle:

1. The just-finished track is placed at the **end** of the new order (not index 0)
2. All other tracks are Fisher-Yates shuffled
3. Playback wraps to index 0

This prevents the same track from playing twice at the loop boundary.

### Loop One — repeat once, then advance

`queue.js:460-505` — `playNext()` loop-one handling

Loop One uses a two-phase approach:

1. First `playNext()` call: replays the current track, sets `_repeatOnePending = true`, immediately clears the loop icon (`loop = 'none'`)
2. Second `playNext()` call: clears `_repeatOnePending`, advances normally

Manual skip (`skipNext`/`skipPrevious`) during repeat-one reverts to `loop = 'all'`.

## Removing Tracks During Shuffle

`queue.js:316-369` — `remove()`

When a track is removed from a shuffled queue:

1. `_updating = true` prevents backend events from overwriting local state
2. Track is spliced from `items`
3. Track is also removed from `_originalOrder` (so unshuffle doesn't resurrect it)
4. Track is removed from `_playNextTrackIds` if present
5. `currentIndex` is adjusted (decremented if removal was before current)
6. Backend is updated: `queueApi.remove()` then `queueApi.setCurrentIndex()`
7. `_updating` cleared after 50ms

The `_updating` guard is critical — without it, the backend's `queue:updated` event triggers `queue.load()` which overwrites the correctly-adjusted local state with stale backend data.

## Event System Guards

All queue-mutating methods that call backend APIs use the `_updating` flag pattern:

```javascript
this._updating = true;
try {
  // ... local state changes + backend calls ...
} finally {
  setTimeout(() => { this._updating = false; }, 50);
}
```

The event handlers in `events.js` check this flag:

- `handleQueueStateChanged` — skips `currentIndex`/`shuffle`/`loop` overwrites
- `createQueueUpdatedHandler` — skips debounced `queue.load()` call

Methods using this guard: `insert`, `remove`, `playNext`, `skipNext`, `skipPrevious`, `toggleShuffle`, and `queue-builder.js:handleDoubleClickPlay`.

## Key Invariants

These are enforced by property-based and regression tests:

1. **Index bounds** — `currentIndex` is always -1 (empty queue) or within `[0, items.length)`
2. **No duplicates** — `items` never contains duplicate track IDs after any operation
3. **Permutation preservation** — shuffle then unshuffle restores exact original order
4. **Current track identity** — the currently playing track is the same object before and after shuffle/unshuffle
5. **Play Next pinning** — tracks added via Play Next remain at indices `[1, N]` after shuffle toggle
6. **Play Next consumption** — pinned tracks are depinned when they start playing
7. **Remove consistency** — `_originalOrder` and `_playNextTrackIds` stay in sync after removals
8. **Loop boundary** — reshuffle at loop-all boundary never repeats the just-played track at index 0
9. **Play Next move semantics** — queuing a track already in the queue moves it (no duplicates, no silent drops)

## Test Coverage

### Unit tests (Vitest)

`app/frontend/__tests__/queue.store.test.js`

| Section | What it covers |
|---------|---------------|
| Index Bounds Invariants | `currentIndex` stays valid after playIndex, remove, reorder |
| Permutation Preservation | shuffle/unshuffle roundtrip, current track at index 0, no ID loss |
| playNextTracks | insertion order, offset reset, batch insert, background build await, move semantics for duplicates |
| Operation Sequence Invariants | property-based: random operation sequences preserve all invariants |
| Play History Preservation | history push/pop, survives queue rebuild, prev navigation |
| Loop-One (Repeat Once) | two-phase replay, cycleLoop reset, loop-all/none unaffected |
| Remove from shuffled queue | order preservation, index adjustment, playNext correctness, unshuffle consistency |
| Shuffle does not repeat current | playNext advances to different track, no duplicates, full playthrough uniqueness |
| Play Next tracks survive shuffle | pinning during shuffle, multiple pinned tracks, consumption on play, unshuffle restoration |

### E2E tests (Playwright)

`app/frontend/tests/queue.spec.js`

| Section | What it covers |
|---------|---------------|
| Queue Management | add, remove, clear, next/prev navigation |
| Shuffle and Loop Modes | toggle shuffle, shuffle keeps current at index 0, cycle loop, loop-one repeat |
| Queue Reordering | drag handles, drag-and-drop, integrity after reorder |
| Play Next and Add to Queue | append to end, insert after current, multi-select, toast notifications |
| Queue Parity Tests | double-click populates full library, sequential advance |
| Shuffle Navigation History | prev traverses history, all-tracks-once, loop-all reshuffle |
| Now Playing View | display order, shuffle updates view, highlight current, empty state |
| Loop Mode Tests | cycle order, session-only persistence, manual skip during repeat-one |

## File References

| File | Lines | Purpose |
|------|-------|---------|
| `app/frontend/js/stores/queue.js` | 605-640 | `toggleShuffle()` |
| `app/frontend/js/stores/queue.js` | 642-675 | `_shuffleItems()` |
| `app/frontend/js/stores/queue.js` | 677-698 | `_reshuffleForLoopRestart()` |
| `app/frontend/js/stores/queue.js` | 281-332 | `playNextTracks()` |
| `app/frontend/js/stores/queue.js` | 316-369 | `remove()` |
| `app/frontend/js/stores/queue.js` | 460-505 | `playNext()` loop handling |
| `app/frontend/js/stores/queue.js` | 700-712 | `_validateQueueIntegrity()` |
| `app/frontend/js/events.js` | 114-156 | Queue event handlers |
| `app/frontend/js/utils/queue-builder.js` | 16-102 | Double-click queue build |
| `app/frontend/__tests__/queue.store.test.js` | — | Unit/property tests |
| `app/frontend/tests/queue.spec.js` | — | E2E tests |
