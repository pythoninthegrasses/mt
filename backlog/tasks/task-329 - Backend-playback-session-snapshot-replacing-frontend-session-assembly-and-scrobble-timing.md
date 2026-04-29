---
id: TASK-329
title: >-
  Backend playback session snapshot replacing frontend session assembly and
  scrobble timing
status: To Do
assignee: []
created_date: '2026-04-13 03:20'
updated_date: '2026-04-29 05:12'
labels:
  - backend
  - player
  - frontend
  - playback
milestone: m-2
dependencies:
  - TASK-328
references:
  - app/frontend/js/stores/player.js
  - crates/mt-tauri/src/commands/audio.rs
  - crates/mt-tauri/src/audio/engine.rs
  - crates/mt-tauri/src/commands/lastfm.rs
  - crates/mt-tauri/src/events.rs
priority: medium
ordinal: 1429.6875
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The player store (`app/frontend/js/stores/player.js`, 477 lines) currently assembles playback session state from multiple sources: it listens to audio engine events for position/duration, maintains its own `currentTrack` with metadata from the library query, loads artwork separately (with embedded/external/placeholder fallback chain), manages scrobble timing, and reconstructs the full "now playing" state by combining data from the queue store and audio events. This assembly logic is the final piece of frontend business logic that should move to the backend.

### Current architecture (to be replaced)

**Session state assembly** in `player.js`:
- `currentTrack` is set from multiple paths: queue store's `currentTrack` getter, direct `playTrack()` calls, or restored from persisted state
- Track metadata (artist, album, title, duration) comes from the library DB via a separate query when a track starts
- Artwork loading at `player.js:280-340`: tries embedded artwork extraction, then external file lookup, then placeholder — 3 async operations chained with fallbacks
- Playback position tracking: listens to `audio://position` events and locally tracks `currentTime` and `duration`
- Scrobble timing: frontend tracks elapsed playback time and triggers Last.fm scrobble at 50% or 4 minutes

**Now-playing metadata** is assembled from:
1. Queue store's current track (has track_id, file_path)
2. Library query for full metadata (title, artist, album, track_number, etc.)
3. Artwork resolution (embedded/external/placeholder)
4. Audio engine state (playing/paused, position, duration)
5. Queue context (current index, total tracks, shuffle state, loop mode)

This assembly happens across `player.js`, `queue.js`, and the component layer — making it hard to guarantee consistency.

### Target architecture

The backend maintains a complete `PlaybackSession` that is the single source of truth for everything the UI needs to display the now-playing view:

```rust
#[derive(serde::Serialize, Clone)]
pub struct PlaybackSession {
    // Track info
    pub track: Option<Track>,           // Full track metadata
    pub artwork_url: Option<String>,    // Resolved artwork (data URL or file:// path)
    
    // Queue context
    pub queue_position: i64,            // Current index in queue
    pub queue_total: i64,               // Total tracks in queue
    pub shuffle_enabled: bool,
    pub loop_mode: String,
    
    // Playback state
    pub is_playing: bool,
    pub position_secs: f64,
    pub duration_secs: f64,
    
    // Scrobble state (backend-tracked)
    pub scrobble_eligible: bool,        // Has played past 50% or 4 min
    pub scrobble_submitted: bool,       // Already scrobbled this track
}
```

**New commands:**

```rust
#[tauri::command]
pub async fn player_get_session(...) -> Result<PlaybackSession, ...>
// Returns the current complete session — used for initial load and recovery

// Existing commands (audio_play, audio_pause, etc.) already modify backend state.
// After each state change, the backend emits player://session-changed with the updated PlaybackSession.
```

### Rust implementation guidance

**Centralize session state** in a new `PlaybackSessionManager` (or extend the existing `AudioEngine` state):
- Create `crates/mt-tauri/src/player/session.rs` (or similar)
- The session manager holds the current `PlaybackSession` in an `Arc<Mutex<...>>`
- When audio engine reports track change: update session's track metadata + reset position + resolve artwork
- When audio engine reports position: update session's position_secs, check scrobble threshold
- When queue state changes (from TASK-328): update session's queue context fields

**Artwork resolution** — move from frontend to backend:
- Currently in `player.js:280-340` with async fallback chain
- Backend equivalent: `lofty` crate (already a dependency) to extract embedded artwork -> check for `cover.jpg`/`folder.jpg` in track directory -> return placeholder path
- Return artwork as a `file://` URL or base64 data URL that the webview can display directly

**Scrobble integration**:
- Backend already has Last.fm integration (`crates/mt-tauri/src/commands/lastfm.rs`)
- Move scrobble timing logic to backend: when `position_secs` crosses 50% of `duration_secs` or 240s, set `scrobble_eligible = true` and trigger the scrobble command internally
- Frontend no longer tracks elapsed time for scrobble purposes

**Events**: `player://session-changed` emitted on every state change. For high-frequency updates (position), throttle to ~1Hz to avoid flooding the IPC channel.

**Session persistence**: On app quit, persist the session to DB (or Tauri settings). On launch, `player_get_session` restores the last known state (paused at last position).

### Frontend changes

- `app/frontend/js/stores/player.js`: Gut the state assembly logic (~300 lines):
  - Remove `currentTrack` management (multiple assignment paths)
  - Remove artwork loading fallback chain
  - Remove position tracking from audio events (backend sends throttled position)
  - Remove scrobble timing logic
  - Remove session reconstruction on init
- Keep: UI-only state (volume level, mute toggle, seek-bar drag state, fullscreen mode)
- Keep: `invoke` wrappers for play/pause/seek/volume (these are user actions, not state)
- Add: Single event listener for `player://session-changed` that updates all reactive state from the snapshot
- Add: `init()` calls `invoke('player_get_session')` to hydrate on launch

### Existing code to modify
- `app/frontend/js/stores/player.js` — session assembly, artwork, scrobble timing
- `crates/mt-tauri/src/commands/audio.rs` — extend to emit session events after state changes
- `crates/mt-tauri/src/audio/engine.rs` — extend to report state changes to session manager
- `crates/mt-tauri/src/commands/lastfm.rs` — scrobble trigger moves here from frontend
- `crates/mt-tauri/src/events.rs` — add player://session-changed event
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A single invoke('player_get_session') returns the complete playback session: current track metadata, queue context (current/total, shuffle, loop), playback state (playing/paused, position, duration), and artwork URL
- [ ] #2 Frontend player.js store no longer assembles session state from multiple sources — it applies the session snapshot directly
- [ ] #3 Backend emits player://session-changed event on any state change (track change, play/pause, position update, queue state change)
- [ ] #4 Frontend player.js store is reduced to: event listeners for session snapshots, UI-only state (volume slider position, seek drag state), and invoke wrappers
- [ ] #5 Artwork loading (embedded/external/placeholder fallback) is resolved by the backend and returned as a data URL or file path in the session snapshot
- [ ] #6 Now-playing metadata updates (artist, album, title) come exclusively from the session snapshot — no separate metadata fetch in frontend
- [ ] #7 Session restore on app launch uses a single invoke('player_get_session') instead of separate queue restore + track metadata + playback state reconstruction
- [ ] #8 Rust tests cover: session snapshot contains correct track metadata; session updates on track change; session reflects pause/play state; artwork fallback chain (embedded -> external -> placeholder); session restore from persisted state
- [ ] #9 Frontend Vitest tests verify: player store applies session snapshot correctly; UI-only state (volume, seek drag) is preserved across session updates; session event updates current track display
- [ ] #10 Last.fm scrobble timing is driven by backend playback position tracking — frontend no longer tracks elapsed time for scrobble threshold
<!-- AC:END -->
