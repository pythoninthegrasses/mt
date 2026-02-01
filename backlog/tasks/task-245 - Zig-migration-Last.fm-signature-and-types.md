---
id: task-245
title: 'Zig migration: Last.fm signature and types'
status: Done
assignee: []
created_date: '2026-01-28 23:23'
updated_date: '2026-01-29 05:23'
labels: []
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Migrate Last.fm signature generation and types to Zig while preserving API behavior.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Signature generation outputs match current Rust implementation for known fixtures
- [x] #2 Last.fm types in Zig match existing Rust structures
- [x] #3 Existing automated tests continue to pass
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
✅ Skeleton implementation complete

Created zig-core/src/lastfm/types.zig

Defined Method enum: track_updateNowPlaying, track_scrobble, auth_getSession, user_getInfo

Defined Params struct with StringHashMap

Defined ScrobbleRequest and NowPlayingRequest extern structs

Stubbed generateSignature: sort params → concatenate → append secret → MD5

Fixed-size buffers (512 bytes) for artist/track/album

Matches Last.fm API v2.0 specification

**Completed (2026-01-28):** Implemented Method enum with toString(), Params with StringHashMap, ScrobbleRequest and NowPlayingRequest extern structs, generateSignature (sort params → concatenate → append secret → MD5 → hex). All Zig tests passing.
<!-- SECTION:NOTES:END -->
