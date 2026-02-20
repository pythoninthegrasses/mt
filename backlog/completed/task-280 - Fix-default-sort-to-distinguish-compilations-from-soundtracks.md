---
id: TASK-280
title: Fix default sort to distinguish compilations from soundtracks
status: Done
assignee: []
created_date: '2026-02-18 19:47'
updated_date: '2026-02-18 21:46'
labels:
  - bug
  - library
  - sorting
dependencies: []
references:
  - crates/mt-tauri/src/db/models.rs
  - crates/mt-tauri/src/db/library.rs
  - crates/mt-tauri/src/library/commands.rs
  - app/frontend/js/stores/library.js
  - app/frontend/js/components/albums-browser.js
  - app/frontend/js/components/artists-browser.js
  - app/frontend/js/api.js
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

The default library sort (artist) treats compilations and identically named albums the same as soundtracks, when they need different grouping behavior.

**Current behavior:** All multi-artist albums (compilations, soundtracks, same-named albums by different artists) are grouped by `COALESCE(album_artist, artist)` then sorted by album → disc → track. This works for soundtracks (e.g., Clair Obscur) but breaks for:

1. **Compilations** (e.g., "Dark Was the Night"): All tracks cluster under one artist entry (likely "Various Artists" or the compilation album_artist). Instead, each contributing artist's tracks should appear adjacent to that artist's other albums — e.g., The Decemberists' contribution to "Dark Was the Night" should sort near "Her Majesty the Decemberists."

2. **Identically named albums by different artists** (e.g., "Ceremony" by both Phantogram and Anna Von Hausswolff): These may interleave or group incorrectly when album name matches but artist differs.

**Desired behavior:**
- **Compilations**: Sort tracks by their individual `artist` field (not `album_artist`), so each artist's compilation contributions appear adjacent to that artist's own albums
- **Identical album names**: Group by artist, so "Ceremony" by Phantogram and "Ceremony" by Anna Von Hausswolff each appear under their respective artist
- **Soundtracks** (e.g., Clair Obscur): Keep the current grouping — all tracks sequential by disc/track number under the soundtrack's album_artist

## Key Challenge

Distinguishing compilations from soundtracks. Both may have an `album_artist` like "Various Artists" or a specific name, but they need opposite sorting strategies. Possible heuristics:
- A `compilation` tag/flag in metadata (ID3 `TCMP`, Vorbis `COMPILATION`)
- Whether individual track artists are all different vs. mostly the same
- Genre-based detection (e.g., "Soundtrack" genre)
- A user-configurable flag per album

The approach needs investigation — check what metadata Lofty already exposes and what's available in the existing library database schema.

## Affected Code

### Backend (Rust)
- **Sort definition**: `crates/mt-tauri/src/db/models.rs` — `LibrarySortColumn::Artist` uses `COALESCE(album_artist, artist) COLLATE NOCASE` as primary sort, with secondary sort `, album COLLATE NOCASE ASC, CAST(disc_number AS INTEGER) ASC, CAST(track_number AS INTEGER) ASC`
- **SQL query**: `crates/mt-tauri/src/db/library.rs` — `get_all_tracks()` constructs the ORDER BY clause
- **Tauri command**: `crates/mt-tauri/src/library/commands.rs` — `library_get_all` exposes sort params to frontend

### Frontend (JavaScript)
- **Library store**: `app/frontend/js/stores/library.js` — maps `default` → `artist`, runs client-side ignore-words re-sort in `applyFilters()` with canonical artist map and dominant disc logic
- **Albums browser**: `app/frontend/js/components/albums-browser.js` — groups tracks by album name, sorts within album by disc/track
- **Artists browser**: `app/frontend/js/components/artists-browser.js` — builds canonical artist map (shortest album_artist per album), groups albums under artists

### Database
- The `library` table stores: `artist`, `album_artist`, `album`, `disc_number`, `track_number`, `genre`, `date`
- No `compilation` flag currently exists in the schema
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Compilation albums (e.g., Dark Was the Night) sort each track by its individual artist, so contributions appear adjacent to that artist's own albums in default sort
- [x] #2 Identically named albums by different artists (e.g., Ceremony by Phantogram vs Anna Von Hausswolff) are grouped separately under each artist
- [x] #3 Soundtrack albums (e.g., Clair Obscur) retain current behavior: all tracks grouped together, sequential by disc and track number
- [x] #4 Albums browser correctly separates same-named albums by different artists into distinct album entries
- [x] #5 Artists browser shows compilation contributions under each contributing artist (not lumped under Various Artists)
- [x] #6 Existing sort orders (dateAdded, year, genre, etc.) are not affected by this change
- [x] #7 Unit tests cover compilation vs soundtrack vs same-name-album sorting scenarios
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Approach: Move ignore-words sorting to SQL

