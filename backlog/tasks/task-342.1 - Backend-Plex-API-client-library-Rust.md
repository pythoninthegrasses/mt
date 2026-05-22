---
id: TASK-342.1
title: 'Backend: Plex API client library (Rust)'
status: In Progress
assignee: []
created_date: '2026-05-21 22:56'
updated_date: '2026-05-22 04:07'
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
- [ ] #1 Client module exists at `crates/mt-tauri/src/plex/` with submodules: `client.rs`, `types.rs`, `mod.rs`. Follow the structural pattern of `crates/mt-tauri/src/lastfm/`.
- [ ] #2 PlexConfig struct holds: `url: String` (accepts http:// or https://, port included by user e.g. `http://192.168.1.10:32400`), `token: String` (X-Plex-Token), and `libraries: Option<Vec<String>>` (optional library titles; matched case-insensitively against section title).
- [ ] #3 HTTP client uses `reqwest::Client` with timeout=30s. Every request sets headers: `Accept: application/json`, `X-Plex-Product: mt`, `X-Plex-Client-Identifier: <stable UUID>` (generated once, persisted alongside config, reused across runs). X-Plex-Token is sent as a query parameter on every request.
- [ ] #4 `music_sections()` returns all music library sections by GET `/library/sections`, filtering `MediaContainer.Directory[]` to entries with `type == "artist"`, applying the optional library-name filter (case-insensitive), and returning `(key, title)` pairs.
- [ ] #5 `albums(section_key)` returns all albums in a section by GET `/library/sections/<key>/all?type=9`, paginated with `X-Plex-Container-Start` and `X-Plex-Container-Size=300` until `MediaContainer.totalSize` is exhausted. Returned fields: `rating_key`, `title`, `artist_name` (from parentTitle), `year`, `track_count`.
- [ ] #6 `tracks(album_rating_key)` returns tracks by GET `/library/metadata/<key>/children`. Deserializes Plex native schema: `ratingKey`, `title`, `grandparentTitle`→`artist_name`, `parentTitle`→`album_name`, `year`, `index`→`track_number`, `duration` (milliseconds, kept as u64), and `part_key` from `Media[0].Part[0].key`. Tracks missing Media or Part data are filtered out.
- [ ] #7 `stream_url(part_key)` returns `format!("{base}{part_key}?X-Plex-Token={token}", base = config.url)`. Works for both http:// and https:// server URLs. part_key already begins with `/library/parts/...`.
- [ ] #8 Errors typed via thiserror enum `PlexError` with variants: `NetworkError(reqwest::Error)`, `HttpStatus(u16)`, `Unauthorized` (for 401), `ResponseTooLarge`, `ParseError(serde_json::Error)`. The `get()` helper limits response body to 10MB.
- [ ] #9 All public structs (`PlexConfig`, section/album/track DTOs) derive `serde::Serialize + serde::Deserialize`. Internal deserialization DTOs mirroring Plex JSON (`MediaContainer`, `Directory`, `Metadata`, `Media`, `Part`) live in `types.rs` and are crate-private.
- [ ] #10 Unit tests use wiremock (already in dev-dependencies) with fixture JSON stored under `crates/mt-tauri/tests/fixtures/plex/`. Coverage: section enumeration, single-page album list, multi-page pagination (verifies loop terminates on totalSize), track deserialization with nested Media/Part, 401→Unauthorized mapping, body-size cap→ResponseTooLarge. Plus pure unit tests for `stream_url()` with both http:// and https:// base URLs.
<!-- AC:END -->
