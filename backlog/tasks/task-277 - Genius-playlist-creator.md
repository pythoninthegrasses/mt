---
id: task-277
title: Genius playlist creator
status: To Do
assignee: []
created_date: '2026-02-18 05:58'
labels:
  - feature
  - playlists
  - recommendation
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement a Genius-style playlist generator that creates playlists of complementary tracks based on a seed song. The user selects a track and the system automatically generates a playlist of songs from their library that "go well together."

See the design document `genius.md` in the backlog docs for a summary of how Apple Music Genius works and the underlying algorithms (collaborative filtering, tf-idf, latent-factor models). Our implementation will need to adapt these concepts to work with a local library without cloud-based collaborative filtering data — likely using audio feature analysis, metadata similarity (genre, year, BPM), and listening history patterns.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 User can right-click a track and select 'Create Genius Playlist' (or similar) from the context menu
- [ ] #2 System generates a playlist of complementary tracks from the user's library based on the seed song
- [ ] #3 Generated playlist can be saved as a regular playlist
- [ ] #4 Playlist generation completes in a reasonable time for large libraries
- [ ] #5 Algorithm uses available metadata (genre, artist, year, BPM, etc.) to determine track similarity
<!-- AC:END -->
