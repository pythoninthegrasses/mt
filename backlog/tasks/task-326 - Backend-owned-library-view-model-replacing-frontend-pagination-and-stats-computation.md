---
id: TASK-326
title: >-
  Backend-owned library view model replacing frontend pagination and stats
  computation
status: In Progress
assignee: []
created_date: '2026-04-13 03:15'
updated_date: '2026-04-13 04:00'
labels:
  - backend
  - library
  - frontend
milestone: m-2
dependencies: []
priority: high
ordinal: 2000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The library store currently owns pagination, section switching, stats computation, caching, and background refresh logic spread across `app/frontend/js/stores/library.js` (719 lines) and `app/frontend/js/utils/library-operations.js` (482 lines). This is the primary source of regressions where pagination breaks file counts, totals diverge from DB, and section loads produce inconsistent state.

The root problem: the frontend makes separate `library_get_count` and `library_get_all` calls, then assembles the view model locally. Counts and track pages can come from different DB states.

### Current architecture (to be replaced)
1. `loadLibraryData()` at `library-operations.js:146` fires `library.getCount(filterParams)` and `store._fetchPage(0)` in parallel
2. Count returns `{total, total_duration}`, page returns `{tracks}`
3. Frontend stores these separately: `store.totalTracks = countData.total`, `store._trackPages[0] = tracks`
4. For non-"all" sections: `loadSection()` at `library-operations.js:71` calls a section-specific fetch function, then `applySectionData()` at `library-operations.js:21` computes `totalDuration` by reducing over tracks in JS
5. Background refresh: `backgroundRefreshLibrary()` at `library-operations.js:240` and `backgroundRefreshSection()` at `library-operations.js:114` duplicate the fetch+apply pattern
6. Cache layer: `library-cache.js` persists section snapshots to Tauri settings for instant display

### Target architecture
A single backend command `library_get_section` that returns a complete, authoritative view:

```rust
#[derive(serde::Serialize)]
pub struct LibrarySectionResponse {
    pub section: String,        // "all", "liked", "recent", "added", "top25", "playlist-{id}"
    pub tracks: Vec<Track>,     // Page of tracks (for "all") or full list (for sections)
    pub total_tracks: i64,
    pub total_duration: f64,    // Seconds, computed by DB (SUM(duration))
    pub page: Option<i64>,      // Current page (null for non-paginated sections)
    pub page_size: Option<i64>, // Page size (null for non-paginated sections)
    pub has_more: bool,         // Whether more pages exist
    pub revision: i64,          // Monotonic revision for cache invalidation
}
```

For the "all" section, this replaces both `library_get_count` and `library_get_all` — the backend returns tracks + authoritative stats in a single query. For other sections (liked, recent, etc.), it replaces the section-specific fetch + manual stats computation.

### Rust implementation guidance

**New command in `crates/mt-tauri/src/library/commands.rs`:**

The command should dispatch on the `section` parameter:
- `"all"`: Use existing `library::get_all_tracks` + `library::get_filtered_count` but execute them in the same DB transaction so counts are consistent with the returned page. Compute `total_duration` via SQL `SUM(duration)` in the count query (already close — `LibraryCount` at `crates/mt-tauri/src/db/library.rs` has `total_duration`).
- `"liked"`: Use `favorites::get_favorites` from `crates/mt-tauri/src/db/favorites.rs`, compute total_duration via SQL
- `"recent"`: Use `favorites::get_recently_played` from `crates/mt-tauri/src/db/favorites.rs`
- `"added"`: Use `favorites::get_recently_added` from `crates/mt-tauri/src/db/favorites.rs`
- `"top25"`: Use `favorites::get_top_25` from `crates/mt-tauri/src/db/favorites.rs`
- `"playlist-{id}"`: Use `playlists::get_playlist_tracks` from `crates/mt-tauri/src/db/playlists.rs`

Add a `revision` counter to the `queue_state` table (or a new `library_state` table) that increments on any mutation (insert, delete, update). Frontend can compare revisions to decide whether cached data is stale.

**Parameters:**
```rust
pub struct LibrarySectionRequest {
    pub section: String,
    pub page: Option<i64>,         // For "all" section pagination
    pub page_size: Option<i64>,    // Default 500
    pub search: Option<String>,
    pub sort_by: Option<String>,
    pub sort_order: Option<String>,
    pub ignore_words: Option<String>,
    // Section-specific params
    pub days: Option<i64>,         // For recent/added
    pub playlist_id: Option<i64>,  // For playlist sections
}
```

**Existing code to consolidate:**
- `library_get_all` at `crates/mt-tauri/src/library/commands.rs:37`
- `library_get_count` at `crates/mt-tauri/src/library/commands.rs:101`
- `favorites_get` at `crates/mt-tauri/src/commands/favorites.rs:100`
- `favorites_get_recently_played` at `crates/mt-tauri/src/commands/favorites.rs:217`
- `favorites_get_recently_added` at `crates/mt-tauri/src/commands/favorites.rs:234`
- `favorites_get_top25` at `crates/mt-tauri/src/commands/favorites.rs:207`

**Frontend changes:**
- `app/frontend/js/stores/library.js`: Replace `load()`, `loadFavorites()`, `loadRecentlyPlayed()`, `loadRecentlyAdded()`, `loadTop25()`, and all `_backgroundRefresh*` methods with calls to `invoke('library_get_section', {...})`
- `app/frontend/js/utils/library-operations.js`: Remove `loadLibraryData()`, `loadSection()`, `backgroundRefreshLibrary()`, `backgroundRefreshSection()`, `applySectionData()` — these are entirely replaced by backend-owned view
- `app/frontend/js/api/library.js`: Add `getSection()` method wrapping the new command; deprecate `getCount()` and `getTracks()` (keep temporarily for backward compat)
- Remove `_filterByLibrary()` from library store — backend returns pre-filtered data
- Remove JS-side `totalDuration` computation (the `tracks.reduce(...)` pattern) — backend returns authoritative `total_duration`
- Simplify cache layer to store only `{section, revision}` — on cache hit, skip fetch if revision matches
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A single invoke('library_get_section', ...) call returns tracks + total_tracks + total_duration + pagination metadata for any section
- [ ] #2 total_tracks and total_duration are computed by SQL in the same transaction as the track query — no JS-side stats computation remains
- [ ] #3 Frontend library store no longer calls library_get_count separately from library_get_all
- [ ] #4 Section switches (all/liked/recent/added/top25/playlist) all use the same backend command with different section parameter
- [ ] #5 library-operations.js no longer contains loadLibraryData, loadSection, backgroundRefreshLibrary, backgroundRefreshSection, or applySectionData
- [ ] #6 Backend returns a revision number that increments on any library mutation (insert/delete/update)
- [ ] #7 Frontend cache invalidation uses revision comparison instead of time-based staleness
- [ ] #8 Existing library_get_all and library_get_count commands remain functional (not removed) for backward compatibility during migration
- [ ] #9 Rust tests cover: each section type returns correct structure; pagination (page 0 vs page N vs beyond-last-page); search filtering; sort ordering; empty library; revision increments on mutation
- [ ] #10 Frontend Vitest tests verify store correctly applies section response without local recomputation
<!-- AC:END -->
