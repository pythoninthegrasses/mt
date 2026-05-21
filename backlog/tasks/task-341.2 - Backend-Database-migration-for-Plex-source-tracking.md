---
id: TASK-341.2
title: 'Backend: Database migration for Plex source tracking'
status: To Do
assignee: []
created_date: '2026-05-21 22:56'
updated_date: '2026-05-21 22:57'
labels: []
dependencies: []
parent_task_id: TASK-341
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
- [ ] #1 Database migration adds `source TEXT DEFAULT 'local'` and `remote_id TEXT` columns to the tracks table
- [ ] #2 Migration is idempotent (safe to run multiple times) and included in the existing migration system
- [ ] #3 Track model in `db/models.rs` includes `source: String` and `remote_id: Option<String>` fields
- [ ] #4 All existing queries that select from tracks table are updated to include the new columns
- [ ] #5 SQLite schema version is incremented and migration file follows existing naming convention
- [ ] #6 Rust tests in `crates/mt-tauri/src/db/` pass after schema change
<!-- AC:END -->
