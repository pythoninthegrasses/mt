---
id: TASK-294
title: >-
  Deduplicate library tracks across watched directories with ctime/mtime
  preference and reinstatement
status: In Progress
assignee: []
created_date: '2026-03-08 01:23'
updated_date: '2026-03-08 01:34'
labels:
  - feature
  - library
  - dedup
  - settings
dependencies: []
references:
  - crates/mt-tauri/src/db/library.rs
  - crates/mt-tauri/src/library/commands.rs
  - crates/mt-tauri/src/scanner/inventory.rs
  - crates/mt-tauri/src/scanner/commands.rs
  - crates/mt-tauri/src/db/schema.rs
  - crates/mt-tauri/src/commands/settings.rs
  - app/frontend/js/components/settings-view.js
priority: medium
ordinal: 2000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

When multiple watched directories contain identical tracks (e.g., `~/Music/Doppler/` and `~/Music/iPhone Music/`), the library shows duplicates. The existing reconcile scan deduplicates by inode and content_hash, but lacks:

1. **Directory-aware preference**: No way to prefer one copy over another based on file age
2. **Reinstatement on source removal**: If the preferred directory disappears (e.g., iPhone Music is removed), the deduplicated tracks from the remaining directory (Doppler) are not reinstated
3. **User control**: No settings toggle for cross-directory deduplication

### Example

```
~/Music/Doppler/Angie McMahon/Light, Dark, Light Again (2023)/01. Saturn Returning.mp3
~/Music/iPhone Music/Angie McMahon/Light, Dark, Light Again (2023)/01. Saturn Returning.mp3
```

Both directories contain identical tracks. Doppler has older ctime (original source). The library should show only one copy, preferring the Doppler version.

## Proposed Approach

### 1. Track Identity (UUID/Fingerprint)

Extend the existing `content_hash` (SHA-256) based deduplication. Tracks with the same content_hash across different watched directories are considered duplicates. No new UUID column needed — content_hash already serves as the identity key.

### 2. Preference Logic

When duplicates are found, determine which copy to keep:

- **Primary**: Prefer the track with the **oldest ctime** (file creation time, indicating the original source)
- **Fallback**: If ctime is unavailable or identical, use **oldest mtime** (metadata change time)
- **Tiebreaker**: If both are identical, prefer alphabetical directory order (deterministic)

This requires:
- Adding `file_ctime_ns` column to the `library` table (similar to existing `file_mtime_ns`)
- Populating ctime during scan (inventory phase)
- Using ctime in the duplicate preference ordering

### 3. Dedup Tracking Table

Create a `deduplicated_tracks` table to track suppressed duplicates:

```sql
CREATE TABLE deduplicated_tracks (
    id INTEGER PRIMARY KEY,
    kept_track_id INTEGER NOT NULL REFERENCES library(id),
    suppressed_filepath TEXT NOT NULL,
    suppressed_content_hash TEXT,
    suppressed_ctime_ns INTEGER,
    suppressed_mtime_ns INTEGER,
    deduplicated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_dedup_kept ON deduplicated_tracks(kept_track_id);
CREATE INDEX idx_dedup_hash ON deduplicated_tracks(suppressed_content_hash);
```

This table enables reinstatement — when a kept track goes missing, query this table to find suppressees with matching content_hash that still exist on disk.

### 4. Reinstatement Logic

During library scan (or reconcile), when a track marked as "kept" is detected as missing:

1. Query `deduplicated_tracks` for entries where `kept_track_id` matches
2. Check if any `suppressed_filepath` still exists on disk
3. If found, promote the best remaining candidate (by ctime/mtime preference) to active library track
4. Transfer play_count, favorites, playlist entries (same as existing merge logic)
5. Remove the old dedup record

### 5. Settings UI

Add a toggle in the **Library** section of Settings:

- **Label**: "Deduplicate tracks across directories"
- **Description**: "When the same track exists in multiple watched directories, show only one copy. Prefers the oldest source."
- **Default**: Enabled
- **Setting key**: `library.deduplicateAcrossDirectories`

When toggled off, suppress the cross-directory dedup pass in reconcile scan. Existing `deduplicated_tracks` records should be reinstated (un-suppress all).

When toggled on, trigger a reconcile scan to apply dedup.

### 6. Integration Points

- **`scanner/inventory.rs`**: Read and store `file_ctime_ns` alongside `file_mtime_ns`
- **`scanner/commands.rs`**: After scan, run cross-directory dedup if setting enabled
- **`library/commands.rs` (`library_reconcile_scan`)**: Add cross-directory dedup phase after existing inode/content_hash dedup
- **`db/library.rs`**: Add `find_cross_directory_duplicates()` using content_hash grouped by watched directory
- **`db/schema.rs`**: Migration for `file_ctime_ns` column and `deduplicated_tracks` table
- **`commands/settings.rs`**: Handle `library.deduplicateAcrossDirectories` setting
- **`app/frontend/js/components/settings-view.js`**: Add toggle in Library section

## Existing Code References

- Dedup logic: `crates/mt-tauri/src/db/library.rs:912-1043`
- Reconcile scan: `crates/mt-tauri/src/library/commands.rs:483-645`
- Inventory scan: `crates/mt-tauri/src/scanner/inventory.rs:38-134`
- Schema migrations: `crates/mt-tauri/src/db/schema.rs:207-281`
- Settings UI: `app/frontend/js/components/settings-view.js:12-106`
- Settings backend: `crates/mt-tauri/src/commands/settings.rs`
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Tracks with identical content_hash across different watched directories are deduplicated to show only one copy in the library
- [ ] #2 Preference ordering uses ctime (oldest first), falling back to mtime, then alphabetical directory path
- [ ] #3 file_ctime_ns column added to library table and populated during scan
- [ ] #4 deduplicated_tracks table tracks suppressed duplicates with kept_track_id, suppressed_filepath, content_hash, and timestamps
- [ ] #5 When a kept track's directory is removed or goes missing, the best remaining suppressed duplicate is reinstated automatically
- [ ] #6 Reinstated tracks inherit play_count, favorites, and playlist entries from the missing kept track
- [ ] #7 Settings UI has a toggle in Library section: 'Deduplicate tracks across directories' (enabled by default)
- [ ] #8 Setting key is library.deduplicateAcrossDirectories stored in settings.json
- [ ] #9 Disabling the setting reinstates all suppressed duplicates
- [ ] #10 Enabling the setting triggers a reconcile scan with cross-directory dedup
- [ ] #11 Existing inode-based and content_hash-based single-directory dedup continues to work unchanged
- [ ] #12 DB migration is backward-compatible (new columns nullable, new table additive)
<!-- AC:END -->
