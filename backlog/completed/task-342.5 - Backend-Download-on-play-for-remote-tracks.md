---
id: TASK-342.5
title: 'Backend: Download-on-play for remote tracks'
status: Done
assignee: []
created_date: '2026-05-21 22:58'
updated_date: '2026-05-23 02:23'
labels: []
dependencies:
  - TASK-342.2
parent_task_id: TASK-342
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
- [x] #1 `audio_load` and `audio_load_and_play` (`commands/audio.rs:502` and `:517`) detect filepaths starting with `http://` or `https://` before calling `resolve_cached_path`. URL filepaths are routed to a new resolver `resolve_plex_path(&path, &track_id, &app, &db) -> Result<String, String>` that returns a local-filesystem path.
- [x] #2 `resolve_plex_path` constructs the target as `{music_root}/<Artist>/<Album>/<TrackNumber:02> - <Title>.<ext>`, where `{music_root}` is the user's `~/Music` directory (or an OS-appropriate equivalent via `dirs::audio_dir()`). All path components are sanitized by replacing `/`, `\`, `:`, `?`, `*`, `"`, `<`, `>`, `|`, and control chars with `_`. Trailing dots and spaces are stripped from each component (Windows-safe).
- [x] #3 Artist/album/title/track_number/ext are sourced from the `track_id` row in the `library` table (looked up via `db.with_conn(|c| ...)`), NOT parsed from the URL. The URL's `.<ext>` suffix (from `stream_url`) is used as a fallback only if the DB row lacks an extension column.
- [x] #4 If the constructed local path already exists on disk → skip download, return the path directly. The track's DB `filepath` is updated to the local path opportunistically (so future loads bypass URL detection).
- [x] #5 Otherwise, download via `reqwest::Client::builder().timeout(Duration::from_secs(600)).build()` (10-minute timeout for large files). Stream to a temp file at `<target>.partial`, then atomic-rename to `<target>` on success. On any error, delete the partial file.
- [x] #6 Max file size is enforced by reading `Content-Length`; reject before download if it exceeds `plex.max_track_bytes` from the settings JSON store (default `500 * 1024 * 1024` = 500 MiB). Also enforce mid-stream by counting bytes written and aborting if the count exceeds the cap.
- [x] #7 The `X-Plex-Token` query param is included in the URL (built by `client::stream_url`); the resolver logs only the URL's path + host, never the query string, to avoid leaking tokens to log files. Use explicit substring redaction before passing to `tracing` macros.
- [x] #8 On download success: update `library.filepath` to the local path via `db.with_conn(...)`. `source` stays `'plex'` (the track originated from Plex even though it now lives locally). `remote_id` is preserved.
- [x] #9 On download failure: emit a `plex_download_failed` Tauri event with `{ track_id, error: String }`. Mark the track `missing=1` via the existing `library_mark_missing` command. Return `Err(...)` to the audio command so the frontend sees a load failure.
- [x] #10 Progress reporting: emit `plex_download_progress` Tauri event with `{ track_id, downloaded_bytes, total_bytes, percent }` at most every 250 ms (throttled with a `last_emit: Instant`), and once at 100% on completion.
- [x] #11 The download runs on a background thread via `tokio::task::spawn_blocking` so it does not block the Tauri command worker. The `audio_load_and_play` command awaits completion before signaling the audio engine to load; the UI shows a "Downloading…" toast in the meantime.
- [x] #12 Unit tests using `wiremock`: (a) serve a small (~10 KB) byte stream with `Content-Length` set, run `resolve_plex_path`, assert the target file exists on disk with the right size, the DB `filepath` was updated, and the `.partial` file was cleaned up; (b) serve a 200-byte file but advertise `Content-Length: 10_000_000_000`; assert download aborts before bytes are written and the partial file does not exist.
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented download-on-play for Plex remote tracks. Created `crates/mt-tauri/src/plex/downloader.rs` with `resolve_plex_path` (the public entry point) and `download_file` (testable core). Made `audio_load` and `audio_load_and_play` async and added `db: State<Database>` parameter; URL paths are intercepted before `resolve_cached_path` and routed through the downloader. Downloads use reqwest with a 600 s timeout, stream to a `.partial` file, and atomic-rename on success. Content-Length is checked before writing; mid-stream byte counting enforces the cap. Token is redacted from all log output. Progress events (`plex_download_progress`) are throttled to 250 ms; `plex_download_failed` is emitted on error along with marking the track missing. 13 tests pass (unit tests for all helpers + two wiremock integration tests for the download core); full test suite: 850/850.
<!-- SECTION:FINAL_SUMMARY:END -->
