---
id: task-269
title: Add M3U playlist import/export
status: To Do
assignee: []
created_date: '2026-02-16 15:08'
updated_date: '2026-02-16 16:13'
labels:
  - playlists
  - feature
  - musicat-comparison
dependencies: []
priority: low
ordinal: 40000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Support importing M3U/M3U8 playlist files and exporting mt playlists as M3U. Musicat comparison revealed this as a gap.

M3U is the universal playlist interchange format. Parse file paths from M3U, match against library tracks via filepath index (idx_library_filepath), create playlist via existing create_playlist() + add_tracks_to_playlist(). Export writes #EXTM3U header + #EXTINF metadata + filepaths. Use existing dialog infrastructure for file picker.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Import M3U button in sidebar playlist section opens file picker
- [ ] #2 Parsed M3U paths matched against library by filepath, fallback to filename
- [ ] #3 Imported playlist created with matched tracks, unmatched entries reported to user
- [ ] #4 Export option in playlist context menu writes M3U8 with EXTINF metadata
- [ ] #5 Exported M3U uses relative paths for portability
- [ ] #6 Handles both M3U and M3U8 formats
- [ ] #7 Rust unit tests for M3U parsing and path resolution
- [ ] #8 Playwright E2E test for import and export workflows
<!-- AC:END -->
