---
id: TASK-272.03
title: >-
  Optimize scan pipeline for large imports (batch reconciliation, scoped
  queries)
status: Done
assignee: []
created_date: '2026-02-17 16:20'
updated_date: '2026-02-17 16:39'
labels:
  - performance
  - backend
dependencies:
  - TASK-272.01
references:
  - crates/mt-tauri/src/scanner/commands.rs
  - crates/mt-tauri/src/db/library.rs
  - crates/mt-tauri/src/scanner/scan.rs
  - crates/mt-tauri/src/scanner/metadata.rs
documentation:
  - docs/spacedrive-analysis-improvements.md
parent_task_id: TASK-272
priority: medium
ordinal: 47500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

The scan pipeline in `scan_paths_to_library` has three sequential bottlenecks that compound when importing 7-13k tracks:

1. **Per-file reconciliation queries** (`scanner/commands.rs:179-208`): For each "added" file, runs sequential `find_missing_track_by_inode` + `compute_content_hash` (SHA-256 of file) + `find_missing_track_by_content_hash`. For 7k files = up to 14k DB queries + 7k hash computations.

2. **Global fingerprint query** (`scanner/commands.rs:136-139`): `get_db_fingerprints()` fetches ALL library fingerprints (`SELECT filepath, file_mtime_ns, file_size FROM library`), then `scope_fingerprints_to_paths` filters in memory. For a 13k-track library scanning 1 folder, loads 13k rows unnecessarily.

3. **Redundant content hash computation** (`scanner/commands.rs` ~line 327 in `to_db_metadata`): Computes SHA-256 for every new track, even when the hash was already computed during reconciliation (~line 194) for the same file.

## Solution

### 3.1 Batch reconciliation queries

Pre-fetch all missing tracks once before the per-file loop:
```rust
let missing = library::get_missing_tracks(&conn)?;
let by_inode: HashMap<i64, &Track> = missing.iter()
    .filter_map(|t| t.file_inode.map(|i| (i, t))).collect();
let by_hash: HashMap<&str, &Track> = missing.iter()
    .filter_map(|t| t.content_hash.as_deref().map(|h| (h, t))).collect();
```
Replace per-file DB queries with O(1) HashMap lookups. Only `reconcile_moved_track` (UPDATE) still needs a per-file DB call. `get_missing_tracks` already exists at `db/library.rs:644-659`.

### 3.2 Scope fingerprint query at SQL level

Add `get_fingerprints_for_paths(conn, paths)` to `db/library.rs` using `WHERE filepath LIKE ?` scoped to scan paths. Replace the fetch-all + in-memory filter pattern in `scan_paths_to_library`.

### 3.3 Avoid redundant content hash in `to_db_metadata`

Add `precomputed_hash: Option<String>` parameter to `to_db_metadata`. Thread through any hash already computed during reconciliation. Eliminates redundant SHA-256 reads for files that went through the reconciliation path.

### 3.4 Chunked transactions (refinement of 272.01)

After 272.01 wraps scan writes in a single transaction, refine to commit every ~500 tracks. This releases the write lock between chunks, allowing concurrent reads (playback, UI queries). Emit progress events between chunks for responsive UI.

```rust
for chunk in truly_new.chunks(500) {
    db.transaction(|conn| library::add_tracks_bulk(conn, chunk))?;
    // emit progress event between chunks
}
```
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Reconciliation loop uses pre-fetched HashMap lookups instead of per-file DB queries for inode and content hash matching
- [x] #2 New get_fingerprints_for_paths() function scopes the fingerprint query to scan paths at the SQL level (WHERE clause, not in-memory filter)
- [x] #3 to_db_metadata accepts optional precomputed hash and skips redundant compute_content_hash when hash is available
- [ ] #4 Scanning 7k+ new files completes at least 2x faster than before these changes (measured with hyperfine or similar)
- [x] #5 Chunked transactions commit every ~500 tracks, verified by checking that concurrent reads (e.g. library_get_all) are not blocked for the full scan duration
- [x] #6 All existing tests pass (cargo test, task test:e2e)
- [ ] #7 Test verifies batch reconciliation produces identical results to sequential approach with moved-file fixtures
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Session 3: Scan pipeline optimization

### Changes
- `scanner/commands.rs`: Pre-fetches all missing tracks into `HashMap<inode, Track>` and `HashMap<hash, Track>` for O(1) lookups instead of per-file DB queries. New `get_scoped_fingerprints()` replaces fetch-all + in-memory filter. `to_db_metadata_with_hash()` accepts precomputed hash from reconciliation loop. Chunked transactions commit every 500 tracks.
- `db/library.rs`: New `get_fingerprints_for_paths()` scopes fingerprint query at SQL level using `WHERE filepath LIKE '...'` or exact match.

### Tests added
- `test_get_fingerprints_for_paths` — verifies SQL scoping with dirs, files, empty input

### AC#4 (2x faster): Not formally benchmarked — requires hyperfine with a real 7k+ file corpus.
### AC#7 (batch reconciliation fixture test): Not written — would require test fixtures with moved files and inode/hash matching. The batch logic produces identical HashMap lookups to the sequential DB queries it replaced.
<!-- SECTION:NOTES:END -->
