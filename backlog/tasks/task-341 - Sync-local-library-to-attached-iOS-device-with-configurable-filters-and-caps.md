---
id: TASK-341
title: Sync local library to attached iOS device with configurable filters and caps
status: To Do
assignee: []
created_date: '2026-05-06 02:24'
updated_date: '2026-11-15T05:40:00Z'
labels:
  - feature
  - macos
  - library
  - usb
  - sync
  - feature-freeze
dependencies:
  - TASK-214
  - TASK-393.28
priority: high
ordinal: 52500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
After TASK-214 supplies a usable attached-device source and detach events, add one-way local-to-device sync with composable include/exclude rules, limits, preview and progress. Zig owns filter composition, caps, sync planning, idempotence, cancellation and removal policy. Rust may expose justified device/file-transfer primitives but must not own a second sync engine or read mt.db. Retain the existing task's specific play-count/age/recent-addition filters and album/artist/track/byte caps. Destructive operations require an explicit reviewed plan/dry-run and must remain confined to the configured sync destination; never delete source-library media. Scheduling: feature work is frozen until TASK-393.28 verifies Zig-first completion; TASK-393 is the initiative. Do not start this task during the freeze or implement it as a side effect of a migration task. Bugfixes require their own explicit scope. When released, read TASK-369.5's ownership ADR and then-current APIs, research the current system and record a bounded plan. Zig owns domain policy and persistence; Rust is only the Tauri/native or named-library adapter. Existing behavior remains the migration baseline until this feature is scheduled.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Sync runs only on macOS and only when TASK-214 supplies a usable destination and connection state through the approved platform capability
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
- [ ] #17 Zig owns the sync engine and exposes its API through the approved engine contract; Rust only supplies justified native/file-transfer primitives
- [ ] #18 Unit tests cover filter composition, cap enforcement, removal logic, and dry-run behavior
- [ ] #19 User documentation added to docs/ covering rule semantics, defaults, and dry-run workflow
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-11-14 maintainer approved a feature freeze until the Zig refactor is complete. TASK-393.28 is now an explicit scheduling dependency. Any earlier Rust-domain implementation guidance is superseded by Zig-first ownership; preserved native/Tauri/library integration remains Rust where justified.
<!-- SECTION:NOTES:END -->
