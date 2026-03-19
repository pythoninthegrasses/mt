---
id: TASK-290
title: Sort artist view album listings by year ascending
status: Done
assignee: []
created_date: '2026-02-25 22:39'
updated_date: '2026-02-25 23:00'
labels:
  - frontend
  - ux
  - artists-browser
dependencies: []
references:
  - app/frontend/js/components/artists-browser.js
  - app/frontend/js/utils/artist-utils.js
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Sort albums in the Artists browser detail view by release year in ascending order (oldest first).

**Current behavior**: Albums appear in an arbitrary order (likely alphabetical by album name or insertion order).

**Expected behavior**: Albums sorted by year ascending, e.g., 2009 > 2011 > 2015 > 2017.

**User story**: When viewing an artist like Zola Jesus, albums should appear with the oldest album first and newest last (chronological discography order).

**Implementation location**: `app/frontend/js/components/artists-browser.js` - the `selectedArtistAlbums` getter calls `groupTracksIntoAlbums()` utility. Sorting should happen after grouping.

**Note**: Albums without year metadata should appear at the end (or be handled gracefully).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Albums in artist detail view are sorted by year ascending (oldest first)
- [x] #2 Albums without year metadata appear at the end of the list
- [x] #3 Sort order persists when switching between artists
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Summary

Changed album sorting in artist detail view from year descending to year ascending (oldest first), with albums lacking year metadata appearing at the end.

## Changes

- `app/frontend/js/utils/artist-utils.js`: Modified `groupTracksIntoAlbums()` sort logic
  - Albums with year now sort ascending (oldest first)
  - Albums without year metadata now appear at the end of the list
  - Albums without year still sort alphabetically among themselves
  - Updated JSDoc to reflect new behavior

## Test Coverage

- Added `app/frontend/__tests__/artist-utils.test.js` with 4 test cases covering:
  - Year ascending sort order
  - Albums without year at end
  - Alphabetical sort among albums without year
  - Alphabetical tiebreaker for same year
<!-- SECTION:FINAL_SUMMARY:END -->
