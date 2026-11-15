---
id: TASK-393.21
title: 'Move Plex configuration, catalog sync and library merge policy to Zig'
status: To Do
assignee: []
created_date: '2026-11-15T05:36:00Z'
labels:
  - zig-first
  - migration
dependencies:
  - TASK-393.10
  - TASK-393.7
  - TASK-393.3
references:
  - crates/mt-core/src/plex
  - crates/mt-tauri/src/plex
  - app/frontend/js/api/plex.js
  - TASK-342
documentation:
  - docs/tauri-architecture.md
  - docs/testing.md
parent_task_id: TASK-393
priority: high
type: task
ordinal: 102500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Move Plex server/library selection, catalog jobs, remote-track identity and local/remote merge policy to Zig. Preserve existing HTTPS/XML/client capabilities via a justified adapter if needed rather than handrolling them. Download-on-play belongs to TASK-393.22; no mobile sync or new source feature is included. TASK-393 policy: feature freeze, bugfixes allowed, Zig owns domain rules/storage/orchestration; Rust only explicitly justified mature-library or OS capabilities. Preserve current behavior and data, add no deferred feature. Read TASK-369.5's ownership ADR and prerequisite outputs; research and record a bounded implementation plan before coding. Transfer every caller and equivalent behavioral coverage, delete replaced Rust policy and SQL, and update API/ownership docs. Use local fake services for automated tests; no live account, credential dump, paid run or CI timing matrix is required.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Existing Plex configuration/server-library selection, catalog sync, remote identity and merge/update rules are authoritative in Zig using its settings and library storage.
- [ ] #2 Partial/offline sync or authentication failure cannot silently remove the entire remote library; current source-filter and remote visibility semantics remain intact.
- [ ] #3 Tests use a fake Plex catalog for pagination, duplicate/updated/deleted items, local/remote identity collisions, malformed response, cancellation and restart.
- [ ] #4 Frontend settings/library consumers use engine operations and events; superseded Rust orchestration/SQL is deleted, with only justified protocol/parser/transport capabilities retained.
- [ ] #5 An existing Plex-library workflow is verified with a local fixture service; docs describe credentials, progress, failure recovery and the separate playback/download task.
<!-- AC:END -->
