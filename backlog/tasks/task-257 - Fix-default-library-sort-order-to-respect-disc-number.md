---
id: task-257
title: Fix default library sort order to respect disc number
status: In Progress
assignee: []
created_date: '2026-02-06 01:21'
updated_date: '2026-02-06 01:49'
labels:
  - frontend
  - bug
  - regression
  - sorting
dependencies: []
priority: high
ordinal: 7875
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The default sort order in the music library view is broken — track ordering within an album is incorrect and has regressed recently.

**Expected default sort order (supersedence):**
1. Artist
2. Album
3. Disc number
4. Track number

This order must apply even when the disc number column is not visible.

**Repro:**
- Open the library (Music section)
- Look at the Clair Obscur soundtrack (3 discs) — tracks from different discs are interleaved incorrectly
- Compare Image 1 (current broken state: tracks within "Where's the Drop?" by Deadmau5 are out of order — 1, 9, 12, 10, 10, 13, 8, 5, 6, 15, 3, 4, 14, 2, 7, 11) vs Image 2 (known good: tracks are sequential 1-15)

**Notes:**
- Most albums have a single disc (or no disc number set), so they naturally fall through to track number sorting
- Multi-disc albums like the Clair Obscur soundtrack (3 discs) are the primary case where disc number matters
- This is a regression — the sort was working correctly before (see Image 2 with Artist ▲ sorted correctly)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Default sort order is: artist > album > disc number > track number
- [x] #2 Multi-disc albums (e.g., Clair Obscur 3-disc soundtrack) display tracks grouped by disc then ordered by track number
- [x] #3 Sort order applies regardless of whether disc number column is visible
- [x] #4 Single-disc albums still sort correctly by track number
- [x] #5 Clicking Artist column header produces correct sort with disc/track sub-sorting
<!-- AC:END -->
