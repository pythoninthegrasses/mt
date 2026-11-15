---
id: TASK-354
title: Establish schema versions and single-migrator safety before Zig writes
status: To Do
assignee: []
created_date: '2026-09-11 00:38'
updated_date: '2026-11-15T05:37:00Z'
labels:
  - zig-first
  - migration
  - database
dependencies:
  - TASK-369.5
priority: high
type: chore
ordinal: 56500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-393 is the approved Zig-first migration, with new features frozen and bugfixes allowed. Before Zig becomes writable, establish an explicit schema-version contract for existing unversioned and fresh databases. Rust remains the sole designated migrator during incremental ports; Zig checks compatibility and must not silently migrate in parallel. TASK-393.26 later transfers migration ownership to Zig. Preserve existing mt.db data, do not reset the DB or assume greenfield means disposable data. The old source path in this task predates mt-core extraction; locate the current schema owner before implementing.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A documented schema version represents the current existing schema and is checked by every database opener; version 0 is handled explicitly rather than assumed empty.
- [ ] #2 Exactly one temporary Rust migrator initializes/upgrades the DB before Zig readiness; non-migrators refuse incompatible old/new versions with an actionable error.
- [ ] #3 Fresh creation and upgrade of a populated unversioned fixture preserve tracks, relationships and settings; repeating startup does not reapply migrations destructively.
- [ ] #4 Tests cover fresh, existing unversioned, current, unsupported newer/older and failed/interrupted upgrade cases, plus concurrent opener/migrator safety.
- [ ] #5 A failed migration cannot advance the version or expose a partially migrated usable DB; transaction/locking and recoverability limitations are documented.
- [ ] #6 docs/tauri-architecture.md and fixture-generation guidance explain the temporary migrator, required version checks and exclusive handoff owned by TASK-393.26.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-11-14 re-scope: early safety prerequisite for TASK-393.6. New schema features are frozen; this task versions existing behavior. Do not let each port create its own migrator.
<!-- SECTION:NOTES:END -->
