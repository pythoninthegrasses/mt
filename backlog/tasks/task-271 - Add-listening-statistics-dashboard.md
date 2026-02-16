---
id: TASK-271
title: Add listening statistics dashboard
status: To Do
assignee: []
created_date: '2026-02-16 16:12'
updated_date: '2026-02-16 21:10'
labels:
  - feature
  - ui
  - musicat-comparison
dependencies: []
priority: medium
ordinal: 44500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create a statistics/analytics view surfacing insights from data mt already collects (play_count, last_played, scrobble timestamps). Musicat comparison revealed this as a gap.

New db/stats.rs module with aggregate SQL queries. Show top artists/albums/genres by play count, total listening time, plays over time from scrobble_queue, genre distribution. New Statistics section in sidebar. Phase 1: text stat cards and ranked lists. Phase 2: add chart visualizations.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Statistics section appears in sidebar navigation
- [ ] #2 Overview shows total tracks, total duration, total plays
- [ ] #3 Top artists list ranked by play count with configurable limit
- [ ] #4 Top genres breakdown with play count and track count
- [ ] #5 Listening history shows plays over time from scrobble data
- [ ] #6 Stats cached and invalidated on play count updates
- [ ] #7 Rust unit tests for aggregate stat queries
- [ ] #8 Playwright E2E test for statistics view rendering
<!-- AC:END -->
