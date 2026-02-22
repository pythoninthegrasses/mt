---
id: TASK-284
title: Fix loop-once not re-queuing current track
status: To Do
assignee: []
created_date: '2026-02-22 22:16'
labels:
  - bug
  - playback
  - loop
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Loop once mode fails to re-queue the current track when it ends. The track should restart from the beginning instead of advancing to the next track.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 When loop-once is active, the current track restarts when it ends
- [ ] #2 After restarting once, playback proceeds normally to the next track
- [ ] #3 Loop-once state is correctly cleared after the single repeat
- [ ] #4 Other loop modes (loop-all, no-loop) are unaffected
<!-- AC:END -->
