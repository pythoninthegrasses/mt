---
id: TASK-341.1
title: 'Backend: Plex API client library (Rust)'
status: To Do
assignee: []
created_date: '2026-05-21 22:56'
labels: []
dependencies: []
references:
  - 'https://github.com/bjarneo/cliamp/blob/main/external/plex/client.go'
  - 'https://github.com/bjarneo/cliamp/blob/main/external/plex/provider.go'
parent_task_id: TASK-341
ordinal: 53500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement the core Plex Media Server API client in Rust. This is the foundation module that all other Plex integration work depends on.

Reference implementation: cliamp's `external/plex/client.go` (~200 lines, JSON-based). The API uses standard Plex HTTP endpoints with X-Plex-Token authentication. No PIN-OAuth flow — users provide a static token found in Plex Web's View XML URL.

Key endpoints:
- `GET /library/sections` — enumerate library sections, filter type=artist for music
- `GET /library/sections/<key>/all?type=9` — list albums in a section (paginated via X-Plex-Container-Start/Size)
- `GET /library/metadata/<albumRatingKey>/children?type=3` — list tracks in an album
- `GET /library/parts/<partID>/<timestamp>/file.<ext>?X-Plex-Token=<token>` — direct file stream

The client returns Rust structs that map to the JSON response shapes. The `get()` helper handles authentication, error handling, and response size limits.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Client module exists at `crates/mt-tauri/src/plex/` with submodules: `client.rs`, `types.rs`, `mod.rs`
- [ ] #2 PlexConfig struct holds URL, token, and optional library name filters
- [ ] #3 API client uses JSON responses (Accept: application/json) with X-Plex-Product and X-Plex-Client-Identifier headers
- [ ] #4 MusicSections() returns all music library sections (type=artist) with key and title
- [ ] #5 Albums(sectionKey) returns paginated list of albums with ratingKey, title, artistName, year, trackCount
- [ ] #6 Tracks(albumRatingKey) returns all tracks with ratingKey, title, artistName, albumName, year, trackNumber, duration, and partKey
- [ ] #7 StreamURL(partKey) constructs authenticated direct-play URL: `http://<server>/library/parts/<id>/<timestamp>/file.<ext>?X-Plex-Token=<token>`
- [ ] #8 get() method handles 401 Unauthorized as a specific error, and limits response body to 10MB
- [ ] #9 All structs derive serde::Serialize + serde::Deserialize
- [ ] #10 Unit tests for URL construction and JSON deserialization of track/album responses
<!-- AC:END -->
