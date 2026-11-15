---
id: TASK-393.12
title: Transfer scrobble outbox and lyrics-cache persistence to Zig
status: To Do
assignee: []
created_date: '2026-11-15T05:33:00Z'
labels:
  - zig-first
  - migration
dependencies:
  - TASK-393.6
  - TASK-393.3
references:
  - crates/mt-core/src/db/scrobble.rs
  - crates/mt-core/src/db/lyrics.rs
  - crates/mt-tauri/src/lyrics.rs
documentation:
  - docs/tauri-architecture.md
  - docs/testing.md
parent_task_id: TASK-393
priority: high
type: task
ordinal: 93500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Last.fm and lyrics service workers need storage interfaces that do not leak Rust Connections. Transfer the persisted scrobble outbox/status and lyrics cache only; network requests, playback eligibility and lyrics parsing are separate tasks. Do not discard pending scrobbles or cached lyrics during the port. TASK-393 policy: feature freeze, bugfixes allowed; Zig owns application policy and mt.db access, Rust only justified library/platform capabilities. Preserve existing behavior/data; no new product feature or CI benchmark campaign. Read TASK-369.5's ownership ADR and prerequisites, then record a current implementation plan before coding. Transfer all callers of this capability and replace its Rust behavioral tests with focused Zig tests before deleting obsolete implementations. Keep this change to the named domain; record discovered gaps rather than silently port neighboring subsystems.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Pending scrobble enqueue/read/update/delete and existing lyrics-cache operations use Zig-owned storage with preserved identifiers, timestamps and payloads.
- [ ] #2 Existing Rust service callers use the engine API and no longer access SQL for these domains; duplicate persistence implementations are removed.
- [ ] #3 Tests cover outbox retry/status/reopen behavior, duplicate prevention according to current rules, lyrics hit/miss/update and rollback without live external services.
- [ ] #4 Network failures cannot delete pending work as if submitted successfully; cached instrumental/empty/not-found states remain distinguishable where current behavior requires it.
- [ ] #5 API and ownership documentation explicitly assigns scrobble eligibility to session policy and network submission/lyrics lookup to later service tasks.
<!-- AC:END -->
