---
id: TASK-279
title: Last.fm bidirectional love sync and cache management
status: Done
assignee: []
created_date: '2026-02-17 23:49'
updated_date: '2026-02-17 23:49'
labels:
  - feature
  - lastfm
dependencies: []
references:
  - crates/mt-tauri/src/commands/favorites.rs
  - crates/mt-tauri/src/commands/lastfm.rs
  - crates/mt-tauri/src/lastfm/client.rs
  - crates/mt-tauri/src/lastfm/types.rs
  - crates/mt-tauri/src/db/library.rs
  - crates/mt-tauri/src/db/lastfm_loved.rs
  - app/frontend/views/settings.html
  - app/frontend/js/components/settings-view.js
  - app/frontend/js/api.js
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Bidirectional sync between local favorites and Last.fm loved tracks, plus cache reset functionality.

**Implemented:**

1. **Love/unlove on favorite toggle** (`commands/favorites.rs`): When a track is favorited/unfavorited locally, the action is synced to Last.fm in the background via `track.love`/`track.unlove` API calls. Uses `should_sync_lastfm()` to check for session key; silently skips if Last.fm is not connected. Non-blocking via `tauri::async_runtime::spawn`.

2. **`get_track_info()` for disambiguation** (`lastfm/client.rs`): Calls `track.getInfo` to get album title when multiple library tracks match the same artist+title (e.g., same song on studio album and greatest hits).

3. **Reset loved cache command** (`lastfm_reset_loved_cache`): Clears the `lastfm_loved_tracks` cache AND removes auto-favorited tracks (those with `matched_track_id`). Manually favorited tracks are preserved. Exposed in Settings > Last.fm as a destructive "Reset Cache" button with confirmation dialog.

4. **Tightened matching**: Exact case-insensitive only (no LIKE substring). Checks both `artist` and `album_artist` fields. Multi-match disambiguation via `track.getInfo` album lookup.

**Not yet implemented:**
- Periodic background re-sync of loved tracks cache
- Frontend display of disambiguation results/logs
- Handling Last.fm API rate limit errors in love/unlove (currently just warns)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 love_track() and unlove_track() added to LastFmClient
- [x] #2 favorites_add syncs love to Last.fm when session key present
- [x] #3 favorites_remove syncs unlove to Last.fm when session key present
- [x] #4 get_track_info() extracts album from track.getInfo for disambiguation
- [x] #5 find_tracks_by_artist_title returns Vec<Track> with exact match only
- [x] #6 lastfm_import_loved_tracks uses disambiguation for multi-match
- [x] #7 match_loved_tracks_impl is async with disambiguation
- [x] #8 match_new_tracks_against_loved uses exact case-insensitive equality
- [x] #9 lastfm_reset_loved_cache command clears cache and removes auto-favorited tracks
- [x] #10 Reset Cache button in Settings > Last.fm with confirmation dialog
- [x] #11 574+ tests pass, clippy clean with -D warnings
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added bidirectional Last.fm love sync: favorites_add/remove push track.love/track.unlove to Last.fm when session key is present. Added get_track_info() for multi-album disambiguation. Replaced find_track_by_artist_title with find_tracks_by_artist_title (exact match, returns Vec<Track>). Made match_loved_tracks_impl async with disambiguation. Fixed match_new_tracks_against_loved to use exact equality. Added lastfm_reset_loved_cache command that clears cache and unfavorites auto-matched tracks. Exposed as Reset Cache button in Settings > Last.fm with destructive styling and confirmation dialog. 574 tests pass, clippy clean.
<!-- SECTION:FINAL_SUMMARY:END -->
