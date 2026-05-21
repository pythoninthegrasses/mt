---
id: TASK-341
title: Integrate Plex music library support
status: To Do
assignee: []
created_date: '2026-05-21 22:56'
updated_date: '2026-05-21 22:58'
labels: []
dependencies:
  - TASK-341.1
  - TASK-341.2
  - TASK-341.3
  - TASK-341.4
  - TASK-341.5
  - TASK-341.6
ordinal: 52500
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
1. **341.1** — Plex API client (Rust) — foundation module
2. **341.2** — Database migration (source + remote_id columns)
3. **341.3** — Config storage + Settings UI (depends on 341.2)
4. **341.4** — Library fetch + merge (depends on 341.1, 341.2)
5. **341.5** — Download-on-play (depends on 341.2)
6. **341.6** — Frontend: cloud icons, download UI, Plex views (depends on 341.3, 341.4, 341.5)

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
- [ ] #1 User can enter Plex server URL and X-Plex-Token in Settings > Plex
- [ ] #2 Plex server is reachable and token is validated on save
- [ ] #3 Plex music library is discoverable: artists, albums, and tracks are fetched and merged with local library
- [ ] #4 Remote tracks are visually distinguished with a cloud icon in library, artist, and album views
- [ ] #5 Playing a remote track downloads the audio file to ~/Music/ and plays from local filesystem
- [ ] #6 Remote tracks appear in the same library views as local tracks with source metadata
- [ ] #7 Deduplication prevents duplicate tracks when the same music exists both locally and on Plex
<!-- AC:END -->
