---
id: task-279
title: Fix slow batch metadata editing (N serial IPC roundtrips)
status: Done
assignee: []
created_date: '2026-02-20 19:29'
updated_date: '2026-02-20 19:29'
labels:
  - performance
  - metadata
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Batch metadata loading and saving in the metadata editor are slow for large selections because they use sequential IPC calls (N serial roundtrips for loading, 2N for saving).

**Root causes:**
1. `loadBatchMetadata()` calls `get_track_metadata` sequentially in a for loop — N serial IPC roundtrips
2. `saveCurrentEdits()` calls `save_track_metadata` sequentially, then `rescanTrack` sequentially — 2N serial IPC roundtrips

**Fix:**
1. Add `get_tracks_metadata_batch` Rust command using rayon for parallel file I/O
2. Replace sequential `loadBatchMetadata()` with single batch IPC call
3. Replace sequential saves/rescans with `Promise.all()` for parallel execution
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Backend: New `get_tracks_metadata_batch` Tauri command accepts Vec<String> paths and returns Vec<TrackMetadata> using rayon parallel I/O
- [x] #2 Frontend: `loadBatchMetadata()` makes a single IPC call to batch command instead of N sequential calls
- [x] #3 Frontend: `saveCurrentEdits()` uses `Promise.all()` for parallel saves and parallel rescans
- [x] #4 Rust unit tests pass for batch command (empty paths, missing files)
- [x] #5 Vitest unit tests pass for batch loading and parallel save logic
<!-- AC:END -->
