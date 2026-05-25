---
id: TASK-347
title: >-
  Add indexed artist sort key to eliminate full-scan cost in find_sort_offset
  and library_get_all
status: In Progress
assignee: []
created_date: '2026-05-24 20:10'
updated_date: '2026-05-25 03:35'
labels:
  - backend
  - performance
  - database
  - library
dependencies: []
references:
  - 'crates/mt-tauri/src/db/library.rs:133-177'
  - 'crates/mt-tauri/src/db/library.rs:236-293'
  - 'crates/mt-tauri/src/db/models.rs:320'
  - crates/mt-tauri/src/db/schema.rs
priority: low
ordinal: 375
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Every library_get_all (artist sort) and find_sort_offset call does a full-table sort across all tracks because the sort expression strip_sort_prefix(COALESCE(NULLIF(album_artist,''),artist)) COLLATE NOCASE is function-wrapped and cannot use any existing B-tree index. On a 39k-track library this means ~40k Rust UDF callbacks + an O(N log N) temp B-tree sort per request.

find_sort_offset (the prefix-jump bottleneck) also runs ROW_NUMBER() OVER (ORDER BY ...) across all rows regardless of how much data the caller's page size requests. Increasing page size has no effect on this cost.

Design options:
1. Add a generated/stored column artist_sort_key populated at write time with LOWER(strip_sort_prefix(COALESCE(NULLIF(album_artist,''),artist), DEFAULT_IGNORE_WORDS)). Index it. Requires constant ignore-word list baked in at migration time (cannot use user-configurable words). Alternative: store the raw COALESCE value, apply ignore-word stripping only for the ORDER BY expression, and rely on a partial expression index.
2. Keyset / cursor-based pagination using WHERE artist_sort_key > :cursor ORDER BY artist_sort_key instead of LIMIT/OFFSET. Eliminates the skip cost for deep pages.
3. SQLite expression index: CREATE INDEX library_artist_sort ON library(LOWER(COALESCE(NULLIF(album_artist,''),artist))) — no UDF involved, requires changing the sort expression to match exactly.

Option 3 is most practical: drop strip_sort_prefix from the index and apply it only at query time via OR matching (the ignore-word normalization is a UX enhancement, not a sort correctness requirement). The index covers the primary sort; ignore-word handling degrades gracefully without it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 library_get_all artist-sort queries do not perform a full filesort on libraries >= 10k tracks (verify via EXPLAIN QUERY PLAN)
- [ ] #2 find_sort_offset resolves in < 50ms on 40k-track library
- [ ] #3 Existing sort order and type-to-jump correctness unchanged
<!-- AC:END -->