### Root Cause
The frontend `applyFilters()` re-sort builds a `canonicalArtistMap` that forces all tracks sharing an album name under one artist. This breaks compilations and same-name albums. The SQL backend already sorts correctly via `COALESCE(album_artist, artist)`.

### Solution
Register a custom SQLite scalar function `strip_sort_prefix(value, prefixes_csv)` in Rust, pass the ignore-words list from frontend to backend, and eliminate the client-side re-sort entirely.

### Steps
1. Register `strip_sort_prefix` SQLite function in `db/mod.rs` via `with_init` callback
2. Add `ignore_words` param to `LibraryQuery` and `library_get_all` command
3. Update `LibrarySortColumn::as_sql()` and `secondary_sort_sql()` to wrap text columns with `strip_sort_prefix()` when ignore_words is provided
4. Pass `sortIgnoreWords`/`sortIgnoreWordsList` from frontend through `api.library.getTracks()` to the Tauri command
5. Remove the client-side re-sort from `applyFilters()` in library.js (keep non-sort filtering)
6. Fix albums-browser.js grouping: use composite key (album + album_artist) instead of album name only
7. Fix artists-browser.js canonical map: only assign canonical when all tracks share same non-null album_artist
8. Add unit tests (Rust + Vitest) for all three album patterns
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-02-18: Investigation complete. Bug is in frontend canonicalArtistMap (library.js:766-776), not SQL. Confirmed via Tauri MCP: Dark Was the Night has album_artist=null (correct SQL sort), Ceremony has distinct album_artists, Clair Obscur has consistent album_artist. Revising approach to move all sorting to SQL with custom strip_sort_prefix function.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Summary

Moved sort logic from frontend JavaScript to SQL backend via custom `strip_sort_prefix()` SQLite function. Fixed three album sorting patterns:

1. **Compilations** (Dark Was the Night): Tracks sort by individual `artist` when `album_artist` is NULL, so The Decemberists' compilation track appears adjacent to their other albums
2. **Same-name albums** (Ceremony): `COALESCE(album_artist, artist)` keeps Anna Von Hausswolff's and Phantogram's identically-named albums separate
3. **Soundtracks** (Clair Obscur): Consistent `album_artist` groups all tracks together in disc/track order

### Changes

**Backend (Rust)**
- `crates/mt-tauri/src/db/mod.rs`: Register `strip_sort_prefix(value, prefixes_csv)` custom SQLite scalar function on all pooled connections
- `crates/mt-tauri/src/db/models.rs`: Add `as_order_by(ignore_words)` and `secondary_order_by(ignore_words)` methods to `LibrarySortColumn` that wrap text columns with `strip_sort_prefix()` when ignore-words enabled
- `crates/mt-tauri/src/db/library.rs`: Add `ignore_words: Option<String>` to `LibraryQuery`, use new order-by methods in SQL construction
- `crates/mt-tauri/src/library/commands.rs`: Add `ignore_words` parameter to `library_get_all` Tauri command
- `crates/mt-tauri/Cargo.toml`: Enable `functions` feature for rusqlite

**Frontend**
- `app/frontend/js/api.js`: Pass `ignoreWords` to Tauri command
- `app/frontend/js/stores/library.js`: Pass ignore-words to backend, remove entire client-side re-sort (`canonicalArtistMap`, `dominantDiscMap`, `_stripIgnoredPrefix`)
- `app/frontend/views/settings.html`: Ignore-words toggle triggers `load({ forceReload: true })` instead of `applyFilters()`
- `app/frontend/js/components/albums-browser.js`: Use composite key (`album|||albumArtist`) for grouping to separate same-name albums
- `app/frontend/js/components/artists-browser.js`: Fix canonical artist map to only map albums with consistent non-null `album_artist`; add per-track artist matching for compilations
- `app/frontend/__tests__/library.store.test.js`: Remove `_stripIgnoredPrefix` tests (logic moved to SQL, covered by Rust tests)

### Test Results
- 585/585 Rust tests pass (including 11 new tests for `strip_sort_prefix` and sort patterns)
- All three album patterns verified via Tauri MCP against live data
<!-- SECTION:FINAL_SUMMARY:END -->
