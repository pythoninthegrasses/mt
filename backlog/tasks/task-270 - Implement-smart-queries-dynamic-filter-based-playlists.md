---
id: task-270
title: Implement smart queries (dynamic filter-based playlists)
status: In Progress
assignee: []
created_date: '2026-02-16 15:08'
updated_date: '2026-02-16 16:13'
labels:
  - feature
  - library
  - musicat-comparison
dependencies: []
priority: low
ordinal: 22500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add composable metadata filter queries that create dynamic playlists (e.g. "genre contains Jazz AND year > 2010 AND play_count > 5"). Musicat's standout feature - most architecturally significant improvement.

Extend LibraryQuery in db/library.rs to accept composable filter predicates with dynamic SQL construction. New smart_queries table (id, name, filters_json, created_at). CRUD commands following playlist command patterns. Filter builder UI in frontend. Smart queries appear in sidebar alongside playlists. Initial operators: equals, contains, greaterThan, lessThan, between, isEmpty. Initial fields: genre, artist, album, year, play_count, duration, added_date, last_played.
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
- [ ] #8 Rust unit tests for dynamic SQL filter construction
- [ ] #9 Playwright E2E test for creating and running a smart query
<!-- AC:END -->
