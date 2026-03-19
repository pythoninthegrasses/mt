---
id: TASK-291
title: Persist removed track identifiers to prevent re-addition on library scan
status: Done
assignee: []
created_date: '2026-02-25 23:19'
updated_date: '2026-02-25 23:28'
labels:
  - bug
  - library
  - database
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
When a user removes a track from the library, it gets re-added on subsequent library scans. This defeats the purpose of removing unwanted/broken tracks.

**Current behavior:**
- User removes a track (e.g., "10 - ADD" by unknown artist from a broken file)
- Next library scan re-discovers and re-adds the removed track

**Expected behavior:**
- Removed tracks should stay removed across library scans
- The system should maintain a persistent record of removed track identifiers

**Technical considerations:**
- Need a unique identifier strategy (file path, content hash, or combination)
- File paths can change if files are moved/renamed
- Consider using a content-based hash for more robust identification
- May need a new table or field in the database to track removals
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Removed tracks are not re-added on subsequent library scans
- [x] #2 Removal identifiers persist across application restarts
- [x] #3 Works correctly when files are moved/renamed (if using content hash)
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Changes

### New `removed_tracks` table
- Schema: `id`, `filepath` (UNIQUE), `content_hash`, `removed_at`
- Indexes on `filepath` and `content_hash` for fast lookups
- Migration added for existing databases

### New `db::removed` module (`crates/mt-tauri/src/db/removed.rs`)
- `record_removal()` / `record_removals_bulk()` - persist removal identifiers
- `get_removed_filepaths()` / `get_removed_content_hashes()` - batch lookup sets for scan filtering
- `clear_removal()` / `clear_all_removals()` - for un-removing and library reset
- `is_filepath_removed()` - single-path check
- 10 unit tests covering all operations + integration scenarios

### Modified delete commands (`crates/mt-tauri/src/library/commands.rs`)
- `library_delete_track` - records filepath + content_hash before deleting (in transaction)
- `library_delete_tracks` - bulk version, fetches track info then records all removals
- `library_delete_all` - clears `removed_tracks` table too (clean slate)

### Modified scanner (`crates/mt-tauri/src/scanner/commands.rs`)
- Filters `truly_new` tracks against removed filepaths and content hashes before bulk insert
- Fast path: skips filtering when no removals exist

### Modified watcher (`crates/mt-tauri/src/watcher.rs`)
- Same filtering applied to watcher-initiated scans

### Identifier strategy
- **Filepath**: always stored (primary match for same-path re-scans)
- **Content hash**: stored when available (catches moved/renamed files with same content)
- Both checked during scan for robust coverage
<!-- SECTION:FINAL_SUMMARY:END -->
