---
id: TASK-354
title: Add a PRAGMA user_version migration guard
status: To Do
assignee: []
created_date: '2026-09-11 00:38'
labels: []
dependencies: []
type: chore
ordinal: 56500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Exactly one process must ever be allowed to run schema migrations, and that contract needs to be established while the codebase is still single-process and easy to reason about. crates/mt-tauri/src/db/schema.rs currently applies roughly 19 ALTER TABLE statements gated on PRAGMA table_info existence checks (around line 615), with no schema version number recorded anywhere. This works today because only one process ever opens mt.db, but any future architecture where a second process (a sidecar, a daemon) can also open the database turns concurrent migration attempts into a real corruption path. This task establishes PRAGMA user_version as the versioning contract now, independent of any sidecar work, so later work can build on a safe foundation rather than retrofitting one.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Schema version is written and read via PRAGMA user_version rather than ad hoc table_info checks
- [ ] #2 A designated migrator path applies migrations and advances the version
- [ ] #3 Any opener that is not the designated migrator asserts a minimum required version and refuses to start if the database is below it, rather than silently proceeding
- [ ] #4 An existing un-versioned mt.db (version 0) upgrades cleanly to the current version
- [ ] #5 A downgrade attempt (newer expected version than the file has, and no migration path) fails loudly rather than silently corrupting or skipping
- [ ] #6 Tests cover fresh-create, upgrade-from-unversioned, and refusal-on-old-version paths
- [ ] #7 docs/tauri-architecture.md documents the versioning and single-migrator ownership contract
<!-- AC:END -->
