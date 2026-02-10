---
id: task-253
title: Move now playing indicator from title column to status column
status: Done
assignee: []
created_date: '2026-02-04 06:52'
updated_date: '2026-02-05 04:44'
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

Move the now playing indicator to the # (status) column instead, displaying it alongside the track number rather than in the title. The track number should remain visible.

**Current behavior:**
- Track number shows in # column
- Play symbol (▶) appears before track title: "▶ Strobe"

**Desired behavior:**
- Play symbol (▶) displays in # column alongside track number (e.g., "▶ 5" or "5 ▶")
- Track title displays without prefix: "Strobe"
- Track number remains visible

This affects:
- Library view
- Now Playing view
- Playlist views
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Now playing indicator (▶) displays in # column alongside the track number for currently playing track
- [x] #2 Track number remains visible when track is playing (not replaced by indicator)
- [x] #3 Track title displays without play symbol prefix
- [x] #4 Indicator appears correctly in library view, now playing view, and playlist views
<!-- AC:END -->
