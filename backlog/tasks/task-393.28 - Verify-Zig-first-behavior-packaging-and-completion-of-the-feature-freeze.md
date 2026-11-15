---
id: TASK-393.28
title: 'Verify Zig-first behavior, packaging and completion of the feature freeze'
status: To Do
assignee: []
created_date: '2026-11-15T05:36:00Z'
labels:
  - zig-first
  - migration
dependencies:
  - TASK-393.27
  - TASK-393.2
  - TASK-393.3
  - TASK-329
  - TASK-369.12
references:
  - TASK-393
  - docs/testing.md
  - docs/builds.md
  - zig-core/README.md
documentation:
  - docs/tauri-architecture.md
  - docs/testing.md
parent_task_id: TASK-393
priority: high
type: task
ordinal: 109500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The freeze ends only when the authoritative engine and retained adapters work as a product, not when source files have moved. Consolidate capability evidence, verify real boundary flows and packaging, and document honest platform limits. This is a correctness gate using existing checks, not a platform/profile/cache benchmark matrix or an excuse to ship deferred features. TASK-393 policy: feature freeze, bugfixes allowed, Zig owns domain rules/storage/orchestration; Rust only explicitly justified mature-library or OS capabilities. Preserve current behavior and data, add no deferred feature. Read TASK-369.5's ownership ADR and prerequisite outputs; research and record a bounded implementation plan before coding. Transfer every caller and equivalent behavioral coverage, delete replaced Rust policy and SQL, and update API/ownership docs. Use local fake services for automated tests; no live account, credential dump, paid run or CI timing matrix is required.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A behavior checklist maps library browse/jump, mutations/playlists/settings, scan/watch/reconcile, queue/playback/session, artwork/charts, Last.fm, Plex, lyrics and optional agent to focused test evidence with no unassigned gaps.
- [ ] #2 At least one actual Tauri-webview flow proves frontend-to-Zig-to-Rust-capability round trips; fresh install, existing DB upgrade, engine unavailable, shutdown/relaunch and offline-source recovery are exercised.
- [ ] #3 Existing cross-platform build/package checks verify engine staging and target naming; applicable signing/notarization and Windows runtime-file security requirements from the ADR are verified or explicitly recorded as unresolved blockers, not marked passed by mocks.
- [ ] #4 Zig, retained Rust and frontend tests pass at their appropriate layers; credentials and private media are not needed for automated service tests, and test/runtime limitations are named.
- [ ] #5 Final ownership audit confirms no production Rust DB/domain fallback remains and all migration prerequisites/children are complete; no performance speedup is claimed without comparable measurements.
- [ ] #6 Completion summary records commands, revisions, actual runtime/platform evidence and remaining nonblocking bugs; only after these gates pass is TASK-393 marked Done and the feature-freeze dependencies released.
<!-- AC:END -->
