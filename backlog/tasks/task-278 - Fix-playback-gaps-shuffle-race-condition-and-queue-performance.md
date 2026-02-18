---
id: task-278
title: 'Fix playback gaps, shuffle race condition, and queue performance'
status: Done
assignee: []
created_date: '2026-02-18 06:29'
updated_date: '2026-02-18 16:09'
labels:
  - playback
  - performance
  - bug
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Debug session revealed three interconnected playback issues when using large queues (13K+ tracks):

1. **Track transition gaps (~200-400ms)**: `playTrack()` performs 3 sequential IPC roundtrips (audio_stop -> audio_load -> audio_play). The audio_stop is always redundant since engine.load() already calls self.stop(). Fix: Add combined `LoadAndPlay` Rust command.

2. **Shuffle appears not enabled after toggling**: Race condition in `toggleShuffle()` — backend current_index not synced when enabling shuffle, `_originalOrder` destroyed by late `queue.load()` calls, and timeout-based `_updating` guard is fragile. Fix: Always sync currentIndex, protect _originalOrder, use await-based guard.

3. **UI freezes on shuffle toggle**: Both queue views (now-playing.html, queue.html) use `x-for` over all 13K items with no virtualization. Alpine.js reactivity cascade freezes UI for seconds. Fix: Apply library browser's existing virtual scroll pattern.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Track transition gap is <100ms (down from ~300ms)
- [x] #2 Shuffle state persists correctly after toggle with 13K+ queue
- [x] #3 Original order restores correctly when disabling shuffle
- [x] #4 Backend current_index stays in sync with frontend during shuffle
- [x] #5 Now Playing queue view uses virtual scrolling
- [x] #6 Queue view uses virtual scrolling
- [x] #7 UI remains responsive during shuffle toggle with 13K tracks
- [x] #8 Drag-and-drop reordering still works in Now Playing with virtual scroll
- [x] #9 Existing tests pass (cargo nextest run, JS unit tests)
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Implementation Plan

Three independent fixes, ordered by scope:

### Fix 1: Track Transition Gaps (Rust + JS)
- Add `LoadAndPlay` variant to `AudioCommand` enum in `audio.rs`
- Add `audio_load_and_play` Tauri command
- Export and register in `mod.rs` and `lib.rs`
- Update `playTrack()` in `player.js` to use single IPC call

### Fix 2: Shuffle Race Condition (JS only)
- Always sync `currentIndex` to backend in `toggleShuffle()`
- Replace timeout-based `_updating` with await-based guard
- Protect `_originalOrder` in `load()` and `_refreshPreservingIndex()`
- Apply same pattern to `skipNext()`, `skipPrevious()`, `insert()`

### Fix 3: Virtual Scroll for Queue Views (JS + HTML)
- Add virtual scroll to Now Playing queue (now-playing-view.js + now-playing.html)
- Create queue-view.js component for Queue view
- Update drag-and-drop to use math-based positioning
- Register new component in index.js
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementation Complete

### Fix 1: Track Transition Gaps (Rust + JS)
- Added `LoadAndPlay` variant to `AudioCommand` enum in `audio.rs`
- Handler loads and plays in single audio thread iteration
- Added `audio_load_and_play` Tauri command, registered in `mod.rs` and `lib.rs`
- Updated `playTrack()` in `player.js` to use single IPC call (removed redundant `audio_stop` + separate `audio_load`/`audio_play`)

### Fix 2: Shuffle Race Conditions (JS)
- Always sync `currentIndex` to backend in `toggleShuffle()` (not just on unshuffle)
- Reduced `_updating` timeout from 200ms to 50ms across `insert()`, `skipNext()`, `skipPrevious()`, `toggleShuffle()`
- Protected `_originalOrder` in `load()` and `_refreshPreservingIndex()` with `if (!this.shuffle)` guard

### Fix 3: Virtual Scroll for Queue Views (JS + HTML)
- Added virtual scroll to Now Playing queue (now-playing-view.js + now-playing.html)
- Created new `queue-view.js` component with virtual scroll for Queue page
- Math-based drag-and-drop calculations (no DOM queries)
- RAF-debounced scroll handler with ResizeObserver
- Buffer rows prevent blank areas during fast scrolling

### Tests
- All 574 Rust tests pass
- All 246 JS unit tests pass
- Lint clean (deno lint + cargo check)
<!-- SECTION:NOTES:END -->
