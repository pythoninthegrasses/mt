---
id: TASK-341
title: Sync local library to attached iOS device with configurable filters and caps
status: In Progress
assignee: []
created_date: '2026-05-06 02:24'
updated_date: '2026-05-22 03:39'
labels:
  - feature
  - macos
  - library
  - usb
  - sync
dependencies:
  - TASK-214
priority: high
ordinal: 27250
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
When an iOS device is detected (via the mechanism delivered in task-214), sync a subset of the local library one-way (local → device) to the configured mount path (default `~/Music/Doppler`). Sync is driven by composable include/exclude rules and total caps so users can curate a rotating subset of a large collection on the device.

This task adds the sync engine, configuration surface, and trigger flow. It does not change detection logic from task-214 — it consumes it.

## Dependency

Requires task-214: iPhone mount detection, mount path discovery, and disconnect handling are owned by that task and not duplicated here.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Sync runs only on macOS (#[cfg(target_os = "macos")]) and only when an iOS device is detected via task-214's detection mechanism
- [ ] #2 Sync target directory is configurable; default matches the mount path from task-214 (~/Music/Doppler, $HOME expanded at runtime)
- [ ] #3 Inclusion filter — minimum play count: include tracks where play_count >= N (configurable)
- [ ] #4 Inclusion filter — last-played age: include tracks played within the last N days (configurable)
- [ ] #5 Inclusion filter — latest additions: include the N most recently added tracks (configurable)
- [ ] #6 Total cap — max albums: cap the sync to at most N albums (configurable)
- [ ] #7 Total cap — max artists: cap the sync to at most N artists (configurable)
- [ ] #8 Total cap — recency window: include only tracks added or last-played within the last N weeks (configurable)
- [ ] #9 Total cap — max track count and/or max total bytes (configurable)
- [ ] #10 Removal rule — last-played age: remove device tracks not played within the last N days (configurable)
- [ ] #11 Removal rule — date-added age: remove device tracks whose library date-added is more than N days ago (configurable)
- [ ] #12 Removal rule — min plays: remove device tracks with fewer than N total plays (configurable)
- [ ] #13 Removal supports a dry-run preview before any destructive file operation is performed
- [ ] #14 Sync is idempotent: re-running with no rule changes is a no-op (no redundant copies, no mtime/atime churn)
- [ ] #15 Sync progress and per-track results (added / skipped / removed / failed) are emitted as Tauri events for the frontend to render
- [ ] #16 Sync configuration is persisted via the settings store and exposed in settings-view.js
- [ ] #17 Sync engine exposes a Rust API and a Tauri command
- [ ] #18 Unit tests cover filter composition, cap enforcement, removal logic, and dry-run behavior
- [ ] #19 User documentation added to docs/ covering rule semantics, defaults, and dry-run workflow
<!-- AC:END -->
