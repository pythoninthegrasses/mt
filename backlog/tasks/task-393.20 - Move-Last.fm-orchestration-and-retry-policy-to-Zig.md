---
id: TASK-393.20
title: Move Last.fm orchestration and retry policy to Zig
status: To Do
assignee: []
created_date: '2026-11-15T05:36:00Z'
labels:
  - zig-first
  - migration
dependencies:
  - TASK-393.12
  - TASK-393.8
  - TASK-393.7
  - TASK-393.3
references:
  - crates/mt-core/src/lastfm
  - crates/mt-tauri/src/lastfm
  - crates/mt-tauri/src/commands/lastfm.rs
  - docs/lastfm.md
documentation:
  - docs/tauri-architecture.md
  - docs/testing.md
parent_task_id: TASK-393
priority: high
type: task
ordinal: 101500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Zig should own auth-flow state, now-playing submission, scrobble outbox retries and loved-track synchronization. Retain only narrowly justified HTTPS/signing/credential capabilities; do not handroll TLS or move secrets into the browser. Playback eligibility stays in TASK-329, not this network worker. Preserve existing service behavior without adding new Last.fm features. TASK-393 policy: feature freeze, bugfixes allowed, Zig owns domain rules/storage/orchestration; Rust only explicitly justified mature-library or OS capabilities. Preserve current behavior and data, add no deferred feature. Read TASK-369.5's ownership ADR and prerequisite outputs; research and record a bounded implementation plan before coding. Transfer every caller and equivalent behavioral coverage, delete replaced Rust policy and SQL, and update API/ownership docs. Use local fake services for automated tests; no live account, credential dump, paid run or CI timing matrix is required.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Current auth, now-playing, scrobble submission/retry and loved-track sync behavior is orchestrated by Zig using transferred persistence; Rust contains no parallel scheduler or DB access.
- [ ] #2 Credentials/session tokens are retained only in their approved secure location, redacted in logs/errors and not exposed in frontend snapshots or generic adapter messages beyond necessity.
- [ ] #3 Tests with a fake Last.fm service cover success, invalid auth, offline/retry, rate-limit/transient error and permanent rejection without losing pending outbox records.
- [ ] #4 Duplicate/reordered service replies and process restart do not incorrectly mark unsent plays submitted; documented retry/idempotency limits are honest about external API guarantees.
- [ ] #5 Existing Last.fm settings/login and submission flows work through the engine; docs/lastfm.md and the ownership map describe the final adapter and eligibility boundary.
<!-- AC:END -->
