---
id: task-208
title: >-
  Cache Last.fm loved tracks for automatic favoriting of future library
  additions
status: To Do
assignee: []
created_date: '2026-01-25 23:14'
updated_date: '2026-01-28 08:16'
labels:
  - lastfm
  - database
  - enhancement
  - auto-favorite
  - cache
dependencies: []
priority: medium
ordinal: 7906.25
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

When importing Last.fm loved tracks, most tracks aren't in the local library yet (9821 out of 9852 tracks not found). This means:
- Users need to manually re-import after adding new music
- No automatic favoriting when new tracks are added to the library
- API quota wasted on repeated full imports

## Proposed Solution

Create a `lastfm_loved_tracks` database table to cache loved tracks from Last.fm:

```sql
CREATE TABLE lastfm_loved_tracks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    artist TEXT NOT NULL,
    track TEXT NOT NULL,
    timestamp INTEGER,  -- Unix timestamp when loved
    matched_track_id INTEGER,  -- NULL if not yet in library
    last_checked_at INTEGER,  -- When we last tried to match
    UNIQUE(artist, track),
    FOREIGN KEY(matched_track_id) REFERENCES library(id)
);
```

### Workflow

1. **Import**: Fetch loved tracks from Last.fm → store in `lastfm_loved_tracks`
2. **Match existing**: Cross-reference with local library → update `matched_track_id` + add to favorites
3. **Auto-match new tracks**: When scanner adds tracks, check against cached loved tracks → auto-favorite matches
4. **Periodic sync**: Background task to re-check unmatched tracks (e.g., weekly)

### Benefits

- One-time API fetch (respects rate limits)
- Automatic favoriting when new music is added
- Track which loved tracks are still missing
- Show stats: "X of Y loved tracks in library"

## Implementation Details

**Database Schema:**
- New table: `lastfm_loved_tracks`
- Index on `(artist, track)` for fast lookups
- Index on `matched_track_id IS NULL` for unmatched tracks

**Scanner Integration:**
- After adding new tracks, run match query against unmatched loved tracks
- Update `matched_track_id` and add to favorites automatically

**UI Improvements:**
- Show import progress: "Importing 9852 loved tracks..."
- Show match stats: "36 of 9852 loved tracks in library"
- Option to view unmatched tracks
- Button to "Check for new matches" without re-fetching from API

**API Efficiency:**
- Only fetch from Last.fm once or when user explicitly requests refresh
- Use `user.getLovedTracks` pagination efficiently
- Store timestamp to support incremental updates later

## References

- Current import: `src-tauri/src/commands/lastfm.rs:lastfm_import_loved_tracks`
- Scanner: `src-tauri/src/scanner/commands.rs`
- Database: `src-tauri/src/db/schema.rs`
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Create lastfm_loved_tracks database table with proper indexes
- [ ] #2 Implement import command to fetch and cache loved tracks from Last.fm
- [ ] #3 Add matching logic to cross-reference cached tracks with local library
- [ ] #4 Integrate with scanner to auto-favorite newly added tracks that match cached loved tracks
- [ ] #5 Add UI to show import progress and match statistics
- [ ] #6 Implement periodic background sync for unmatched tracks
- [ ] #7 Add manual "Check for new matches" button without API re-fetch
- [ ] #8 Handle incremental updates when new tracks are loved on Last.fm
- [ ] #9 Add database migration for existing installations
<!-- AC:END -->
