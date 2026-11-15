---
id: TASK-391
title: Artwork lookups recover without an app restart when offline storage returns
status: To Do
assignee: []
created_date: '2026-11-14T06:31:00Z'
updated_date: '2026-11-15T05:40:00Z'
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
Bugfix allowed during TASK-393 feature freeze. Unavailable local/network/Plex storage can produce negative artwork-cache entries that keep showing placeholders after storage returns. Correct recovery without repeatedly probing genuine no-artwork files. Fix the current owner narrowly if urgent; TASK-393.29 later owns the shared Zig artwork resolver/cache and must preserve these cases. Do not implement a parallel cache or port unrelated scanner/session policy just to fix this bug. Both playback/library and charts must consume the same corrected policy. Current source references may predate mt-core extraction; locate the active owner before editing.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 After a file that was unreadable becomes readable, artwork for that track is served without restarting the app
- [ ] #2 Repeated artwork requests for a track that genuinely has no artwork do not re-open and probe the file on every request
- [ ] #3 Negative entries expire by a bounded lifetime or are invalidated by library change or folder-availability events, and the chosen policy is documented at the cache
- [ ] #4 Explicit invalidation on metadata update clears positive and negative entries alike
- [ ] #5 Tests in the current policy owner's language cover miss then file appears then hit, bounded repeated misses and positive hits; keep Rust primitive tests where relevant
- [ ] #6 The library artwork command and the chart grid both use the corrected cache with no duplicated cache logic
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-11-14 migration scheduling: remains available as a bugfix; does not depend on the feature-freeze gate. If implemented during TASK-393.29, verify and close both tasks with evidence instead of duplicating fixes.
<!-- SECTION:NOTES:END -->
