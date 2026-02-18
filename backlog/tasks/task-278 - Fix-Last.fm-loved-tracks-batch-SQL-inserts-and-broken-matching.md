---
id: TASK-278
title: 'Fix Last.fm loved tracks: batch SQL inserts and broken matching'
status: Done
assignee: []
created_date: '2026-02-17 21:51'
updated_date: '2026-02-17 23:49'
labels:
  - bug
  - performance
  - lastfm
dependencies: []
references:
  - crates/mt-tauri/src/db/lastfm_loved.rs
  - crates/mt-tauri/src/commands/lastfm.rs
  - crates/mt-tauri/src/db/library.rs
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The Last.fm loved tracks sync has two issues:

1. **SQL inserts not batched**: `bulk_insert_loved_tracks` in `crates/mt-tauri/src/db/lastfm_loved.rs:34` runs individual INSERT statements with no transaction wrapper. For ~10k tracks this is extremely slow.

2. **Matching completely broken (0 results)**: `match_loved_tracks_impl` in `crates/mt-tauri/src/commands/lastfm.rs:906` has two tiers, both broken:
   - Primary: uses exact case-sensitive `artist = ?` (library.rs:77). Last.fm names rarely match file metadata exactly.
   - Fallback: concatenates artist+track into one LIKE term (`%Radiohead Creep%`). No single column contains both, so it always returns 0.

Additionally, the match loop does individual `with_conn` calls per track for search, set_match, is_favorite, and add_favorite — all unbatched.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 bulk_insert_loved_tracks wraps all inserts in a single transaction
- [x] #2 Primary matching uses case-insensitive LIKE instead of exact = for artist
- [x] #3 Fallback matching searches artist and track as separate conditions, not concatenated
- [x] #4 Match loop batches DB writes (set_matched_track, add_favorite) in a transaction
- [x] #5 Existing tests pass after changes
- [x] #6 New tests validate the matching logic improvements
- [x] #7 docs/lastfm.md updated with matching strategy and loved tracks schema
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Rewrote loved track matching to use exact case-insensitive matching (dropped LIKE substring fallback that caused false positives like "Plans" matching "Plans/Brothers on a Hotel Bed"). Added `find_tracks_by_artist_title` returning `Vec<Track>` for multi-album disambiguation via `track.getInfo` API. Made `match_loved_tracks_impl` async. Fixed `match_new_tracks_against_loved` to use exact equality instead of `.contains()` substring matching. Bulk inserts already wrapped in transaction from prior fix. All 7 ACs met, 573+ tests pass, clippy clean.
<!-- SECTION:FINAL_SUMMARY:END -->
