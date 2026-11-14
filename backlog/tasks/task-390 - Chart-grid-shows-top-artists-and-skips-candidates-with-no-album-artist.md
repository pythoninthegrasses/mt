---
id: TASK-390
title: Chart grid shows top artists and skips candidates with no album artist
status: To Do
assignee: []
created_date: '2026-11-14T06:31:00Z'
labels:
  - statistics
  - chart-grid
  - backend
  - frontend
dependencies: []
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
The chart grid reads as an artist chart but is built on an album query: it groups by album plus artist, so two unrelated compilations that share the album_artist "Various Artists" produced two visually identical cells, and the placeholder line prints only the artist name which made the duplicate labels the entire visible content. This feature is an artist chart; album charts are explicitly out of scope, so the album name is not wanted as a label either. Cells should be ranked per album artist, artwork should come from that artist's most-played album, and a candidate with no album artist should be dropped in favour of the next-ranked artist so a 3x3 grid shows nine distinct artists rather than blanks or repeats. Diagnosed on a 39,895-row library where every source was momentarily unreachable (9,812 local tracks on an unmounted volume and 30,083 Plex tracks on an offline host), which forced all nine cells onto the placeholder; the artwork itself was not the defect.
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
- [ ] #8 Rust tests cover artist grouping; the skip-and-advance rule; and a full grid when some candidates lack an album artist
- [ ] #9 Existing chart-grid tests (per-MIME decode coverage and the golden image) are updated and pass; frontend tests for the grid's ordering control are updated
- [ ] #10 Documentation that describes the grid as album-based is updated
<!-- AC:END -->
