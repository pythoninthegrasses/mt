---
id: TASK-337
title: >-
  Fix 3-5s playback delay after enqueueing track (regression from task-332
  _loadAllPages await)
status: Done
assignee: []
created_date: '2026-04-29 15:14'
updated_date: '2026-04-29 15:54'
labels:
  - bug
  - queue
  - playback
  - performance
  - frontend
  - backend
dependencies:
  - TASK-332
references:
  - app/frontend/js/components/library-browser.js
  - app/frontend/js/stores/library.js
  - app/frontend/js/utils/queue-builder.js
  - crates/mt-tauri/src/commands/queue.rs
  - crates/mt-tauri/src/commands/audio.rs
  - crates/mt-tauri/src/library/commands.rs
  - >-
    backlog/tasks/task-332 -
    Queue-broken-double-click-doesnt-enqueue-full-library-track-ended-doesnt-auto-advance.md
priority: high
ordinal: 2750
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

Double-clicking a track in the main library view blocks playback start for 3–5s.
Logs show 19 paginated `library_get_all` round-trips (offsets 500 → 9500,
500 tracks/page, spanning ~5.4s) completing **before** the audio engine starts.

```
15:08:27.782  library_get_all  offset=500   duration_ms=77
…
15:08:33.120  library_get_all  offset=9500  duration_ms=92
15:08:33.441  INFO Lazily initializing audio engine on first use
15:08:33.616  INFO Track loaded … Playback started
```

## Root Cause

The fix shipped in task-332 (commit `409b170`) added this to `handleDoubleClick`
(`library-browser.js:456-458`):

```js
if (this.library._isPaginated() && !this.library._allPagesLoaded) {
  await this.library._loadAllPages();   // blocks playback for ~5s on 9k-track library
}
```

`_loadAllPages()` (`library.js:267-282`) iterates all unloaded pages in batches
of 4 concurrent `library_get_all` calls. With 9645 tracks at page size 500 that
is 20 pages = 5 sequential batches. Only after the last batch resolves does
`handleDoubleClickPlay` → `queue.playContext` → audio init run.

The fix was correct for task-332's bug ("only the clicked track plays") but moved
the full pagination cost onto the play critical path.

## What's NOT the bottleneck

Audio engine lazy init (`commands/audio.rs:156-233`) takes ~175ms. It is not the
problem — it only appears late because it is the first thing that runs *after*
pagination finishes.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Double-clicking a track starts playback within ≤500 ms on a 9k-track library (cold start), from click to audio://playback-state-changed → Playing
- [x] #2 Full library is still enqueued as context after playback starts (no regression of task-332 — queue length equals total_tracks from library_get_section)
- [x] #3 Shuffle still produces a queue ordering covering the entire library, not only loaded pages
- [x] #4 No library_get_all calls fire on the play hot path (verify with existing INFO logs)
- [x] #5 Vitest coverage for queue-builder.js and Rust unit tests for any new backend command, mirroring task-332 test additions
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
The frontend should not need to materialize all 9k+ track IDs before starting
playback. Two approaches:

### Option 1 — Server-side play-context query (recommended)

Add a new `queue_play_context_query` Tauri command that accepts the same
filter/sort parameters used to populate the current library view (section,
search, artist, album, sort_by, sort_order, ignore_words) plus the start
`track_id`. The backend re-runs the existing `library_get_all` SQL query once,
gets the full ID list in a single round-trip, and pipes it into the existing
`queue::play_context` function (`commands/queue.rs:643`).

- Mirrors the pattern set by `library_get_section` (commit `d42139e`).
- Frontend passes filter state it already holds; no new store state needed.
- Eliminates all 19 `library_get_all` IPC calls from the play hot path.
- `handleDoubleClick` removes the `_loadAllPages` await entirely.
- `queue-builder.js:handleDoubleClickPlay` needs a new code path (or an
  overload) that passes query params instead of `trackIds`.

### Option 2 — Optimistic immediate play, background context fill

Immediately invoke `audio_load_and_play` for the clicked track, then fill the
queue context as `_loadAllPages()` resolves in the background. Trickier:
mid-flight queue mutations must coexist with shuffle and the user pressing Next
before loading completes.

### Suggested approach

Implement option 1. Keep `_loadAllPages()` available for "Add All to Queue"
(`library.js:628`) — that flow tolerates a wait because no audio is blocked.

### Key files

| File | Relevance |
|------|-----------|
| `library-browser.js:453-467` | Remove or gate the `_loadAllPages` await |
| `library.js:267-282` | `_loadAllPages` — keep for non-play paths |
| `queue-builder.js:16-44` | `handleDoubleClickPlay` — add query-param variant |
| `commands/queue.rs:630-667` | `queue_play_context` — basis for new command |
| `library/commands.rs` | `library_get_all` query to reuse in new command |
<!-- SECTION:NOTES:END -->
