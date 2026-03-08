---
id: TASK-292
title: Fix watcher error path dropping new tracks instead of proceeding unfiltered
status: To Do
assignee: []
created_date: '2026-02-26 00:10'
updated_date: '2026-03-08 02:02'
labels:
  - bug
  - roborev
dependencies: []
references:
  - crates/mt-tauri/src/watcher.rs
  - crates/mt-tauri/src/db/removed.rs
  - 'roborev job #29'
priority: high
ordinal: 47500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Roborev review job #29 (commit 1a70d1a) found issues in the watcher's removed-tracks filtering error handling.

**High severity**: When `filter_removed_tracks` fails, the inner error path returns `vec![]` — dropping all new tracks instead of proceeding unfiltered as documented. The comment says "fall back to unfiltered insertion so new tracks aren't lost" but the code does the opposite. This is a regression from the pre-refactor behavior where `truly_new` was returned on query errors.

Root cause: `filter_removed_tracks` takes ownership of the vec, so it's unavailable on error.

**Low severity**: The error log message says "proceeding unfiltered" but the code returns an empty vec. The message should match actual behavior.

### Fix options (from review)

1. Change `filter_removed_tracks` signature to return the original vec inside the error (e.g., `Result<(Vec<T>, usize), (DbError, Vec<T>)>`). Cleanest — no clone on happy path.
2. Clone before calling: `let fallback = truly_new.clone();` and return `fallback` on error. Simple but wastes allocation on happy path.
3. Have `filter_removed_tracks` take `&[T]` and return a new vec rather than consuming the input.

### Source

- roborev job #29, verdict: FAIL
- File: `crates/mt-tauri/src/watcher.rs` ~line 638
- File: `crates/mt-tauri/src/db/removed.rs` (`filter_removed_tracks` signature)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 When filter_removed_tracks fails, watcher falls back to unfiltered insertion (returns all new tracks, not empty vec)
- [ ] #2 Error log message accurately describes actual behavior
- [ ] #3 Existing tests continue to pass
- [ ] #4 No unnecessary clone on the happy path (prefer option 1 or 3)
<!-- AC:END -->
