---
id: TASK-270
title: Implement smart queries (dynamic filter-based playlists)
status: To Do
assignee: []
created_date: '2026-02-16 15:08'
updated_date: '2026-11-15T05:40:00Z'
labels:
  - feature
  - library
  - musicat-comparison
  - feature-freeze
dependencies:
  - TASK-393.28
priority: low
ordinal: 42500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add saved composable metadata-filter queries that evaluate dynamically as library data changes, with filter-builder UI and sidebar entries. Initial operators are equals, contains, greaterThan, lessThan, between and isEmpty; fields are genre, artist, album, year, play_count, duration, added_date and last_played. Zig owns filter validation, safe query construction, saved-query persistence and change invalidation using its library API. The frontend builds/displays filters and results; do not add Rust SQL or a parallel library-query engine. Scheduling: feature work is frozen until TASK-393.28 verifies Zig-first completion; TASK-393 is the initiative. Do not start this task during the freeze or implement it as a side effect of a migration task. Bugfixes require their own explicit scope. When released, read TASK-369.5's ownership ADR and then-current APIs, research the current system and record a bounded plan. Zig owns domain policy and persistence; Rust is only the Tauri/native or named-library adapter. Existing behavior remains the migration baseline until this feature is scheduled.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Smart Queries section in sidebar displays saved queries
- [ ] #2 Filter builder UI allows adding/removing filter rows with field, operator, value
- [ ] #3 Queries evaluate server-side via dynamic SQLite WHERE clauses
- [ ] #4 CRUD operations: create, edit, delete, rename smart queries
- [ ] #5 Query results load in library browser like regular sections
- [ ] #6 Results update dynamically when library changes
- [ ] #7 New smart_queries table with migration
- [ ] #8 Zig unit tests cover validated filter construction, parameter binding, operator/type errors and query results; no Rust SQL implementation is added
- [ ] #9 Playwright E2E test for creating and running a smart query
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-11-14 maintainer approved a feature freeze until the Zig refactor is complete. TASK-393.28 is now an explicit scheduling dependency. Any earlier Rust-domain implementation guidance is superseded by Zig-first ownership; preserved native/Tauri/library integration remains Rust where justified.
<!-- SECTION:NOTES:END -->
