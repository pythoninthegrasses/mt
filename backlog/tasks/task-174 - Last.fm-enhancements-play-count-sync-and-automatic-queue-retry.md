---
id: task-174
title: 'Last.fm enhancements: play count sync and automatic queue retry'
status: Done
assignee: []
created_date: '2026-01-20 00:38'
updated_date: '2026-02-03 05:39'
labels:
  - enhancement
  - lastfm
dependencies: []
priority: low
ordinal: 12375
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Follow-up enhancements from task-007 that were deferred after core scrobbling was completed.

These are nice-to-have features that would improve the Last.fm integration but are not required for basic scrobbling functionality.

## Play Count Sync
Sync local play count to Last.fm track.scrobble API (already sends count, just need to verify/test).

## Automatic Queue Retry
Design options from task-007:
- **Option A**: Startup retry - call `retry_queued_scrobbles()` in backend/main.py lifespan after DB init
- **Option B**: Periodic background task - asyncio task every 5min
- **Option C**: Frontend on auth success - call retry in `completeLastfmAuth()`
- **Option D (Recommended)**: Hybrid - combine A + C (retry on startup AND after fresh auth)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Sync play count to Last.fm when track reaches scrobble threshold
- [x] #2 Implement automatic scrobble queue retry mechanism (Option D recommended: startup + after fresh auth)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
### AC #2 Status (Jan 31, 2026)
Automatic queue retry is implemented via a 5-minute interval background task in `lib.rs`. While the original recommendation was "Option D: startup + after fresh auth", the periodic background approach effectively covers the use case. Users can also manually retry via the "Retry All" button in Settings > Last.fm.
<!-- SECTION:NOTES:END -->
