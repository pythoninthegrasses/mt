---
id: task-232
title: 'E2E: Concurrent user action tests'
status: Done
assignee: []
created_date: '2026-01-28 05:40'
updated_date: '2026-01-29 22:01'
labels:
  - e2e
  - playback
  - P2
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add Playwright E2E tests for rapid sequential user actions to verify debouncing and edge case stability.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Rapid play/pause clicking is debounced correctly
- [x] #2 Double-click during pending action handled gracefully
- [x] #3 Multiple track selections in quick succession work
- [x] #4 Queue operations during playback transition are stable
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementation Summary

Created `app/frontend/tests/concurrent-actions.spec.js` with 17 E2E tests covering:

### Play/Pause Debouncing (3 tests)
- Rapid play/pause clicking results in consistent state
- Rapid play/pause does not corrupt player state
- Play/pause during track transition handles race conditions

### Double-Click During Pending Action (3 tests)
- Double-click during queue population does not duplicate tracks
- Rapid double-clicks on different tracks handle gracefully
- Double-click during shuffle toggle does not corrupt queue

### Multiple Track Selections (4 tests)
- Rapid single clicks update selection correctly
- Rapid shift-click selects contiguous range
- Rapid ctrl/cmd-click toggles multiple tracks
- Selection state remains valid during rapid interactions

### Queue Operations During Playback (5 tests)
- Adding tracks during track transition maintains state integrity
- Clearing queue during playback stops cleanly
- Removing current track advances gracefully
- Shuffle toggle during rapid next preserves queue integrity
- Loop mode change at track end handles boundary correctly

### Volume and Progress Interactions (2 tests)
- Rapid volume changes during playback state changes don't conflict
- Progress bar seek during track change doesn't cause position drift

All tests use mocked library data and verify state consistency through both Alpine store values and visual CSS class indicators.
<!-- SECTION:NOTES:END -->
