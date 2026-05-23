---
id: TASK-342.4
title: 'Backend: Plex library fetch + merge with local library'
status: Done
assignee: []
created_date: '2026-05-21 22:57'
updated_date: '2026-05-23 02:09'
labels: []
dependencies:
  - TASK-342.1
  - TASK-342.2
parent_task_id: TASK-342
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
- [x] #1 Tauri command `plex_fetch_albums() -> Result<Vec<PlexAlbum>, String>` calls `plex::client::music_sections()` then `albums(section_key)` for each section returned. Results are aggregated in section-order then album-order (preserves Plex natural ordering). Backed by in-memory cache (see #9).
- [x] #2 Tauri command `plex_fetch_tracks(albumRatingKey: String) -> Result<Vec<PlexTrack>, String>` calls `plex::client::tracks(album_rating_key)` and returns the result verbatim (also cached, keyed by `album_rating_key`).
- [x] #3 Tauri command `plex_merge_library() -> Result<PlexMergeStats, String>` performs the full merge in a single DB transaction. `PlexMergeStats` returns `{ inserted: u64, linked: u64, skipped: u64, errors: Vec<String> }`. The command is idempotent — re-running with no Plex-side changes yields `inserted=0, linked=0`.
- [x] #4 Match algorithm (per remote track): (a) content_hash match (both non-NULL) → link (set `remote_id` on local row, do NOT insert). (b) Normalize artist/album/title via `lowercase + trim + collapse whitespace + strip leading "the "`, compare against same normalization of local rows: exactly one match → link; multiple → skip (add "ambiguous" to `errors`); none → insert.
- [x] #5 Normalization function lives at `crates/mt-tauri/src/plex/merge.rs` as `pub(crate) fn normalize_for_match(s: &str) -> String` with unit tests covering: leading "The ", mixed case, leading/trailing whitespace, double-spaces, unicode (NFC form).
- [x] #6 Inserted remote rows have: `source='plex'`, `remote_id=<Plex ratingKey>`, `filepath=<stream_url>` (full authenticated URL from `plex::client::stream_url`), `artist`, `album`, `title`, `track_number`, `year`, `duration_ms`, `last_seen_at=NOW`. All other columns (`content_hash`, `file_size`, etc.) are NULL.
- [x] #7 Linked local rows are updated to set `remote_id`; `source` stays `'local'` (the row points at a local file that also exists in Plex — it is not itself a Plex track).
- [x] #8 The merge runs inside a single `conn.transaction()`. On any error, the transaction rolls back and `PlexMergeStats` returns an error response without partial inserts.
- [x] #9 In-memory cache lives on a Tauri-managed `PlexState` struct with `tokio::sync::Mutex<PlexCache>` holding album-list and per-album-track-list maps. No TTL; refresh is explicit via `plex_refresh_cache()` Tauri command. `plex_merge_library()` reads from cache (does not refetch).
- [x] #10 Library queries (`library_get_all`, `library_get_section`) include both sources by default with no SQL change required — they already lack a `source` filter. The optional `source_filter` from TASK-342.2 AC #6 lets the UI narrow when needed.
- [x] #11 Integration test: wiremock Plex server with 1 section + 3 albums + 5 tracks/album. Run `plex_merge_library` against fresh DB: assert `inserted=15, linked=0`. Pre-insert one local track matching a fixture by normalized artist+album+title; re-run: assert `inserted=14, linked=1, skipped=0`.
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented Plex library fetch, cache, and merge for TASK-342.4.\n\nNew files:\n- crates/mt-tauri/src/plex/merge.rs: normalize_for_match(), PlexMergeStats, merge_plex_library(), DB helpers (insert_plex_track, link_local_track, load_local_rows, load_existing_remote_ids), plus 7 unit tests for normalize_for_match and 2 integration tests with wiremock.\n\nModified files:\n- crates/mt-tauri/Cargo.toml: added unicode-normalization = \"0.1\"\n- crates/mt-tauri/src/plex/mod.rs: added merge module and re-exported PlexMergeStats\n- crates/mt-tauri/src/commands/plex.rs: added PlexCache, PlexState, load_plex_config helper, and four Tauri commands: plex_fetch_albums, plex_fetch_tracks, plex_refresh_cache, plex_merge_library\n- crates/mt-tauri/src/commands/mod.rs: exported new types and commands\n- crates/mt-tauri/src/lib.rs: imported new symbols, registered 4 new commands, managed PlexState\n\nAll 837 tests pass."
<!-- SECTION:FINAL_SUMMARY:END -->
