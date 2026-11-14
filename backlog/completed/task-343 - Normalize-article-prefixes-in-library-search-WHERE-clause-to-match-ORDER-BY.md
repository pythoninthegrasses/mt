---
id: TASK-343
title: Normalize article prefixes in library search WHERE clause to match ORDER BY
status: Done
assignee: []
created_date: '2026-05-24 16:07'
updated_date: '2026-11-14T05:36:00Z'
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
ordinal: 750
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Backend search uses raw LIKE substring matching (db/library.rs:82-88) while sort uses the strip_sort_prefix SQLite function (lines 156, 160, 187, 191). The two are asymmetric: typing "rolling stones" into the sidebar Search input misses "The Rolling Stones" because the WHERE clause matches against the raw artist column, not the stripped form. The sort function already exists — the fix is to apply the same normalization in the search predicate.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Typing an artist name without the leading article (e.g. "rolling stones") returns results for "The Rolling Stones"
- [x] #2 Typing the full article-included form (e.g. "the rolling stones") still returns results
- [x] #3 The same normalization applies to both the `search` (full-text) and `artist` filter LIKE clauses
- [ ] #4 No performance regression on `library_get_section` for large libraries (≥20k tracks)
- [x] #5 Existing search tests pass; new tests cover the article-stripped search case
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-11-14 (backlog tidy): closed after verifying the tree. Article-insensitive matching ships as the persisted artist_sort_key path: db/library.rs:303-306 filters on artist_sort_key >= ? AND artist_sort_key LIKE ? ESCAPE '\', and the column is built once as LOWER(TRIM(strip_sort_prefix(...))) with INSERT/UPDATE triggers (db/schema.rs, db/mod.rs), so the search and artist LIKE clauses both read the normalised form (AC#3). AC#5: 22 tests in db/sort_key_test.rs, including test_ignore_words_semantics_match_the_legacy_path and test_indexed_prefix_lookup_offsets_match_sample_library. AC#4 left UNCHECKED: no before/after library_get_section measurement at >=20k tracks is recorded on this task; the indexed path is strictly cheaper than the legacy ROW_NUMBER() path (p95 6.07ms vs 141.4ms at 40k rows, per TASK-350.2), but that is not the measurement this AC asked for. Superseded in practice by TASK-350.2, which shipped the persisted column.
<!-- SECTION:NOTES:END -->
