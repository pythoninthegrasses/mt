---
id: task-253
title: Move now playing indicator from title column to status column
status: In Progress
assignee: []
created_date: '2026-02-04 06:52'
updated_date: '2026-02-04 07:55'
labels:
  - frontend
  - ui
  - library
dependencies: []
priority: medium
ordinal: 25500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Currently, the now playing symbol (▶) is displayed to the left of the track title in the Title column. This takes up space in the title cell and can cause the title text to shift or truncate.

Move the now playing indicator to the # (status) column instead, replacing the track number when a track is playing. This is a common pattern in music players like iTunes/Apple Music where the track number becomes a speaker/play icon for the currently playing track.

**Current behavior:**
- Track number shows in # column
- Play symbol (▶) appears before track title: "▶ Strobe"

**Desired behavior:**
- Play symbol (▶) replaces track number in # column for currently playing track
- Track title displays without prefix: "Strobe"

This affects:
- Library view
- Now Playing view
- Playlist views
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Now playing indicator (▶) displays in # column instead of track number for currently playing track
- [ ] #2 Track title displays without play symbol prefix
- [ ] #3 Indicator appears correctly in library view, now playing view, and playlist views
- [ ] #4 When track stops playing, track number is restored in # column
<!-- AC:END -->
