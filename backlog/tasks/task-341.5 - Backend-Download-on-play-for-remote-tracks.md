---
id: TASK-341.5
title: 'Backend: Download-on-play for remote tracks'
status: To Do
assignee: []
created_date: '2026-05-21 22:58'
labels: []
dependencies:
  - TASK-341.2
parent_task_id: TASK-341
ordinal: 57500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Intercept playback of remote (Plex) tracks and download them to the local filesystem before playing.

**Flow:**
1. `audio_load` / `audio_load_and_play` receives a track with `filepath` starting with `http://` or `https://`
2. Download hook triggers:
   a. Parse the stream URL to extract artist, album, title, extension
   b. Construct local path: `~/Music/<Artist>/<Album>/<TrackNumber> - <Title>.<ext>`
   c. If local file already exists → skip download, use local path directly
   d. Download the stream using reqwest (authenticated with X-Plex-Token)
   e. Write to disk with progress reporting via Tauri event
   f. On success: update track's `filepath` in DB from URL to local path
   g. Return the local path to the audio engine
3. Audio engine plays the local file via existing `rodio::Decoder::try_from(file)` path

**Key decisions:**
- The `filepath` column in the DB is repurposed: initially holds the stream URL, after download holds the local path
- The `source` column remains 'plex' even after download (tracks the origin)
- No re-download on subsequent plays — the local file persists

**Key files:**
- `crates/mt-tauri/src/commands/audio.rs` — audio_load / audio_load_and_play commands
- `crates/mt-tauri/src/audio/engine.rs` — AudioEngine::load() — entry point
- `crates/mt-tauri/src/cache/network_cache.rs` — existing download pattern to reuse
- `crates/mt-tauri/src/library/commands.rs` — update_track_filepath

Reference: `NetworkFileCache::get_or_cache()` in `cache/network_cache.rs` for the download-then-play pattern. Also see `audio_load` in `commands/audio.rs` for the entry point.

**Risk:** rodio's `Decoder::try_from` expects a `File`. The download hook must write to disk first, then pass the local path. This means the audio engine itself doesn't change — only the command layer intercepts URL paths.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 When audio_load or audio_load_and_play receives an http:// or https:// filepath, the download hook is triggered
- [ ] #2 Remote track is downloaded to ~/Music/<Artist>/<Album>/<TrackNumber> - <Title>.<ext>
- [ ] #3 Directory structure mirrors local library convention (Artist/Album/track format)
- [ ] #4 Download uses authenticated stream URL with X-Plex-Token
- [ ] #5 Download respects a configurable max file size to prevent runaway downloads (default 500MB)
- [ ] #6 On download success: filepath in DB is updated from stream URL to local filesystem path, source remains 'plex'
- [ ] #7 On download failure: track is marked as missing, user sees error toast
- [ ] #8 Subsequent playback of the same track uses the local file (no re-download)
- [ ] #9 Download progress is reported via Tauri event (percentage complete)
- [ ] #10 Download is done on a background thread (spawn_blocking) to not block the UI
- [ ] #11 Unit/integration test for download hook with a mock HTTP server
<!-- AC:END -->
