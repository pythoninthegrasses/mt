---
id: TASK-271
title: Add listening statistics dashboard
status: In Progress
assignee: []
created_date: '2026-02-16 16:12'
updated_date: '2026-03-08 01:57'
labels:
  - feature
  - ui
  - musicat-comparison
dependencies: []
references:
  - >-
    ~/Library/CloudStorage/Dropbox/mt/tauon/settings/stats/Screenshot 2026-03-07
    at 4.17.23 PM.png (Tauon Stats overview + chart generator button)
  - >-
    ~/Library/CloudStorage/Dropbox/mt/tauon/settings/stats/Screenshot 2026-03-07
    at 4.17.29 PM.png (Tauon Chart Grid Generator dialog)
  - >-
    ~/.local/share/TauonMusicBox/chart.png (Tauon chart output — shows repeated
    metadata and blank space issues)
  - >-
    https://github.com/Taiko2k/Tauon (Tauon source — reference for stats + chart
    generator)
  - >-
    ~/Library/CloudStorage/Dropbox/mt/lastfm/Screenshot 2026-03-07 at 19-50-25
    (Last.fm All Time stats — preferred layout reference)
  - >-
    ~/Library/CloudStorage/Dropbox/mt/lastfm/Screenshot 2026-03-07 at 19-51-18
    (Last.fm date range picker with presets + custom FROM/TO)
  - >-
    ~/Library/CloudStorage/Dropbox/mt/lastfm/Screenshot 2026-03-07 at 19-51-39
    (Last.fm Last 7 days — per-day bar chart)
  - >-
    ~/Library/CloudStorage/Dropbox/mt/lastfm/Screenshot 2026-03-07 at 19-51-53
    (Last.fm Last 30 days — per-day bar chart)
priority: medium
ordinal: 4000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create a statistics/analytics view surfacing insights from data mt already collects (play_count, last_played, scrobble timestamps). Musicat comparison revealed this as a gap.

New db/stats.rs module with aggregate SQL queries. Show top artists/albums/genres by play count, total listening time, plays over time from scrobble_queue, genre distribution. Phase 1: text stat cards and ranked lists. Phase 2: add chart visualizations and chart grid generator.

### Primary UI Reference: Last.fm Stats (layout only)

The preferred layout follows Last.fm's library stats page (see screenshots in references), but adapted for mt's local play count as the primary metric:

**Layout (two-column)**:
- Left: Ranked list of artists with thumbnail artwork, rank number, artist name, and horizontal play count bar (proportional to top entry)
- Right: "Date Range" horizontal bar chart — plays over time. Per-year bars for "All time", per-day bars for shorter ranges (7d, 30d)
- Top-left: summary stat (e.g. "ARTISTS PLAYED: 874")
- Top-right: date range selector dropdown

**Primary metric: play count** (from mt's local database). This is always available regardless of external service configuration.

**Secondary metric: scrobbles** (from Last.fm, when configured). If Last.fm integration is set up, show total scrobbles alongside play counts filtered by the same date range. This bridges local and external listening data without requiring Last.fm for core functionality.

**Date Range Filter**:
- Presets: Last 7 days, Last 30 days, All time
- Chart axis adapts to range (daily granularity for 7d/30d, yearly for all time)
- Ranked list re-sorts for the selected range

**Sort options**: "Most played" dropdown (extensible to other sort orders later)

### Secondary Reference: Tauon (Settings > Stats)

Tauon places its stats under Settings > Stats. Additional features to draw from:

**Stats Overview Panel**:
- Tracks in playlist / Albums in playlist / Playlist duration
- Tracks in database / Total albums / Total playtime
- Genre distribution bar (colored horizontal bar showing proportions)

**Chart Grid Generator** (Phase 2):
- Generates an NxN grid of album art from the library
- Configurable rows and columns (e.g. 3x3 = "9 Album chart")
- Options: Cascade style, Include album titles, Use padding, Sort by top played
- Randomise BG color picker, target playlist selector
- Exports a shareable image (chart.png)

**Known issues in Tauon's chart generator to improve on:**
- Repeated metadata in chart output (same artist-album listed multiple times)
- Blank space / odd layout when playback history is small
- Grid doesn't fill evenly when album count < rows*columns
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Overview shows total tracks, total duration, total plays
- [ ] #2 Top artists list ranked by play count with configurable limit
- [ ] #3 Top genres breakdown with play count and track count
- [ ] #4 Listening history shows plays over time (primary metric: local play count)
- [ ] #5 If Last.fm is configured, show total scrobbles by date range alongside play counts
- [ ] #6 Stats cached and invalidated on play count updates
- [ ] #7 Rust unit tests for aggregate stat queries
- [ ] #8 Chart grid generator creates NxN album art collage from library
- [ ] #9 Chart generator supports configurable rows, columns, padding, sort order
- [ ] #10 Chart generator exports shareable image (PNG)
- [ ] #11 Chart generator gracefully handles fewer albums than grid cells (no blank space or repeated entries)
- [ ] #12 Date range filter with presets: All time, Last 7 days, Last 30 days
- [ ] #13 Ranked artist list with artwork thumbnail, rank number, and play count bar (Last.fm-inspired layout)
- [ ] #14 Horizontal bar chart showing plays over time (per-day for short ranges, per-year for all time)
- [ ] #15 Tauri MCP E2E tests for statistics view
<!-- AC:END -->
