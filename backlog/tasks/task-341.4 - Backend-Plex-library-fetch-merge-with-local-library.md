---
id: TASK-341.4
title: 'Backend: Plex library fetch + merge with local library'
status: To Do
assignee: []
created_date: '2026-05-21 22:57'
labels: []
dependencies:
  - TASK-341.1
  - TASK-341.2
parent_task_id: TASK-341
ordinal: 56500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Fetch albums and tracks from the Plex server and merge them into the local library database.

**Fetch flow:**
1. Call `MusicSections()` to get all music library sections
2. For each section, call `Albums(sectionKey)` to get all albums (paginated)
3. For each album, call `Tracks(albumRatingKey)` to get all tracks
4. Cache results in memory (refreshable)

**Merge logic:**
For each remote track:
1. Try to match against existing local tracks using:
   - **Primary**: content_hash match (if local track has fingerprint)
   - **Secondary**: artist + album + title fuzzy match (case-insensitive, trim whitespace)
2. If match found → do NOT insert remote track; instead, store `remote_id` on the local track row as a link
3. If no match → insert new row with `source='plex'`, `remote_id` = Plex ratingKey, `filepath` = stream URL

**Query updates:**
- Existing library queries must include remote tracks: `WHERE source IN ('local','plex')`
- Add optional `source` filter parameter to allow `WHERE source = 'plex'` or `WHERE source = 'local'`
- Library stats (total_tracks, total_duration) should count both sources

**Key files:**
- `crates/mt-tauri/src/plex/client.rs` — API client (from task 341.1)
- `crates/mt-tauri/src/db/library.rs` — library queries
- `crates/mt-tauri/src/library/commands.rs` — Tauri commands
- `crates/mt-tauri/src/db/models.rs` — Track model (from task 341.2)

Reference: cliamp's `external/plex/provider.go` `Playlists()` and `Tracks()` methods for the fetch pattern.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Tauri command `plex_fetch_albums()` returns all albums from configured Plex libraries
- [ ] #2 Tauri command `plex_fetch_tracks(albumRatingKey)` returns all tracks for a given album
- [ ] #3 Tauri command `plex_merge_library()` imports all fetched albums/tracks into the local DB
- [ ] #4 Remote tracks are inserted with `source='plex'`, `remote_id` set to Plex ratingKey, `filepath` set to the stream URL
- [ ] #5 Tracks are matched to existing local tracks using artist+album+title fuzzy matching (content_hash preferred, fallback to text match)
- [ ] #6 When a match is found, the remote track is NOT inserted — instead, `remote_id` is stored on the local track as a link
- [ ] #7 When no match is found, a new remote track row is created with `source='plex'`
- [ ] #8 Library queries (library_get_all, library_get_section) include remote tracks by default via `WHERE source IN ('local','plex')`
- [ ] #9 A `source` filter option is added to library queries to allow filtering by source
- [ ] #10 Plex library data is cached after first fetch; refresh command clears cache
- [ ] #11 Integration test: fetch from a mock Plex server, verify merge results in DB
<!-- AC:END -->
