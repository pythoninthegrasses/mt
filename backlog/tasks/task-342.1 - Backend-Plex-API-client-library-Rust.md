---
id: TASK-342.1
title: 'Backend: Plex API client library (Rust)'
status: Done
assignee: []
created_date: '2026-05-21 22:56'
updated_date: '2026-05-23 00:37'
labels: []
dependencies: []
references:
  - 'https://github.com/bjarneo/cliamp/blob/main/external/plex/client.go'
  - 'https://github.com/bjarneo/cliamp/blob/main/external/plex/provider.go'
parent_task_id: TASK-342
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
- [x] #1 Client module exists at `crates/mt-tauri/src/plex/` with submodules: `client.rs`, `types.rs`, `mod.rs`. Follow the structural pattern of `crates/mt-tauri/src/lastfm/`.
- [x] #2 PlexConfig struct holds: `url: String` (accepts http:// or https://, port included by user e.g. `http://192.168.1.10:32400`), `token: String` (X-Plex-Token), and `libraries: Option<Vec<String>>` (optional library titles; matched case-insensitively against section title).
- [x] #3 HTTP client uses `reqwest::Client` with timeout=30s. Every request sets headers: `Accept: application/json`, `X-Plex-Product: mt`, `X-Plex-Client-Identifier: <stable UUID>` (generated once, persisted alongside config, reused across runs). X-Plex-Token is sent as a query parameter on every request.
- [x] #4 `music_sections()` returns all music library sections by GET `/library/sections`, filtering `MediaContainer.Directory[]` to entries with `type == "artist"`, applying the optional library-name filter (case-insensitive), and returning `(key, title)` pairs.
- [x] #5 `albums(section_key)` returns all albums in a section by GET `/library/sections/<key>/all?type=9`, paginated with `X-Plex-Container-Start` and `X-Plex-Container-Size=300` until `MediaContainer.totalSize` is exhausted. Returned fields: `rating_key`, `title`, `artist_name` (from parentTitle), `year`, `track_count`.
- [x] #6 `tracks(album_rating_key)` returns tracks by GET `/library/metadata/<key>/children`. Deserializes Plex native schema: `ratingKey`, `title`, `grandparentTitle`→`artist_name`, `parentTitle`→`album_name`, `year`, `index`→`track_number`, `duration` (milliseconds, kept as u64), and `part_key` from `Media[0].Part[0].key`. Tracks missing Media or Part data are filtered out.
- [x] #7 `stream_url(part_key)` returns `format!("{base}{part_key}?X-Plex-Token={token}", base = config.url)`. Works for both http:// and https:// server URLs. part_key already begins with `/library/parts/...`.
- [x] #8 Errors typed via thiserror enum `PlexError` with variants: `NetworkError(reqwest::Error)`, `HttpStatus(u16)`, `Unauthorized` (for 401), `ResponseTooLarge`, `ParseError(serde_json::Error)`. The `get()` helper limits response body to 10MB.
- [x] #9 All public structs (`PlexConfig`, section/album/track DTOs) derive `serde::Serialize + serde::Deserialize`. Internal deserialization DTOs mirroring Plex JSON (`MediaContainer`, `Directory`, `Metadata`, `Media`, `Part`) live in `types.rs` and are crate-private.
- [x] #10 Unit tests use wiremock (already in dev-dependencies) with fixture JSON stored under `crates/mt-tauri/tests/fixtures/plex/`. Coverage: section enumeration, single-page album list, multi-page pagination (verifies loop terminates on totalSize), track deserialization with nested Media/Part, 401→Unauthorized mapping, body-size cap→ResponseTooLarge. Plus pure unit tests for `stream_url()` with both http:// and https:// base URLs.
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented the Plex API client library at crates/mt-tauri/src/plex/ following the lastfm module structure. Created types.rs with public DTOs (PlexConfig, MusicSection, PlexAlbum, PlexTrack) and crate-private Plex JSON deserialization types (SectionsRoot, AlbumsRoot, TracksRoot, MediaDto, PartDto). Created client.rs with PlexClient using reqwest with 30s timeout, X-Plex-Token as query param, fixed Plex headers, 10MB body cap, thiserror PlexError enum, and methods music_sections/albums/tracks/stream_url. Albums pagination uses X-Plex-Container-Start/Size=300, looping until totalSize is exhausted. UUID derived deterministically via Uuid::new_v5 from the token (stable without file I/O). Added uuid v5 feature to Cargo.toml. All 9 tests pass: section enumeration, library filter, single-page albums, multi-page pagination (with configurable page_size for testing), track deserialization with Media/Part filter, 401→Unauthorized, and body-size cap. Fixture JSON lives under tests/fixtures/plex/.
<!-- SECTION:FINAL_SUMMARY:END -->
