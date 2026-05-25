---
id: TASK-342.2
title: 'Backend: Database migration for Plex source tracking'
status: Done
assignee: []
created_date: '2026-05-21 22:56'
updated_date: '2026-05-23 00:48'
labels: []
dependencies: []
parent_task_id: TASK-342
ordinal: 54500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add database columns to support tracking remote (Plex) tracks alongside local tracks.

Changes to the `tracks` table:
- `source TEXT DEFAULT 'local'` — enum-like column: 'local' for scanned files, 'plex' for remote tracks
- `remote_id TEXT` — stores the Plex ratingKey for dedup matching and reference

This is a prerequisite for all subsequent Plex tasks. The migration must be idempotent and follow the existing migration pattern in the codebase.

The Track model in `db/models.rs` must be updated to include the new fields with proper serde annotations.

Key files:
- `crates/mt-tauri/src/db/` — database layer
- `crates/mt-tauri/src/db/models.rs` — Track struct
- Existing migration files for pattern reference
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Schema migration follows the column-presence idiom in `crates/mt-tauri/src/db/schema.rs::run_migrations` — read columns via `get_table_columns(conn, "library")`, then `conn.execute("ALTER TABLE library ADD COLUMN X ...", [])` guarded by `if !cols.contains(...)`. Do not introduce `PRAGMA user_version` or any new versioning system.
- [x] #2 New columns on `library`: `source TEXT NOT NULL DEFAULT 'local'` and `remote_id TEXT`. Existing rows acquire `source='local'` via the DEFAULT; `remote_id` stays NULL.
- [x] #3 Add index `idx_library_remote_id ON library(remote_id) WHERE remote_id IS NOT NULL`, created behind an `index_exists(conn, "idx_library_remote_id")?` guard.
- [x] #4 Add index `idx_library_source ON library(source)`, created behind an `index_exists` guard, to support `WHERE source = ?` filters efficiently.
- [x] #5 The `Track` model in `crates/mt-tauri/src/db/models.rs` gains `source: String` (default `"local"` in constructors) and `remote_id: Option<String>`. All existing row-builder functions read the new columns.
- [x] #6 Existing library queries (`library_get_all`, `library_get_section` in `crates/mt-tauri/src/library/commands.rs`) continue to return all tracks by default (no source filter on the WHERE clause). A new optional `source_filter: Option<String>` parameter is added to `library_get_all`; when `Some("local")` or `Some("plex")` it appends `AND source = ?`. When `None`, behavior is unchanged.
- [x] #7 Library stats (`library_get_stats` at `commands.rs:476`) count both sources — no change required (existing query has no source filter).
- [x] #8 Migration is verified idempotent by a Rust unit test that runs `run_migrations` twice in a row against a fresh in-memory SQLite DB and asserts (a) both new columns exist after the first call, (b) the second call is a no-op (no error, no duplicate columns).
- [x] #9 A second test inserts one row with `source='local'`, one with `source='plex'` + `remote_id='12345'`, and asserts `library_get_all(source_filter=Some("plex"))` returns exactly the second row.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Implementation Plan

### Files to modify
1. `crates/mt-tauri/src/db/schema.rs` — 4 new migrations + update existing idempotent test
2. `crates/mt-tauri/src/db/models.rs` — add `source: String` and `remote_id: Option<String>` to Track
3. `crates/mt-tauri/src/db/library.rs` — row_to_track, LibraryQuery, build_library_where, 7 SELECT statements, add source_filter test
4. `crates/mt-tauri/src/library/commands.rs` — add source_filter param to library_get_all, fix get_section_all struct literal
5. `crates/mt-tauri/src/db/playlists.rs` — add l.source, l.remote_id to JOIN SELECT

### Migrations (schema.rs)
Append to end of run_migrations before Ok(()):
- source TEXT NOT NULL DEFAULT 'local' (guarded by column check)
- remote_id TEXT (guarded by column check)
- idx_library_remote_id partial index WHERE remote_id IS NOT NULL
- idx_library_source index

### Model changes (models.rs)
Add to Track struct after last_seen_at:
- `pub source: String`
- `pub remote_id: Option<String>`

### Library query changes (library.rs)
- row_to_track: add source + remote_id reads with unwrap_or fallbacks
- LibraryQuery: add `source_filter: Option<String>` field
- build_library_where: add condition when source_filter is Some
- 7 SELECT statements: add `source, remote_id` to column list
  - get_all_tracks (~line 135)
  - find_tracks_by_artist_title (~line 330)
  - get_track_by_id (~line 364)
  - get_track_by_filepath (~line 382)
  - get_missing_tracks (~line 960)
  - find_missing_track_by_inode (~line 1000)
  - find_missing_track_by_content_hash (~line 1022)
- Add test_source_filter test (AC#9)

### Command changes (commands.rs)
- library_get_all: add source_filter: Option<String> param, pass to LibraryQuery
- get_section_all (line 221): add source_filter: None to struct literal

### Playlist changes (playlists.rs)
- JOIN SELECT (~line 93): add l.source, l.remote_id columns

### Tests
- schema.rs test_migrations_idempotent: assert source + remote_id columns + indexes (AC#8)
- library.rs test_source_filter: insert local + plex row, assert plex filter works (AC#9)
<!-- SECTION:PLAN:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added source/remote_id columns to the library table with idempotent migrations following the existing column-presence pattern. Updated Track model, row_to_track, all SELECT statements across library/favorites/queue/playlists, and library_get_all command. All 817 tests pass.
<!-- SECTION:FINAL_SUMMARY:END -->
