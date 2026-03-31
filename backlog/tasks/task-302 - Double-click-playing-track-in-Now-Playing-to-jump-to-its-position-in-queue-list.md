---
id: TASK-302
title: >-
  Double-click playing track in Now Playing to jump to its position in queue
  list
status: Done
assignee: []
created_date: '2026-03-31 03:37'
updated_date: '2026-03-31 04:34'
labels:
  - enhancement
  - ux
  - now-playing
dependencies: []
priority: low
ordinal: 2250
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
In the Now Playing view, double-clicking the currently playing track (album art / track info area on the left) should scroll to and highlight that track's position in the queue list on the right side of the view.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Double-clicking the currently playing track info in Now Playing scrolls the queue list to show the current track
- [x] #2 The current track is visually highlighted after scrolling
- [x] #3 Works correctly when queue is long and current track is scrolled out of view
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Changes

### `app/frontend/js/components/now-playing-view.js`
- Added `scrollToCurrentTrack()` method that smooth-scrolls the queue list to top (where the current track always lives in `playOrderItems`) and triggers a highlight flash animation after scrolling completes
- Uses `scrollend` event where supported, with 300ms timeout fallback

### `app/frontend/views/now-playing.html`
- Added `@dblclick="scrollToCurrentTrack()"` to both layout variants (no-lyrics and with-lyrics) on the track info/art area
- Added `cursor-pointer` class and tooltip for discoverability

### `app/frontend/styles.css`
- Added `.queue-highlight-flash` class with a 0.6s ease-out animation that flashes the primary color at higher opacity then settles back to the normal current-track highlight
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Double-clicking the currently playing track's album art or info area in the Now Playing view now smooth-scrolls the queue list to reveal the current track and plays a brief highlight flash animation. Works in both the standard (no lyrics) and lyrics layout modes.
<!-- SECTION:FINAL_SUMMARY:END -->
