---
id: TASK-296
title: Show LRCLIB lyrics in Now Playing view with caching
status: In Progress
assignee: []
created_date: '2026-03-08 02:09'
updated_date: '2026-03-08 02:18'
labels:
  - feature
  - frontend
  - backend
  - lrclib
dependencies: []
references:
  - 'crates/mt-tauri/src/db/schema.rs (lines 61-72: lyrics_cache table)'
  - 'crates/mt-tauri/src/db/models.rs (lines 150-161: LyricsCache struct)'
  - app/frontend/views/now-playing.html
  - app/frontend/js/components/now-playing-view.js
  - app/frontend/js/stores/player.js
documentation:
  - 'https://lrclib.net/docs'
  - >-
    https://github.com/taiko2k/tauon (t_lyrics.py for LRCLIB integration
    reference)
priority: medium
ordinal: 3000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Display lyrics fetched from LRCLIB (lrclib.net) in the Now Playing view, positioned between the album art and the queue list. Lyrics should only be fetched/displayed when the Now Playing view is in the foreground. Cache lyrics per-track in SQLite so each track's lyrics are fetched at most once.

## Context

The database infrastructure already exists:
- **`lyrics_cache` table** in `crates/mt-tauri/src/db/schema.rs` (lines 61-72): columns `id`, `artist`, `title`, `album`, `lyrics`, `source_url`, `fetched_at` with `UNIQUE(artist, title)`
- **`LyricsCache` model** in `crates/mt-tauri/src/db/models.rs` (lines 150-161): Rust struct matching the table
- No Tauri commands are wired up yet — the schema and model exist but the feature is not implemented

## LRCLIB API Reference

**Endpoint:** `GET https://lrclib.net/api/get`

**Required query params:**
- `track_name` (string) — track title
- `artist_name` (string) — artist name
- `album_name` (string) — album name
- `duration` (integer) — duration in seconds

**Response (200):**
```json
{
  "id": 12345,
  "trackName": "Bohemian Rhapsody",
  "artistName": "Queen",
  "albumName": "A Night at the Opera",
  "duration": 354.0,
  "instrumental": false,
  "plainLyrics": "Is this the real life?\nIs this just fantasy?",
  "syncedLyrics": "[00:00.00] Is this the real life?\n[00:04.50] Is this just fantasy?"
}
```

**Response (404):** `{"message": "Failed to find specified track", "name": "TrackNotFound", "statusCode": 404}`

The API performs fuzzy matching with normalized text and supports a duration tolerance of +/-2 seconds. Set a `User-Agent` header (e.g. `mt-desktop/1.0.0`).

## Reference: Tauon Music Box Implementation

Tauon's lyrics module (`t_lyrics.py`) fetches from LRCLIB as its primary synced lyrics source:
```python
params = {"track_name": title, "artist_name": artist}
headers = {"User-Agent": "TauonMusicBox/9.1.0"}
r = requests.get("https://lrclib.net/api/get", headers=headers, params=params, timeout=10)
if r.status_code == 200:
    data = r.json()
    plain_lyrics = data.get("plainLyrics", "")
    synced_lyrics = data.get("syncedLyrics", "")
```

Tauon sends only `track_name` and `artist_name` (not album/duration). For mt, send all four params for better matching accuracy since we have the data.

## Existing Now Playing Layout

**File:** `app/frontend/views/now-playing.html`
- Left panel: Album art (272x272) + track metadata (title, artist, album)
- Right panel: "Up Next" queue list (396px wide)

**Component JS:** `app/frontend/js/components/now-playing-view.js` — virtual scroll logic for queue

**Player store:** `app/frontend/js/stores/player.js` — `currentTrack`, `isPlaying`, `currentTime`, `duration`

## Implementation Plan

### Backend (Rust)

1. **Add lyrics DB functions** in `crates/mt-tauri/src/db/` — `get_cached_lyrics(artist, title)`, `save_lyrics(artist, title, album, lyrics, source_url)`
2. **Add LRCLIB HTTP client** — new module `crates/mt-tauri/src/lyrics.rs` (or similar)
   - Use `reqwest` to call `GET https://lrclib.net/api/get` with params `track_name`, `artist_name`, `album_name`, `duration`
   - Set `User-Agent: mt-desktop/<version>`
   - Timeout: 10 seconds
   - Handle 200 (parse JSON, return plainLyrics + syncedLyrics) and 404 (return None)
   - Cache negative results too (store empty lyrics) to avoid repeated lookups for tracks without lyrics
