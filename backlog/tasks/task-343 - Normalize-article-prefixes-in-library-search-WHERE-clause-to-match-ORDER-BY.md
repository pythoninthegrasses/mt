---
id: TASK-343
title: Normalize article prefixes in library search WHERE clause to match ORDER BY
status: To Do
assignee: []
created_date: '2026-05-24 16:07'
labels:
  - backend
  - search
  - library
dependencies: []
references:
  - 'crates/mt-tauri/src/db/library.rs:82-88'
  - 'crates/mt-tauri/src/db/library.rs:156'
  - 'crates/mt-tauri/src/db/library.rs:160'
  - 'crates/mt-tauri/src/db/library.rs:187'
  - 'crates/mt-tauri/src/db/library.rs:191'
  - 'crates/mt-tauri/src/db/library.rs:245-271'
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Backend search uses raw LIKE substring matching (db/library.rs:82-88) while sort uses the strip_sort_prefix SQLite function (lines 156, 160, 187, 191). The two are asymmetric: typing "rolling stones" into the sidebar Search input misses "The Rolling Stones" because the WHERE clause matches against the raw artist column, not the stripped form. The sort function already exists — the fix is to apply the same normalization in the search predicate.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Typing an artist name without the leading article (e.g. "rolling stones") returns results for "The Rolling Stones"
- [ ] #2 Typing the full article-included form (e.g. "the rolling stones") still returns results
- [ ] #3 The same normalization applies to both the `search` (full-text) and `artist` filter LIKE clauses
- [ ] #4 No performance regression on `library_get_section` for large libraries (≥20k tracks)
- [ ] #5 Existing search tests pass; new tests cover the article-stripped search case
<!-- AC:END -->
