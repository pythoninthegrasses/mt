---
id: TASK-281
title: Fix "Failed to load track metadata" for first 44 unknown-artist tracks
status: Done
assignee: []
created_date: '2026-02-20 18:50'
updated_date: '2026-02-20 19:06'
labels:
  - bug
  - metadata
  - library
dependencies: []
priority: high
ordinal: 1000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

When attempting to edit metadata for certain tracks that display as "Unknown Artist" in the library, the metadata editor fails with "Failed to load track metadata." This affects the first ~44 tracks with unknown artist.

## Reproduction

1. Open the library and filter/sort to show tracks with "Unknown Artist"
2. Right-click one of the first 44 unknown-artist tracks and open the metadata editor
3. Observe "Failed to load track metadata" error

## Example Track

- Path: `/Users/lance/Music/Doppler/The Mountain Goats/1995 - The Mountain Goats - Nine Black Poppies [V0]`
- Track: "Cubs in Five"
- This track has valid metadata on disk (artist: The Mountain Goats) but appears as Unknown Artist in the library, and its metadata cannot be loaded for editing.

## Notes

- The issue may be related to how these tracks were originally imported or indexed — possibly missing or malformed database records
- The "first 44" pattern suggests a batch import issue or a boundary condition in the scanning/indexing pipeline
- The track files themselves likely have valid tags (the folder structure includes artist/album info)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 All tracks with valid on-disk metadata can be opened in the metadata editor without error
- [ ] #2 Tracks previously showing as Unknown Artist display correct artist/album info after fix
- [x] #3 No regression in metadata editing for tracks that already work correctly
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Root Cause

The 46 "Unknown Artist" tracks had malformed ID3 tags (UTF-16 odd-length strings, wrong encodings for ID3v2.2, invalid timestamps). Lofty-rs was using strict parsing by default, which caused `Probe::open().read()` to fail entirely on these files.

The scanner already handled this gracefully via `extract_metadata_or_default()` (falling back to filename-as-title), but the metadata editor's `get_track_metadata` command had no fallback — it propagated the lofty error directly to the frontend, causing the "Failed to load track metadata" toast.

## Fix (3 files)

1. **`crates/mt-tauri/src/metadata.rs`** — `get_track_metadata()` and `save_track_metadata()`:
   - Use `ParsingMode::Relaxed` (tolerates malformed tags, discards corrupted fields)
   - When relaxed parsing still fails, return empty `TrackMetadata` instead of an error so the editor can open
   - For save: when tags are unreadable, create a fresh tag and write it directly

2. **`crates/mt-tauri/src/scanner/metadata.rs`** — `extract_metadata()`:
   - Use `ParsingMode::Relaxed` for scanning too, so future rescans extract whatever valid metadata exists

3. **`crates/mt-tauri/src/library/commands.rs`** — `library_rescan_track()`:
   - Use `extract_metadata_or_default()` instead of `extract_metadata()` so rescanning tracks with malformed tags doesn't fail

## Results

- 46/46 previously broken tracks now load in the metadata editor (was 0/46)
- 14 tracks had metadata recoverable via relaxed parsing (artist, title, album now populated)
- 32 tracks with fully corrupted tags still open with empty fields (user can write new tags)
- 585/585 existing tests pass, no regression
<!-- SECTION:NOTES:END -->
