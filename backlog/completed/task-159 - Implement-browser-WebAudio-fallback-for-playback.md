---
id: task-159
title: Implement browser WebAudio fallback for playback
status: Done
assignee: []
created_date: '2026-01-17 00:15'
updated_date: '2026-02-03 05:51'
labels:
  - frontend
  - backend
  - dev-experience
dependencies: []
priority: low
ordinal: 32000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Overview

Currently, audio playback only works in Tauri via Rust commands (`audio_load`, `audio_play`, etc.). When running in a browser (Firefox, Chrome) for UI development/testing, `window.__TAURI__` is undefined and playback silently fails.

## Current State

In `player.js`:
```javascript
const { invoke } = window.__TAURI__?.core ?? { invoke: async () => console.warn('Tauri not available') };
```

The fallback `invoke` returns `undefined`, causing `playTrack()` to fail when accessing `info.duration_ms`.

## Proposed Solution

### Backend: Add streaming endpoint
Add `GET /api/tracks/{id}/stream` to the FastAPI sidecar:
- Looks up filepath by track ID in database
- Returns file as streaming response with correct MIME type
- Localhost-only for security

### Frontend: Detect environment and use appropriate backend
In `player.js`, detect `window.__TAURI__`:
- **Tauri present**: Use current Rust playback path (no changes)
- **Browser (no Tauri)**: Use `HTMLAudioElement` + `AudioContext` (WebAudio)

### WebAudio Implementation
- `load(track)` → set `audioEl.src = API_BASE + /tracks/{id}/stream`
- `play/pause/stop` → standard audio element methods
- `seek(positionMs)` → `audioEl.currentTime = positionMs/1000`
- Progress updates → `timeupdate` event (or 250ms timer to match Tauri cadence)
- Track ended → call `queue.playNext()`

## Files to Modify
- `app/backend/main.py` - Add `/api/tracks/{id}/stream` endpoint
- `app/frontend/js/stores/player.js` - Add browser fallback logic

## Notes
- This is for development/UI testing only
- Production builds will always use Tauri
- Consider abstracting playback into a strategy pattern for cleaner separation
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Backend: /api/tracks/{id}/stream endpoint returns audio file with correct MIME type
- [ ] #2 Frontend: Detects browser environment (no window.__TAURI__)
- [ ] #3 Frontend: Uses HTMLAudioElement for playback in browser
- [ ] #4 Play/pause/stop/seek work in browser
- [ ] #5 Progress updates emit at similar cadence to Tauri events
- [ ] #6 Track ended triggers queue.playNext()
- [ ] #7 Volume control works in browser
- [ ] #8 No changes to Tauri playback path
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Task closed without implementation. Browser WebAudio fallback was a dev-experience enhancement but not critical for production. Development and testing continue via Tauri dev mode.
<!-- SECTION:NOTES:END -->
