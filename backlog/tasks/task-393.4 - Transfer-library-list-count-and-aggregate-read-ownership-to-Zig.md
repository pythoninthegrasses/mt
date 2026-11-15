---
id: TASK-393.4
title: 'Transfer library list, count and aggregate read ownership to Zig'
status: To Do
assignee: []
created_date: '2026-11-15T05:32:00Z'
labels:
  - zig-first
  - migration
dependencies:
  - TASK-393.1
  - TASK-393.2
  - TASK-369.12
references:
  - crates/mt-core/src/library/queries.rs
  - crates/mt-core/src/db/library.rs
  - app/frontend/js/api/library.js
  - crates/mt-tauri/src/shadow_diff.rs
documentation:
  - docs/tauri-architecture.md
  - docs/testing.md
  - zig-core/README.md
parent_task_id: TASK-393
priority: high
type: task
ordinal: 85500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The existing GET /api/library port is additive. Make the list/count/duration-statistics capability authoritative in Zig, preserving current filters, sorting and pagination. Port existing behavior, not keyset pagination or smart queries. TASK-393.5 owns sections and track/offset lookup. Existing Rust mutations may continue temporarily but must use the transferred read interface. TASK-393 policy: feature freeze until Zig-first completion; preserve current behavior and data, permit bugfixes, add no product features. Zig owns domain policy; retained Rust/C libraries expose narrow capabilities. This task owns only the named capability. Read the approved ownership ADR from TASK-369.5 and dependency outputs before starting; record a current implementation plan then. Transfer callers and behavioral coverage with the capability; delete its replaced Rust policy/queries when no caller remains, rather than leave an authoritative duplicate. Do not expand into a benchmark matrix or unrelated subsystem.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Track listing, filtered counts and duration totals match current behavior for local/Plex filters, artist/album/search, missing values, supported sorts and limit/offset boundaries.
- [ ] #2 Supported Unicode ignore-word behavior is preserved or a maintainer-approved documented correction closes the known ASCII-only divergence; a fixture merely containing ASCII is not universal parity evidence.
- [ ] #3 Frontend and Rust/background consumers of these operations use Zig; equivalent Rust list/count/aggregate implementations and their command registration are removed when no longer referenced.
- [ ] #4 Zig tests cover filters, sort ties, empty results, pagination and large IDs against an isolated populated fixture; existing parity coverage is transferred before deleting duplicate tests.
- [ ] #5 A real frontend library load and count/stat update are exercised against the engine; no future keyset API or new feature is implemented.
- [ ] #6 Ownership map and API documentation identify deleted code and any temporary DB write callers that legitimately remain.
<!-- AC:END -->
