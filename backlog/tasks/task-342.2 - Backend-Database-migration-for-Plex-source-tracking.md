---
id: TASK-342.2
title: 'Backend: Database migration for Plex source tracking'
status: In Progress
assignee: []
created_date: '2026-05-21 22:56'
updated_date: '2026-05-22 04:31'
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
- [ ] #1 Schema migration follows the column-presence idiom in `crates/mt-tauri/src/db/schema.rs::run_migrations` — read columns via `get_table_columns(conn, "library")`, then `conn.execute("ALTER TABLE library ADD COLUMN X ...", [])` guarded by `if !cols.contains(...)`. Do not introduce `PRAGMA user_version` or any new versioning system.
- [ ] #2 New columns on `library`: `source TEXT NOT NULL DEFAULT 'local'` and `remote_id TEXT`. Existing rows acquire `source='local'` via the DEFAULT; `remote_id` stays NULL.
- [ ] #3 Add index `idx_library_remote_id ON library(remote_id) WHERE remote_id IS NOT NULL`, created behind an `index_exists(conn, "idx_library_remote_id")?` guard.
- [ ] #4 Add index `idx_library_source ON library(source)`, created behind an `index_exists` guard, to support `WHERE source = ?` filters efficiently.
- [ ] #5 The `Track` model in `crates/mt-tauri/src/db/models.rs` gains `source: String` (default `"local"` in constructors) and `remote_id: Option<String>`. All existing row-builder functions read the new columns.
- [ ] #6 Existing library queries (`library_get_all`, `library_get_section` in `crates/mt-tauri/src/library/commands.rs`) continue to return all tracks by default (no source filter on the WHERE clause). A new optional `source_filter: Option<String>` parameter is added to `library_get_all`; when `Some("local")` or `Some("plex")` it appends `AND source = ?`. When `None`, behavior is unchanged.
- [ ] #7 Library stats (`library_get_stats` at `commands.rs:476`) count both sources — no change required (existing query has no source filter).
- [ ] #8 Migration is verified idempotent by a Rust unit test that runs `run_migrations` twice in a row against a fresh in-memory SQLite DB and asserts (a) both new columns exist after the first call, (b) the second call is a no-op (no error, no duplicate columns).
- [ ] #9 A second test inserts one row with `source='local'`, one with `source='plex'` + `remote_id='12345'`, and asserts `library_get_all(source_filter=Some("plex"))` returns exactly the second row.
<!-- AC:END -->
