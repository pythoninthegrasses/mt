---
id: TASK-390
title: Chart grid shows top artists and skips candidates with no album artist
status: To Do
assignee: []
created_date: '2026-11-14T06:31:00Z'
updated_date: '2026-11-15T05:40:00Z'
labels:
  - statistics
  - chart-grid
  - backend
  - frontend
  - feature-freeze
dependencies:
  - TASK-393.28
references:
  - docs/builds.md
  - >-
    backlog/tasks/task-369.2 -
    Trim-or-replace-heavyweight-dependencies-behind-narrow-feature-use-chart-grid-image-stack.md
modified_files:
  - crates/mt-tauri/src/db/stats.rs
  - crates/mt-tauri/src/commands/stats.rs
  - app/frontend/js/components/stats-view.js
  - app/frontend/views/settings-stats.html
  - app/frontend/tests/statistics.spec.js
priority: high
type: feature
ordinal: 74500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Change chart semantics from album grouping to one distinct album artist per cell, ranked by that artist's plays in the selected range. Choose artwork from the artist's most-played album, skip missing/blank album artists and fill from next-ranked candidates when available. Zig owns ranking, grouping and selection using its statistics/artwork services; retained Rust image rendering receives explicit compositions, not SQL access. Frontend ordering controls and documentation must match artist semantics. Keep local/Plex eligibility. TASK-391 is the separate availability/cache bug and remains allowed during the freeze. Scheduling: feature work is frozen until TASK-393.28 verifies Zig-first completion; TASK-393 is the initiative. Do not start this task during the freeze or implement it as a side effect of a migration task. Bugfixes require their own explicit scope. When released, read TASK-369.5's ownership ADR and then-current APIs, research the current system and record a bounded plan. Zig owns domain policy and persistence; Rust is only the Tauri/native or named-library adapter. Existing behavior remains the migration baseline until this feature is scheduled.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Each cell represents one distinct album artist and a generated grid never shows the same artist label twice
- [ ] #2 Cells are ranked by play count attributed to that album artist over the selected date range
- [ ] #3 A cell's artwork is taken from a representative track of that artist's most-played album in the selected range
- [ ] #4 A placeholder cell prints the album artist name
- [ ] #5 Candidates whose album artist is missing, empty or whitespace-only are skipped and the next-ranked artist fills the cell so the grid reaches rows x columns whenever enough artists qualify
- [ ] #6 Local and remote (Plex) tracks remain eligible for cells
- [ ] #7 The UI's grid ordering options match artist-based ranking and no longer offer album-name ordering
- [ ] #8 Zig tests cover artist grouping, skip-and-advance and filling a grid despite missing album artists; retained Rust tests cover rendering primitives only
- [ ] #9 Existing chart-grid tests (per-MIME decode coverage and the golden image) are updated and pass; frontend tests for the grid's ordering control are updated
- [ ] #10 Documentation that describes the grid as album-based is updated
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-11-14 maintainer approved a feature freeze until the Zig refactor is complete. TASK-393.28 is now an explicit scheduling dependency. Any earlier Rust-domain implementation guidance is superseded by Zig-first ownership; preserved native/Tauri/library integration remains Rust where justified.
<!-- SECTION:NOTES:END -->
