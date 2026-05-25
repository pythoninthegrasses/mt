---
id: TASK-350.2
title: 'Phase 2: Persisted artist_sort_key + indexed prefix lookup'
status: To Do
assignee: []
created_date: '2026-05-25 20:00'
labels:
  - performance
  - library
  - type-to-jump
  - backend
  - database
dependencies:
  - TASK-350.1
parent_task_id: TASK-350
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Replace the `ROW_NUMBER() OVER (ORDER BY ...)` prefix lookup in `crates/mt-tauri/src/db/library.rs:232-296` with an indexed seek on a persisted normalized sort key. Ships behind feature flag `indexed_prefix_lookup`.

Locked decision: persist the normalized key in the DB (do not compute per query).

Scope:
- Schema migration: add `artist_sort_key TEXT` column to the library table.
- Backfill on migration using existing `strip_sort_prefix` logic from `crates/mt-tauri/src/db/models.rs:380`.
- Keep `artist_sort_key` updated on insert/update/scan/rescan paths.
- Add covering index on `(artist_sort_key, id)` for stable tie-break ordering.
- Rewrite `find_sort_offset` to seek by `artist_sort_key >= prefix` (and `< prefix_upper`) using the new index, eliminating the window function.
- Preserve album_artist behavior and ignore-words handling.
- Keep the old path behind the feature flag for fast rollback.

Files:
- `crates/mt-tauri/src/db/schema.rs` (migration + index)
- `crates/mt-tauri/src/db/library.rs` (find_sort_offset rewrite, insert/update paths)
- `crates/mt-tauri/src/db/models.rs` (sort-key derivation reuse)
- `crates/mt-tauri/src/library/commands.rs:435-472` (wire feature flag)

Out of scope:
- Pagination model changes (Phase 3).
- Frontend jump UX changes (Phase 1).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Failing Rust test first: indexed prefix lookup returns correct offset for known sample library
- [ ] #2 Migration adds artist_sort_key column and backfills existing rows without data loss
- [ ] #3 Insert/update/scan/rescan paths populate artist_sort_key correctly
- [ ] #4 Covering index (artist_sort_key, id) exists and is used by the new query (EXPLAIN QUERY PLAN assertion)
- [ ] #5 find_sort_offset no longer uses ROW_NUMBER() when indexed_prefix_lookup flag is enabled
- [ ] #6 Ignore-words and album_artist behavior match previous semantics (regression tests)
- [ ] #7 Perf harness: prefix lookup p95 < 100ms on 40k synthetic library
- [ ] #8 Feature flag indexed_prefix_lookup can disable the new path and restore the old ROW_NUMBER query
- [ ] #9 Phase 1 (TASK-350.1) is complete
<!-- AC:END -->
