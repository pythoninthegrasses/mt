---
id: TASK-391
title: Artwork lookups recover without an app restart when offline storage returns
status: To Do
assignee: []
created_date: '2026-11-14T06:31:00Z'
labels:
  - artwork
  - cache
  - backend
  - library
dependencies: []
references:
  - >-
    backlog/tasks/task-369.2 -
    Trim-or-replace-heavyweight-dependencies-behind-narrow-feature-use-chart-grid-image-stack.md
modified_files:
  - crates/mt-tauri/src/scanner/artwork_cache.rs
  - crates/mt-tauri/src/scanner/artwork.rs
  - crates/mt-tauri/src/library/commands.rs
  - crates/mt-tauri/src/commands/stats.rs
priority: medium
type: bug
ordinal: 75500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Artwork is read from the audio file at request time and memoised in a 100-entry LRU that stores the Option including the None results. While the local music volume was unmounted and the Plex host unreachable, every lookup returned None, so the running app pinned placeholder results for every track it had already probed and kept showing them after the storage came back until the process was restarted. A negative result must not outlive the condition that produced it. The same cache backs the library artwork command used by Now Playing and the chart grid, so one fix covers both surfaces. A related task reworks the chart grid's artist ranking and is independent of this one.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 After a file that was unreadable becomes readable, artwork for that track is served without restarting the app
- [ ] #2 Repeated artwork requests for a track that genuinely has no artwork do not re-open and probe the file on every request
- [ ] #3 Negative entries expire by a bounded lifetime or are invalidated by library change or folder-availability events, and the chosen policy is documented at the cache
- [ ] #4 Explicit invalidation on metadata update clears positive and negative entries alike
- [ ] #5 Rust tests cover: miss then file appears then hit; repeated misses staying bounded; and positive entries still being served from cache
- [ ] #6 The library artwork command and the chart grid both use the corrected cache with no duplicated cache logic
<!-- AC:END -->
