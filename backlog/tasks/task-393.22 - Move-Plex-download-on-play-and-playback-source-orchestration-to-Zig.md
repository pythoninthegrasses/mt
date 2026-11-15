---
id: TASK-393.22
title: Move Plex download-on-play and playback-source orchestration to Zig
status: To Do
assignee: []
created_date: '2026-11-15T05:36:00Z'
labels:
  - zig-first
  - migration
dependencies:
  - TASK-393.21
  - TASK-393.19
  - TASK-393.14
references:
  - crates/mt-core/src/plex
  - crates/mt-tauri/src/plex
  - crates/mt-tauri/src/audio
  - TASK-342.5
documentation:
  - docs/tauri-architecture.md
  - docs/testing.md
parent_task_id: TASK-393
priority: high
type: task
ordinal: 103500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A catalog-only port would leave playback policy in Rust. Transfer Plex playback URL resolution, download/cache state and coordination with the Zig queue while keeping byte transfer/decoding in approved primitives. Preserve existing download-on-play behavior; do not introduce streaming formats or a new cache engine. TASK-393 policy: feature freeze, bugfixes allowed, Zig owns domain rules/storage/orchestration; Rust only explicitly justified mature-library or OS capabilities. Preserve current behavior and data, add no deferred feature. Read TASK-369.5's ownership ADR and prerequisite outputs; research and record a bounded implementation plan before coding. Transfer every caller and equivalent behavioral coverage, delete replaced Rust policy and SQL, and update API/ownership docs. Use local fake services for automated tests; no live account, credential dump, paid run or CI timing matrix is required.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Selecting a remote track resolves/downloads/caches its playable source under Zig control and starts the current queue item through the audio adapter.
- [ ] #2 Changing tracks, canceling, signing out, offline server and expired URL/token cannot start stale audio, expose tokens or leave a partial file marked playable.
- [ ] #3 Tests use a local fake Plex/download service for cache hit, success, failure, cancellation, duplicate concurrent requests and current-item replacement.
- [ ] #4 Rust audio/transfer code receives explicit primitive inputs and does not own Plex queue policy or access mt.db; obsolete orchestrators are removed.
- [ ] #5 A real UI remote-track playback flow is recorded with deterministic fixture service or a separately documented manual check; ownership and cache docs reflect completion.
<!-- AC:END -->
