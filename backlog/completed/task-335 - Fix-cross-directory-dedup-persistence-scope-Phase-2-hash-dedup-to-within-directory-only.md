---
id: TASK-335
title: >-
  Fix cross-directory dedup persistence: scope Phase 2 hash dedup to
  within-directory only
status: Done
assignee: []
created_date: '2026-04-15 04:46'
updated_date: '2026-04-15 06:23'
labels:
  - bug
  - dedup
  - backend
dependencies: []
references:
  - crates/mt-tauri/src/library/commands.rs
  - crates/mt-tauri/src/db/library.rs
  - crates/mt-tauri/src/db/dedup.rs
  - crates/mt-tauri/src/watcher.rs
  - crates/mt-tauri/src/scanner/commands.rs
  - crates/mt-tauri/src/db/dedup_scope_test.rs
priority: high
ordinal: 3500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Cross-directory deduplication is not persistent across app restarts. When the app reopens, duplicates reappear because `deduplicated_tracks` table has 0 rows.

**Root cause**: In `run_backfill_and_dedup()`, Phase 2 (`find_duplicates_by_content_hash()`) merges duplicates globally across ALL directories before Phase 3 (cross-directory dedup with suppression tracking) runs. Phase 3 then finds nothing to suppress, so no rows are written to `deduplicated_tracks`. On next scan/restart, the scanner re-adds the "other copy" from disk since there's no suppression record.

**Fix**: Scope Phase 2 hash dedup to within-directory only, so cross-directory duplicate groups are exclusively handled by Phase 3 which writes suppression rows to `deduplicated_tracks`.

**Approach**: Filter out cross-directory groups at the Phase 2 call site in `run_backfill_and_dedup()` (around line 968-987). Move the watched folder path fetch earlier so Phase 2 can determine which groups are within-directory vs cross-directory.

**DB evidence**: `library` has 13,043 rows, `deduplicated_tracks` has 0 rows, 3,275 tracks have `content_hash IS NULL` (matching the "3275 Duplicates Merged" count).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Phase 2 hash dedup only merges tracks within the same watched directory
- [x] #2 Cross-directory duplicates are handled exclusively by Phase 3 (suppression tracking)
- [x] #3 deduplicated_tracks table has >0 rows after reconcile scan with cross-directory duplicates
- [x] #4 Duplicates remain suppressed after app restart
- [x] #5 Regression test: cross-directory duplicates produce suppression rows
- [x] #6 Existing within-directory dedup behavior is unchanged
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementation

### New function: `filter_within_directory_groups()` (db/library.rs:1158-1198)
Filters duplicate groups to only include groups where all tracks are within the same watched directory. Cross-directory groups are excluded so Phase 3 handles them (writing suppression rows). With 0 or 1 watched folders, all groups pass through.

### Pipeline change: `run_backfill_and_dedup()` (library/commands.rs)
1. Moved watched folder path fetch from Phase 3b to before Phase 2
2. After `find_duplicates_by_content_hash()`, filter through `filter_within_directory_groups()` before merging
3. Phase 3b reuses the already-fetched `folder_paths`

### Pre-existing fix
Fixed missing `total_size` field in `LibrarySectionResponse` test (library/commands.rs:1726).

### Test coverage: 10 new tests (db/dedup_scope_test.rs)
- 6 unit tests for `filter_within_directory_groups()` (same-dir, cross-dir, mixed, no folders, single folder, trailing slash)
- 4 integration tests simulating the full pipeline (cross-dir not merged by hash dedup, within-dir still merged, suppression rows written, 3-directory scenario)

## Part 2: Watcher/Scanner suppression filter

### Problem
Even after Part 1 fix writes suppression rows to `deduplicated_tracks`, the watcher rescan (`trigger_rescan` in `watcher.rs`) and initial scan (`scan_paths_to_library` in `scanner/commands.rs`) re-add suppressed files on app restart. Both filter for previously-removed tracks via `removed::filter_removed_tracks()` but do NOT filter for suppressed tracks.

### Fix
1. Added `get_suppressed_filepaths()` and `filter_suppressed_tracks()` to `db/dedup.rs` — follows same pattern as `removed::filter_removed_tracks()`
2. Added suppression filter to `watcher.rs` `trigger_rescan()` — after removed filter, before bulk insert
3. Added suppression filter to `scanner/commands.rs` `scan_paths_to_library()` — after removed filter, before chunked bulk insert
4. Added `dedup` import to both `watcher.rs` and `scanner/commands.rs`
5. 3 unit tests for `filter_suppressed_tracks()` in `db/dedup.rs`

### Verification
- All 797 Rust tests pass
- cargo clippy clean
- cargo fmt clean
<!-- SECTION:NOTES:END -->
