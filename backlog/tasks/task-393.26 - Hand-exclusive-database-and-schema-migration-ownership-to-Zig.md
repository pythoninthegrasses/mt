---
id: TASK-393.26
title: Hand exclusive database and schema-migration ownership to Zig
status: To Do
assignee: []
created_date: '2026-11-15T05:36:00Z'
updated_date: '2026-11-15T05:42:00Z'
labels:
  - zig-first
  - migration
dependencies:
  - TASK-354
  - TASK-393.7
  - TASK-393.8
  - TASK-393.9
  - TASK-393.10
  - TASK-393.11
  - TASK-393.12
  - TASK-393.14
  - TASK-329
  - TASK-393.17
  - TASK-393.18
  - TASK-393.20
  - TASK-393.21
  - TASK-393.23
  - TASK-393.25
  - TASK-393.30
references:
  - crates/mt-core/src/db
  - crates/mt-tauri/src/db.rs
  - crates/mt-tauri/src/lib.rs
  - crates/mt-tauri/src/db_fixture_gen.rs
  - TASK-354
documentation:
  - docs/tauri-architecture.md
  - docs/testing.md
parent_task_id: TASK-393
priority: high
type: task
ordinal: 107500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
After all DB consumers have migrated, move schema initialization/migrations from Rust to Zig and retire the Rust SQLite stack. This is the explicit final single-migrator handoff, not permission for two concurrent migrators earlier. Preserve existing user data and fresh-install behavior. Include startup, fixture generation, diagnostics/evals and hidden direct callers; do not simply remove Cargo dependencies and hope tests compile. TASK-393 policy: feature freeze, bugfixes allowed, Zig owns domain rules/storage/orchestration; Rust only explicitly justified mature-library or OS capabilities. Preserve current behavior and data, add no deferred feature. Read TASK-369.5's ownership ADR and prerequisite outputs; research and record a bounded implementation plan before coding. Transfer every caller and equivalent behavioral coverage, delete replaced Rust policy and SQL, and update API/ownership docs. Use local fake services for automated tests; no live account, credential dump, paid run or CI timing matrix is required.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Zig alone opens mt.db in production and owns schema creation/upgrades; Rust startup waits for engine readiness instead of creating/migrating the DB.
- [ ] #2 Fresh database, unversioned existing fixture, current version, unsupported newer version and interrupted/failed migration paths have safe tested outcomes; existing data is not reset.
- [ ] #3 All Rust Connection/with_conn callers including startup, agent/evals and fixture helpers are removed or replaced by engine operations; source and dependency audits find no production Rust SQL.
- [ ] #4 rusqlite, libsqlite3-sys and connection-pool dependencies are removed wherever no longer needed, with any remaining test-only dependency explicitly justified or replaced.
- [ ] #5 Fresh launch and an upgraded fixture work through the real shell; an unsuccessful upgrade leaves recoverable data and a clear error rather than a partially usable app.
- [ ] #6 Schema, fixture-generation, startup and troubleshooting docs describe Zig ownership; TASK-354's temporary Rust migrator instructions are explicitly retired.
<!-- AC:END -->
