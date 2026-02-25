---
id: TASK-290
title: Sort artist view album listings by year ascending
status: To Do
assignee: []
created_date: '2026-02-25 22:39'
updated_date: '2026-02-25 22:40'
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
- [ ] #1 Albums in artist detail view are sorted by year ascending (oldest first)
- [ ] #2 Albums without year metadata appear at the end of the list
- [ ] #3 Sort order persists when switching between artists
<!-- AC:END -->
