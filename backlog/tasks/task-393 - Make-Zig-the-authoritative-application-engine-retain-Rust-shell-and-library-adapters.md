---
id: TASK-393
title: >-
  Make Zig the authoritative application engine; retain Rust shell and library
  adapters
status: To Do
assignee: []
created_date: '2026-11-15T05:30:00Z'
updated_date: '2026-11-15T05:45:00Z'
labels:
  - zig-first
  - migration
  - feature-freeze
dependencies:
  - TASK-393.28
references:
  - TASK-369.5
  - TASK-353
  - TASK-355.6
  - TASK-354
  - TASK-329
  - TASK-369.12
documentation:
  - docs/tauri-architecture.md
  - docs/testing.md
  - zig-core/README.md
priority: high
type: task
ordinal: 500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Maintainer decision, 2026-11-14: Zig is the primary implementation language for application/domain logic. Rust remains for Tauri, OS integration, and named mature library capabilities whose replacement would require substantial handrolling; mature C libraries are allowed. This is greenfield software with effectively no userbase. Freeze new product features until this initiative is complete; bug fixes and migration-required refactors remain allowed. Preserve existing user-visible behavior and databases, but do not build a permanent dual-engine compatibility platform. Speed and footprint improvements are possible outcomes, not a language-selection gate. TASK-355 proves the narrow sidecar mechanics; TASK-353 provides a temporary Rust core inventory. No application migration is implemented by creating this backlog. Children are bounded work orders; existing TASK-369.5, TASK-354, TASK-369.12 and TASK-329 supply decision, schema safety, testing and session integration rather than duplicate tasks.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Zig is the sole authoritative owner of database access, library rules, queue/session policy, scanning/reconciliation, caches and service orchestration; every remaining Rust capability has a documented named-library or platform justification.
- [ ] #2 No production Rust SQL, rusqlite connection pool, duplicate domain implementation or temporary migration proxy remains; retained adapters cannot open mt.db or decide application policy.
- [ ] #3 Current music-library, playback, playlists, settings, scanning, Last.fm, Plex, lyrics, statistics and optional agent behavior works through the final boundary; no new product feature is required.
- [ ] #4 Focused Zig domain tests, Rust adapter tests, frontend tests and real-shell integration checks cover transferred behavior; deleted Rust tests have a recorded replacement or justified obsolete scope.
- [ ] #5 Existing databases and fresh installs work with one designated Zig migrator; failures, restart/shutdown, credentials and offline sources have explicit safe behavior.
- [ ] #6 All migration children and linked prerequisite tasks are complete; a final ownership and caller audit finds no unassigned production domain logic.
- [ ] #7 Contributor instructions, architecture, build, packaging and testing docs describe Zig-first accurately; completion evidence and remaining limitations are recorded before lifting the feature freeze.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Approved execution order, 2026-11-14: start TASK-369.5 (decision/ownership map). It enables TASK-393.1 (wire contract) and TASK-354 (schema-version safety). TASK-393.1 enables TASK-369.12 (isolated tests/fixture safety) and .2 (supervision); .3 then supplies native capability/event transport. .4/.5 finish existing library reads; .6 enables bounded writes. Follow dependency edges, not numeric suffix order.

Storage capabilities: .7 settings/watched folders; .8 favorites/loved state; .9 playlists/import/export; .10 track mutations/removed/dedup/revisions; .11 history/statistics; .12 scrobble outbox/lyrics persistence. Temporary Rust callers must use transferred APIs. Rust stays the sole migrator until .26; never duplicate the same domain operation in both engines.

Playback/native work: .13 audio primitives, .14 queue policy, .15 metadata/artwork primitives, .29 shared Zig artwork resolver, TASK-329 session/scrobble authority, .30 metadata-edit orchestration. Adapter libraries are justified exceptions, not permission to retain their surrounding domain policy.

Source/service work: .16 scan jobs, .17 dedup/reconciliation, .18 filesystem events, .19 media cache policy, .20 Last.fm, .21 Plex catalog, .22 Plex playback/download, .23 lyrics, .24 chart selection/rendering boundary, .25 optional agent policy. Each task consumes the earlier storage/adapter capabilities and deletes its replaced Rust implementation.

Completion: .26 transfers exclusive DB/migration ownership and removes the Rust SQLite stack; .27 deletes transitional code and updates contributor/build/test guidance; .28 verifies behavior/packaging and is the feature-release gate. All new product features depend on .28. Native/startup/artwork and focused library reliability bugfixes remain permitted; no unrequested feature may ride along with a port.

Worker contract: read current task, prerequisite outputs and TASK-369.5 before starting; mark only the chosen eligible task In Progress and record its current implementation plan. Keep one capability per reviewable change; use atomic commits and no backup files. Tests live with the authority: Zig for domain rules, Rust for retained primitives, Vitest for frontend state, real UI interactions for wiring. Do not delete tests without replacement evidence or accept mocked browser success as live engine proof.

Task creation audit: scanned active/archive/completed IDs in main and existing mt-369-6 worktree; both high-water marks were TASK-392 with no duplicates before auto-assigning TASK-393. No application code, builds, CI jobs or benchmark runs were started. TASK-369.6's pre-existing research was preserved while its expensive proposal was superseded. Final acceptance is ownership/correctness, not a measured language speedup.

Backlog preparation validation: all 30 migration children have parent links, explicit prerequisites, bounded capability scope, negative/error scenarios, replacement-test and deletion/documentation gates. Static audit found no duplicate IDs, missing dependency IDs or cycles; all 11 frozen feature tasks depend on TASK-393.28. Backlog ready filtering exposes TASK-369.5 as the first migration task alongside allowed TASK-369.6/TASK-391/TASK-392 repairs. task lint and task format passed; the lint command ran its normal Rust clippy compilation, not a refactor, benchmark or CI run. Application/runtime migration criteria remain unchecked.
<!-- SECTION:NOTES:END -->
