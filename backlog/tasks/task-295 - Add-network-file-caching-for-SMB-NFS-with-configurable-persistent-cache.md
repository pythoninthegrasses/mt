---
id: TASK-295
title: Add network file caching for SMB/NFS with configurable persistent cache
status: In Progress
assignee: []
created_date: '2026-03-08 02:03'
updated_date: '2026-03-08 02:04'
labels:
  - audio
  - feature
  - tauon-reference
  - network
dependencies: []
references:
  - >-
    screenshot:
    ~/Library/CloudStorage/Dropbox/mt/tauon/settings/audio/Screenshot 2026-03-07
    at 4.19.22 PM.png
  - 'https://github.com/taiko2k/tauon'
priority: low
ordinal: 6000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add optional local caching for audio files served over network mounts (SMB/NFS) to reduce latency and improve playback reliability. Located under Settings > Audio.

**Reference implementation**: Tauon Music Box (Settings > Audio) provides:
1. **"Cache local files (for SMB/NFS)"** toggle — when enabled, copies network-mounted audio files to a local cache directory before playback
2. **"Use persistent network cache"** toggle — when enabled, cached files survive app restarts (otherwise cache is cleared on exit)
3. **"Cache size"** slider — configurable cache size (Tauon defaults to 2.0 GB, adjustable)

**Behavior for mt**:
- Caching is **disabled by default**
- When enabled, detect whether a track's path is on a network mount and transparently copy it to a local cache before handing it to the audio pipeline
- Persistent cache toggle controls whether the cache directory is purged on app exit
- Cache size is user-configurable with an LRU eviction policy when the limit is reached
- Settings UI: two toggles + a cache size control, grouped under Settings > Audio
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 "Cache local files (for smb/nfs)" toggle in Settings > Audio, disabled by default
- [ ] #2 Detect network-mounted paths (SMB/NFS) and cache files locally before playback when enabled
- [ ] #3 "Use persistent network cache" toggle — when off, cache directory is purged on app exit
- [ ] #4 Configurable cache size with slider/input (default reasonable size, e.g. 2 GB)
- [ ] #5 LRU eviction policy when cache exceeds configured size
- [ ] #6 Cache status/size visible in settings
- [ ] #7 Rust unit tests for cache logic (write, evict, purge)
- [ ] #8 Playwright E2E test for cache settings UI
<!-- AC:END -->
