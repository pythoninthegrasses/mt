---
id: TASK-393.5
title: 'Transfer library sections, track lookup and jump-offset reads to Zig'
status: To Do
assignee: []
created_date: '2026-11-15T05:32:00Z'
labels:
  - zig-first
  - migration
dependencies:
  - TASK-393.4
references:
  - crates/mt-core/src/library/queries.rs
  - crates/mt-core/src/library/section.rs
  - app/frontend/js/api/library.js
  - crates/mt-tauri/src/agent/tools.rs
documentation:
  - docs/tauri-architecture.md
  - docs/testing.md
  - zig-core/README.md
parent_task_id: TASK-393
priority: high
type: task
ordinal: 86500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A complete read boundary includes section dispatch, single/missing track lookup, prefix offsets and locating a track within the current sort/filter. These still pull Rust consumers toward live DB connections. Preserve the current offset API; TASK-350.3 is frozen future keyset work, not part of this port. TASK-393 policy: feature freeze until Zig-first completion; preserve current behavior and data, permit bugfixes, add no product features. Zig owns domain policy; retained Rust/C libraries expose narrow capabilities. This task owns only the named capability. Read the approved ownership ADR from TASK-369.5 and dependency outputs before starting; record a current implementation plan then. Transfer callers and behavioral coverage with the capability; delete its replaced Rust policy/queries when no caller remains, rather than leave an authoritative duplicate. Do not expand into a benchmark matrix or unrelated subsystem.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 All existing section types, single-track/missing-track reads, prefix lookup and track-offset lookup are provided by Zig with the current sort/filter semantics and not-found behavior.
- [ ] #2 Frontend navigation, play-context construction and agent/internal read callers use the transferred operations rather than direct Connection/with_conn reads.
- [ ] #3 Tests cover section dispatch, tied/null sort keys, missing IDs, non-ASCII prefixes, filter interactions and offset boundaries; the existing Rust read test suite is mapped to Zig replacements.
- [ ] #4 A real type-to-jump/go-to-track interaction and artist/album/playlist section load use the engine successfully; mocked store manipulation alone is not integration evidence.
- [ ] #5 Superseded Rust read wrappers, SQL and command branches are deleted when no longer needed; write-only helpers remain explicitly assigned to later migration tasks.
- [ ] #6 The ownership map records the complete read capability and docs distinguish the preserved offset API from deferred keyset pagination.
<!-- AC:END -->
