---
id: TASK-350.2
title: 'Phase 2: Persisted artist_sort_key + indexed prefix lookup'
status: Done
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
- [x] #1 Failing Rust test first: indexed prefix lookup returns correct offset for known sample library
- [x] #2 Migration adds artist_sort_key column and backfills existing rows without data loss
- [x] #3 Insert/update/scan/rescan paths populate artist_sort_key correctly
- [x] #4 Covering index (artist_sort_key, id) exists and is used by the new query (EXPLAIN QUERY PLAN assertion)
- [x] #5 find_sort_offset no longer uses ROW_NUMBER() when indexed_prefix_lookup flag is enabled
- [x] #6 Ignore-words and album_artist behavior match previous semantics (regression tests)
- [x] #7 Perf harness: prefix lookup p95 < 100ms on 40k synthetic library
- [x] #8 Feature flag indexed_prefix_lookup can disable the new path and restore the old ROW_NUMBER query
- [x] #9 Phase 1 (TASK-350.1) is complete
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
- `artist_sort_key` is derived once via `LOWER(TRIM(strip_sort_prefix(COALESCE(NULLIF(LOWER(TRIM(album_artist)), ''), NULLIF(LOWER(TRIM(artist)), '')), <ignore-words>)))`, persisted by the migration backfill and kept current by `AFTER INSERT`/`AFTER UPDATE OF artist, album_artist` triggers (no changes needed to `add_track`/`add_tracks_bulk`/`update_tracks_bulk`/`update_track_metadata` — they already write plain artist/album_artist columns and the triggers do the rest).
- The indexed path is keyed to the single ignore-words list the persisted column was built with (`ARTIST_SORT_KEY_IGNORE_WORDS` in `schema.rs`). A query with a different ignore-words list, or one whose typed prefix is itself a prefix of one of those ignore words (e.g. "the" against the default list), falls back to the legacy `ROW_NUMBER()` path — the persisted key has no representation for those cases, and this is a deliberate, tested divergence guard rather than an oversight.
- Feature flag `indexed_prefix_lookup` is read fresh on every lookup (env var `MT_INDEXED_PREFIX_LOOKUP`, or `settings` key `feature.indexed_prefix_lookup`) rather than cached — this is a point lookup, not a hot loop, and caching it was tried and reverted after it caused a genuine bug: the settings-driven half of the flag would never re-take-effect at runtime without an app restart once a cache went warm.
- Perf harness (40k rows, release build): indexed p95 = 6.07ms vs legacy p95 = 141.4ms (budget: p95 < 100ms). Run via `cargo test --release -p mt-tauri sort_key -- --ignored --nocapture`.
<!-- SECTION:NOTES:END -->
