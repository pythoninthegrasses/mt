---
id: TASK-354
title: Establish schema versions and single-migrator safety before Zig writes
status: Done
assignee:
  - OpenCode
created_date: '2026-09-11 00:38'
updated_date: '2026-11-15T07:34:00Z'
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
- [x] #1 A documented schema version represents the current existing schema and is checked by every database opener; version 0 is handled explicitly rather than assumed empty.
- [x] #2 Exactly one temporary Rust migrator initializes/upgrades the DB before Zig readiness; non-migrators refuse incompatible old/new versions with an actionable error.
- [x] #3 Fresh creation and upgrade of a populated unversioned fixture preserve tracks, relationships and settings; repeating startup does not reapply migrations destructively.
- [x] #4 Tests cover fresh, existing unversioned, current, unsupported newer/older and failed/interrupted upgrade cases, plus concurrent opener/migrator safety.
- [x] #5 A failed migration cannot advance the version or expose a partially migrated usable DB; transaction/locking and recoverability limitations are documented.
- [x] #6 docs/tauri-architecture.md and fixture-generation guidance explain the temporary migrator, required version checks and exclusive handoff owned by TASK-393.26.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Bounded plan (2026-11-15): 1. Establish version 1 for the existing schema in mt-core; keep Rust Database initialization as the sole production migrator until TASK-393.26. Treat version 0 as either empty or a legacy database, never reset it. 2. Run base creation, existing incremental upgrades and user_version advancement in one BEGIN IMMEDIATE transaction with a locked version recheck; skip all migration work at current version and reject other versions. Split legacy schema code into bounded files where touched. 3. Initialize before exposing pooled connections; check compatibility on pooled connections/checkouts and Zig read-only open before readiness. Audit fixture/tool openers and preserve shell startup ordering. 4. Add disposable populated legacy, fresh/current, incompatible, rollback/interruption and concurrent migration/opener tests; verify Rust and Zig compatibility. 5. Document schema contract, transaction/recovery limits, temporary ownership and fixture generation; run focused tests, then required available lint/test checks and make atomic commits. No capability transfer, new product feature, alternate migrator or fixture-runner overhaul (TASK-369.12).
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-11-14 re-scope: early safety prerequisite for TASK-393.6. New schema features are frozen; this task versions existing behavior. Do not let each port create its own migrator.

Implementation: added version-1 contract and sole atomic Rust initializer (BEGIN IMMEDIATE with locked recheck); file DBs migrate before pool creation, pool checkouts and new file connections validate compatibility, Zig checks before readiness, standalone Python agent refuses incompatible versions. New schema code is isolated in version.rs/version_test.rs; existing legacy schema helpers remain unchanged for regression tests rather than being mechanically split. Existing-fixture Zig tests now fail incompatible versions instead of silently skipping.

Validation so far: 11 focused Rust schema tests pass, including populated legacy preservation, late-failure rollback/retry, abrupt child-process exit recovery and concurrent startups/readers. cargo nextest run --workspace passed 1037 tests (3 skipped); task format, task lint, task zig:test and task zig:build passed. Added real sidecar pre-readiness rejection test; final rerun pending. Documentation records version semantics, lock/recovery/durability limits and exclusive TASK-393.26 handoff. Honcho unavailable (MCP session-not-found), so no memory write succeeded.

Final verification: task test passed 1038 Rust tests (3 skipped), 672 frontend tests and the Zig suite; task lint and task format passed; task zig:build passed. The real sidecar rejects versions -1/0/2 before publishing runtime readiness, emits recovery guidance, and preserves input data/version. Existing real-fixture Rust/Zig socket parity also passes with version 1. Python _connect was exercised against disposable DBs for -1/0/2 rejection and version-1 success using a fake Ollama client (no network).

AC evidence: #1 constants + compatibility checks in Rust/Zig/Python and schema-contract documentation; #2 pre-pool sole initializer plus existing shell spawn ordering and real sidecar pre-readiness rejection; #3 fresh/pool tests and populated legacy upgrade/repeat-startup track/favorite/playlist/queue/settings assertions; #4 version_test.rs plus Zig compatibility and real sidecar tests cover fresh/current/unversioned/older/newer/failure/interruption/concurrency; #5 injected late error verifies unchanged schema/version and safe retry, abrupt-process recovery and reader isolation tests, documented locking/durability limits; #6 architecture, Zig README and fixture-generator guidance updated. No user database was used for new verification. Cross-platform packages/real GUI launch were not exercised; TASK-369.12 fixture invocation repair and TASK-393.26 ownership transfer remain separate.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Established schema version 1 for the existing database. Rust remains the sole transactional startup migrator until TASK-393.26: BEGIN IMMEDIATE serializes startup, rechecks the version under lock, preserves populated version-0 data, and commits schema/backfills/version atomically. Pool and Zig/Python openers enforce compatibility; Zig refuses incompatible DBs before readiness without migration. Added legacy preservation, rollback/retry, interrupted-process recovery, concurrent startup/reader and real-sidecar tests; documented ownership, recovery limits and fixture rules. Verification: task test (1038 Rust passed, 3 skipped; 672 frontend passed; Zig passed), task lint, task format and task zig:build passed. No new feature or additional migrator; cross-platform packaging/GUI verification not claimed.
<!-- SECTION:FINAL_SUMMARY:END -->
