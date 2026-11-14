---
id: TASK-342
title: Integrate Plex music library support
status: Done
assignee: []
created_date: '2026-05-21 22:56'
updated_date: '2026-11-14T05:37:00Z'
labels: []
dependencies:
  - TASK-342.1
  - TASK-342.2
  - TASK-342.3
  - TASK-342.4
  - TASK-342.5
  - TASK-342.6
priority: high
ordinal: 187.5
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Integrate Plex music library support into mt, allowing users to browse, discover, and play music from their Plex Media Server alongside their local collection.

**Architecture:**
- Plex API client in Rust (JSON-based, X-Plex-Token auth)
- Tracks merged into local SQLite DB with `source='plex'` marker
- Remote tracks played via download-on-play (stream → disk → rodio)
- Cloud icons in UI distinguish remote from local tracks

**Reference implementations:**
- cliamp (`bjarneo/cliamp`) — Go reference using X-Plex-Token with JSON API. ~200-line client, clean provider interface.
- plexamp-tui (`spiercey/plexamp-tui`) — alternative reference using PIN-OAuth + XML API. More complex auth flow.

**Task breakdown:**
1. **342.1** — Plex API client (Rust) — foundation module
2. **342.2** — Database migration (source + remote_id columns)
3. **342.3** — Config storage + Settings UI (depends on 342.2)
4. **342.4** — Library fetch + merge (depends on 342.1, 342.2)
5. **342.5** — Download-on-play (depends on 342.2)
6. **342.6** — Frontend: cloud icons, download UI, Plex views (depends on 342.3, 342.4, 342.5)

**Key design decisions:**
- Static X-Plex-Token (no PIN-OAuth) — user finds token in Plex Web View XML URL
- JSON API responses (not XML) — cleaner Rust deserialization
- Download-on-play: remote tracks stream URL → download to disk → play locally
- `filepath` column repurposed: initially holds stream URL, after download holds local path
- `source` column stays 'plex' even after download (tracks origin)
- Dedup: match remote tracks to local via content_hash then text match; linked tracks share a single DB row
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 User can enter Plex server URL and X-Plex-Token in Settings > Plex
- [x] #2 Plex server is reachable and token is validated on save
- [x] #3 Plex music library is discoverable: artists, albums, and tracks are fetched and merged with local library
- [ ] #4 Remote tracks are visually distinguished with a cloud icon in library, artist, and album views
- [x] #5 Playing a remote track downloads the audio file to ~/Music/ and plays from local filesystem
- [x] #6 Remote tracks appear in the same library views as local tracks with source metadata
- [x] #7 Deduplication prevents duplicate tracks when the same music exists both locally and on Plex
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-11-14 (backlog tidy): closed after verifying the implementation in the tree, not from status alone. AC#1 Settings > Plex with URL + X-Plex-Token (app/frontend/js/components/settings-view.js:26,50,894-899). AC#2 reachability/token validated on save via plex.ping -> server_name/machine_id/version and the connected indicator (settings-view.js:913-923, commands/plex.rs 'Server unreachable'). AC#3 library fetched and merged (crates/mt-tauri/src/plex/merge.rs PlexMergeStats). AC#5 remote playback downloads to ~/Music/<Artist>/<Album>/<NN> - <Title>.<ext> then plays locally (plex/downloader.rs:32, build_local_path + its tests). AC#6 remote rows share the library views and are source-typed (store isRemote() keys on source === 'plex' + http(s) filepath, stores/library.js:262; used by library/albums/artists-browser.js). AC#7 dedup by idempotent merge - already-present rows skipped as inserted Plex rows or linked local files (merge.rs:168). AC#4 left UNCHECKED on purpose: remote tracks are distinguished by an opacity-75 row class and the showRemote filter (library-browser.js:863-874), not by the cloud icon the AC specifies, so that AC's literal requirement is still open.

Follow-up worth knowing: the parent was closed with AC#4 unchecked while its own subtask 342.6 'Frontend: cloud icons, download UI, Plex views' is archived as complete. The repo has no cloud icon today (rg for a cloud marker in the library views finds none); the visible remote affordances are the opacity-75 row class and the showRemote filter. If the cloud icon is still wanted, it is a small frontend task, not a reopen of this one.
<!-- SECTION:NOTES:END -->