3. **Add Tauri commands:**
   - `lyrics_get(track_id: i64)` — check cache first, fetch from LRCLIB if miss, cache result, return lyrics
   - `lyrics_clear_cache()` — optional: clear all cached lyrics (for settings/debugging)
4. **Store both `plainLyrics` and `syncedLyrics`** — the `lyrics` column can store a JSON object or use two columns. Synced lyrics enable future time-synced highlighting.

### Frontend

5. **Add lyrics API** — new file `app/frontend/js/api/lyrics.js`
   - `getLyrics(trackId)` — calls `lyrics_get` Tauri command
   - `clearLyricsCache()` — calls `lyrics_clear_cache`
6. **Add lyrics store or extend player store** — track `lyrics`, `lyricsLoading`, `lyricsError` state
   - Watch `currentTrack` changes — fetch lyrics when track changes AND Now Playing is visible
   - Only fetch when Now Playing view is in the foreground (check active view state)
   - Clear lyrics when track changes before new fetch completes
7. **Update Now Playing HTML** — insert a lyrics panel between album art section and queue section
   - Scrollable container for long lyrics
   - Show loading state while fetching
   - Show "No lyrics available" when LRCLIB returns 404
   - Show "Instrumental" when the track is flagged as instrumental
   - Plain text display initially; synced lyrics highlighting is a future enhancement
8. **Visibility gating** — only trigger lyrics fetch when Now Playing view becomes active; skip/defer if user is on another view

### Testing

9. **Backend unit tests** (`cargo nextest run`):
   - DB cache hit/miss/negative-cache round-trip
   - LRCLIB response parsing (200 with lyrics, 200 instrumental, 404)
   - HTTP timeout handling
   - Tauri command integration (mock DB + HTTP)
10. **Frontend unit tests** (`npx vitest run`):
    - Lyrics store: fetch on track change, skip when not visible, cache behavior
    - API layer: correct Tauri command invocation
    - Component: loading/error/lyrics/no-lyrics/instrumental states render correctly
11. **E2E tests** (`npx playwright test`):
    - Now Playing shows lyrics area when view is active
    - Lyrics not fetched when on a different view
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Lyrics display in the Now Playing view between album art and queue when available from LRCLIB
- [ ] #2 When no lyrics are found (404, instrumental, error), the view remains unchanged — album art stays prominent with metadata below, exactly as current behavior (no 'No lyrics' message or empty panel)
- [ ] #3 Lyrics are cached per-track in the lyrics_cache SQLite table (keyed by artist+title) so each track is fetched at most once
- [ ] #4 Negative results (404 / no lyrics) are also cached to avoid repeated failed lookups
- [ ] #5 Lyrics fetch only triggers when the Now Playing view is in the foreground
- [ ] #6 When lyrics ARE available: album art shrinks or moves to make room for a scrollable lyrics panel between art and queue
- [ ] #7 Loading spinner shown only briefly during fetch; if fetch fails or returns no lyrics, view silently stays in album-art-dominant layout
- [ ] #8 User-Agent header is set to mt-desktop/<version> on LRCLIB requests
- [ ] #9 HTTP timeout of 10 seconds prevents UI blocking on slow/failed network
- [ ] #10 Both plainLyrics and syncedLyrics from LRCLIB are stored (plain displayed now; synced stored for future use)
- [ ] #11 Backend Rust tests cover: DB cache round-trip, LRCLIB response parsing (200/404/instrumental), timeout handling
- [ ] #12 Frontend Vitest tests cover: lyrics store fetch/visibility gating, API invocation, component render states (with-lyrics vs fallback-to-album-art)
- [ ] #13 All existing tests continue to pass (no regressions)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## UI Behavior Clarification (from screenshots)

The current Now Playing layout has:
- **Left panel**: Large album art (centered, ~272x272 or larger depending on window size) with track title, artist, album below
- **Right panel**: "UP NEXT" queue list

**When lyrics ARE available:**
- Album art reduces in size to make room
- Scrollable lyrics panel appears between the album art/metadata section and the queue
- Lyrics text is plain, scrollable, readable

**When lyrics are NOT available (404, instrumental, error, or still loading on first attempt):**
- View remains EXACTLY as it is now — album art takes the majority of the left panel
- No "No lyrics available" message, no empty panel, no visual change
- The fallback IS the current view — it should be seamless/invisible to the user

This means the lyrics panel is conditionally rendered only when `lyrics` state has actual content. The absence of lyrics should not alter the existing layout at all.
<!-- SECTION:NOTES:END -->
