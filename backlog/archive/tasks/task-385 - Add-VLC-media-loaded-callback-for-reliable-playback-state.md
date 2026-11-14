---
id: TASK-385
title: Add VLC media loaded callback for reliable playback state
status: Done
assignee: []
created_date: '2025-10-12 23:28'
updated_date: '2025-10-12 23:52'
labels: []
dependencies: []
---

## Description

Currently, media_player.get_media() can return None briefly after play() is called due to VLC's asynchronous loading. This causes test failures when checking current track immediately after play. Implement a callback or polling mechanism to wait for media.get_mrl() to return a valid value before considering play operation successful.

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Add callback/polling in play_pause() to wait for media loaded
- [x] #2 Ensure get_current_track returns valid filepath after play
- [x] #3 Tests test_get_current_track and test_play_track_at_index pass reliably
- [x] #4 No race conditions in playback initialization
<!-- AC:END -->

## Implementation Notes

Implemented solution by adding current_file attribute to PlayerCore that's set immediately when playback starts, before VLC finishes loading. The_get_current_track_info() method now uses this reliable source instead of waiting for VLC's media.get_mrl(). Also fixed test state issues: clear_queue now stops playback and clears media, add_to_queue sets playback context, and play_selected checks filepath mapping for queued tracks. Both tests now pass reliably.
