---
id: TASK-393.15
title: Expose metadata and artwork library primitives behind Rust adapters
status: To Do
assignee: []
created_date: '2026-11-15T05:34:00Z'
labels:
  - zig-first
  - migration
dependencies:
  - TASK-393.3
references:
  - crates/mt-core/src/metadata
  - crates/mt-core/src/scanner
  - crates/mt-tauri/src/metadata.rs
  - crates/mt-tauri/src/scanner
  - TASK-391
documentation:
  - docs/tauri-architecture.md
  - docs/testing.md
parent_task_id: TASK-393
priority: high
type: task
ordinal: 96500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Retain lofty and justified image decoders rather than handroll tags/artwork. Expose read-tags, approved write-tags and embedded-artwork capabilities that return data/errors without querying SQLite. Zig owns selection, fallback and cache policy. This task provides primitives needed by scan/session ports, not the scanner or full artwork cache. Preserve fixes made by TASK-391. TASK-393 policy: feature freeze with bugfixes allowed, Zig-first application ownership, no new product features or timing matrices. Read TASK-369.5's ownership ADR and dependency outputs before starting; research then record a bounded implementation plan. Rust may wrap named mature libraries/OS facilities but cannot retain database access or domain orchestration. Port the named capability with caller rewiring, focused behavioral tests, deletion of replaced Rust policy and updated ownership/API docs. Do not silently absorb neighboring subsystems.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Rust metadata/artwork adapters expose the existing supported read/write/extract behavior and typed errors for invalid, missing, unreadable and unsupported files.
- [ ] #2 Adapters accept explicit bounded inputs, do not open mt.db, and do not decide track IDs, reconciliation, cache eviction or source selection.
- [ ] #3 Tag-write failure leaves the database unchanged until Zig explicitly commits a successful result; supported format coverage and any existing partial-file-write limitations are documented.
- [ ] #4 Adapter tests use isolated audio fixtures covering current formats, missing tags, Unicode paths, embedded/no artwork and write/read round trips; no private music collection is required.
- [ ] #5 Transferred callers use the private capability boundary; temporary policy still waiting on scanner/session/cache tasks is explicitly named instead of being retained as an undocumented adapter responsibility.
- [ ] #6 Ownership/API docs justify each retained library and explain allocation/blob lifetime, size limits and safe cancellation of long metadata operations.
<!-- AC:END -->
