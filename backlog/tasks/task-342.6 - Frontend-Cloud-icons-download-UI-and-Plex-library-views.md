---
id: TASK-342.6
title: 'Frontend: Cloud icons, download UI, and Plex library views'
status: In Progress
assignee: []
created_date: '2026-05-21 22:58'
updated_date: '2026-05-22 04:33'
labels: []
dependencies:
  - TASK-342.3
  - TASK-342.4
  - TASK-342.5
parent_task_id: TASK-342
ordinal: 58500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add cloud badges to existing artists/albums/library views for remote (Plex) tracks, and implement sequential prefetch on queue/play.\n\nNo new sidebar section or Plex-only view. Plex content merges into existing views via the TASK-342.4 library merge. A cloud badge next to artists, albums, and tracks denotes \"not yet local\" (source='plex' AND filepath is a URL). When the user queues or starts playback on remote content, the first track downloads then begins playing; remaining tracks download one at a time in the background, removing their cloud badges as they complete.\n\nKey files:\n- `app/frontend/views/library.html` - add cloud badge per track row\n- `app/frontend/views/albums.html` - add cloud badge per album\n- `app/frontend/views/artists.html` - add cloud badge per artist\n- `app/frontend/js/stores/library.js` - isRemote helper, precomputed per-album/artist flags\n- `app/frontend/js/stores/queue.js` - plex_prefetch_queue worker\n- `app/frontend/views/settings.html` - Show Remote toolbar toggle\n- `crates/mt-tauri/src/commands/plex.rs` - plex_download_track command\n- `tests/plex.spec.ts` - Playwright E2E tests (@tauri)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A reusable cloud badge component (inline template or `_cloud-badge.html` partial) renders a `12px x 12px` SVG using `currentColor` for stroke (theme-aware). `isRemote` helper on the library store returns true when a track has `source === 'plex'` AND `filepath` does not start with `/`, or an artist/album has any child track satisfying the same condition.
- [ ] #2 Track rows in `library.html` render the cloud badge to the right of the title when `isRemote(track)` is true. Badge has `aria-label="Available from Plex (not downloaded)"`.
- [ ] #3 Album entries in `albums.html` render the badge next to the album label when any track in that album is still remote. The "any remote" flag is precomputed per album in the library store getter, not per-render.
- [ ] #4 Artist entries in `artists.html` render the badge next to the artist name when any track by that artist is still remote (same precomputed flag pattern as albums).
- [ ] #5 Cloud badge styling uses `text-muted-foreground` (basecoat token) at `opacity-70`; hover bumps to `opacity-100`. `sidebar.html` is unchanged — no new sidebar section is added.
- [ ] #6 Right-click context menu gains a `Download from Plex` item, visible only when `isRemote(track)` is true. Clicking it triggers `plex_download_track(track_id: i64) -> Result<(), String>` (does not autoplay). Badge disappears once DB filepath transitions to a local path (reactive via library store refresh).
- [ ] #7 Download progress and failure use `plex_download_progress` / `plex_download_failed` events from TASK-342.5. Progress renders as a toast (basecoat toast component) with percentage; auto-dismisses on completion or shows error on failure.
- [ ] #8 Sequential prefetch: on play/queue, (a) first track goes to `audio_load_and_play` (downloads-then-plays per TASK-342.5); (b) remaining remote IDs are queued in `plex_prefetch_queue` (Alpine array) and processed one at a time via `plex_download_track`; (c) worker stops when queue empties, player stops, or user clears queue. Re-ordering/appending rebuilds the queue from current state (remote tracks only, skipping already-downloaded).
- [ ] #9 Only ONE Plex download runs at a time across active-playback and prefetch worker. Backend mutex preferred (`plex_download_track` and `resolve_plex_path` share `tokio::sync::Mutex<()>`). The chosen approach must be explicitly documented in the implementation.
- [ ] #10 Library view toolbar gains a "Show remote" toggle (basecoat switch). When OFF, filters out fully-remote tracks/albums/artists (no local tracks). Default ON. Persisted to `settings.json` under `library.show_remote`.
- [ ] #11 Once a track's filepath transitions to a local path, the library store updates reactively (via `library_get_track` refetch on `plex_download_progress percent === 100`, or bulk refresh after N completions). Cloud badge disappears; album/artist badges disappear once all children are local.
- [ ] #12 Playwright E2E tests at `tests/plex.spec.ts` (tagged `@tauri`): (a) seed remote track, assert badge in library + album + artist; update filepath to local, assert badges gone. (b) "Show remote" toggle off — fully-remote items vanish. (c) Context-menu download — stub `plex_download_track` + event, assert badge clears. (d) Queue three remote tracks — first via `audio_load_and_play`; second + third via `plex_download_track` sequentially, one at a time.
<!-- AC:END -->
