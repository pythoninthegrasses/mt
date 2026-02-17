---
id: TASK-276
title: Allow editing watched folder path
status: To Do
assignee: []
created_date: '2026-02-17 15:52'
updated_date: '2026-02-17 16:20'
labels:
  - ui
  - settings
  - watched-folders
dependencies: []
references:
  - crates/mt-tauri/src/db/watched.rs
  - crates/mt-tauri/src/watcher.rs
  - app/frontend/views/settings.html
  - app/frontend/js/components/settings-view.js
  - app/frontend/js/api.js
priority: medium
ordinal: 45500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Currently a watched folder's path cannot be changed after creation. The only option is to delete the folder and re-add it with the new path, which loses the `last_scanned_at` timestamp and any association with previously scanned tracks.

The UI already has inline controls for mode (startup/continuous) and cadence (minutes), but the path is displayed as read-only text. There is also no UI for the `enabled` field, which the backend already supports.

## Current State

**Backend** (`crates/mt-tauri/src/db/watched.rs:82`): `update_watched_folder()` accepts `mode`, `cadence_minutes`, and `enabled` — but **not** `path`.

**Frontend** (`app/frontend/views/settings.html:146-152`): Path is rendered as a read-only truncated `<span>`. Mode and cadence have inline edit controls. No enabled/disabled toggle exists.

**Tauri command** (`crates/mt-tauri/src/watcher.rs:769`): `watched_folders_update` passes through `UpdateWatchedFolderRequest` which has `mode`, `cadence_minutes`, `enabled` — no `path` field.

## Goal

Allow users to change a watched folder's path via the settings UI, and expose the existing `enabled` backend field in the UI.

## Constraints

- Changing a path must validate the new path exists on disk (same as add)
- The UNIQUE constraint on `path` must be respected (no duplicates)
- Changing the path should update the filesystem watcher (stop watching old path, start watching new)
- The watcher manager's `update_folder()` method must handle the path change
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 User can change a watched folder's path via the settings UI (e.g., click path to open folder picker)
- [ ] #2 Backend update_watched_folder() and UpdateWatchedFolderRequest support changing the path field
- [ ] #3 Path validation: new path must exist on disk, must not duplicate an existing watched folder
- [ ] #4 Filesystem watcher is updated when path changes (stop old, start new)
- [ ] #5 User can toggle a watched folder enabled/disabled via the settings UI
- [ ] #6 Existing mode and cadence inline editing continues to work unchanged
- [ ] #7 Unit tests cover path update, duplicate path rejection, and enabled toggle in db/watched.rs
- [ ] #8 E2E test covers the edit path flow in the settings view
<!-- AC:END -->
