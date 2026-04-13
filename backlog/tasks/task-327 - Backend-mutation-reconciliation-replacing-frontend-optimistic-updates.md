---
id: TASK-327
title: Backend mutation reconciliation replacing frontend optimistic updates
status: In Progress
assignee: []
created_date: '2026-04-13 03:18'
updated_date: '2026-04-13 04:00'
labels:
  - backend
  - library
  - queue
  - frontend
  - events
milestone: m-2
dependencies:
  - TASK-326
references:
  - app/frontend/js/stores/library.js
  - app/frontend/js/stores/queue.js
  - app/frontend/js/utils/library-operations.js
  - crates/mt-tauri/src/library/commands.rs
  - crates/mt-tauri/src/scanner/commands.rs
  - crates/mt-tauri/src/commands/favorites.rs
  - crates/mt-tauri/src/commands/queue.rs
  - crates/mt-tauri/src/events.rs
priority: high
ordinal: 3000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The frontend currently performs optimistic local mutations on delete, scan-complete, and dedup operations — splicing tracks out of local arrays, recomputing stats, and hoping the backend state agrees. This is the source of count divergence, stale entries, and phantom tracks that appear after refresh.

### Current architecture (to be replaced)

**Delete flow** in `app/frontend/js/stores/library.js`:
- `_handleDeleteComplete()` at `library.js:596` receives a set of deleted file paths and splices them from `store.tracks` array locally
- Separately decrements `store.totalTracks` and recomputes `store.totalDuration` via JS reduce
- If the deleted tracks span a page boundary, the local array becomes inconsistent with the DB's paginated view
- The queue store also splices deleted tracks locally from its `items` array

**Scan-complete flow**:
- `_handleScanComplete()` at `library.js:607` forces a full reload via `loadLibraryData()` — but this races with the scan's final DB commit
- During a scan, `_handleScanProgress()` at `library.js:561` updates `totalTracks` from the event data, but the displayed track list may be from a stale page fetch

**Dedup flow** (updated per c12940b):
- The backend now auto-runs `run_backfill_and_dedup` after `scan_paths_to_library` completes (see `crates/mt-tauri/src/scanner/commands.rs`). This spawns a background `spawn_blocking` task that computes `content_hash` for tracks missing it, runs within-directory dedup (inode + hash), then cross-directory dedup.
- `run_backfill_and_dedup` (extracted in c12940b to `crates/mt-tauri/src/library/commands.rs`) already emits `LibraryUpdatedEvent::deleted(deleted_ids)` when duplicates are merged.
- The frontend still reacts to these events with optimistic local mutations (splicing from arrays, recomputing totals in JS) rather than accepting an authoritative backend snapshot. The dedup detection itself is now sound, but the frontend reconciliation of dedup results remains the same local-mutation pattern.
- c12940b also fixed `update_track_fingerprints` to use `COALESCE` so passing `None` preserves existing DB values instead of overwriting with NULL. And it fixed the reconcile loop to write partial results (e.g. content_hash alone when FileFingerprint fails).

### Target architecture

All mutations go through backend commands that:
1. Perform the DB mutation in a transaction
2. Compute the new authoritative state (counts, durations, affected sections)
3. Emit a reconciliation event with a delta or full snapshot
4. Frontend applies the delta/snapshot — never locally mutates collections

**New backend event: `library://reconcile`**

```rust
#[derive(serde::Serialize, Clone)]
pub struct LibraryReconcileEvent {
    pub mutation: String,           // "delete", "scan_complete", "dedup", "favorite_toggle", "play_count_update"
    pub affected_sections: Vec<String>, // Which sections need refresh
    pub revision: i64,              // New revision number (from TASK-326's revision system)
    pub delta: Option<ReconcileDelta>,  // For targeted updates
    pub snapshot: Option<LibrarySectionResponse>, // For full refreshes
}

#[derive(serde::Serialize, Clone)]
pub struct ReconcileDelta {
    pub removed_track_ids: Vec<i64>,
    pub added_track_ids: Vec<i64>,
    pub updated_tracks: Vec<Track>,
    pub total_tracks: i64,
    pub total_duration: f64,
}
```

### Rust implementation guidance

**Modify existing mutation commands to emit reconciliation events:**

1. **`library_delete_tracks`** at `crates/mt-tauri/src/library/commands.rs`: After deleting tracks from DB, compute new counts in the same transaction, emit `library://reconcile` with `mutation: "delete"` and a delta containing `removed_track_ids` + new totals

2. **Scanner completion** at `crates/mt-tauri/src/scanner/commands.rs`: After scan commit, emit `library://reconcile` with `mutation: "scan_complete"`, `affected_sections: ["all", "added"]`, and a full snapshot (or just revision + counts if full snapshot is expensive)

3. **`run_backfill_and_dedup`** at `crates/mt-tauri/src/library/commands.rs`: This function already emits `LibraryUpdatedEvent::deleted(deleted_ids)` for merged duplicates. Upgrade these to emit `library://reconcile` with `mutation: "dedup"`, authoritative totals, and the list of removed IDs — so the frontend applies a delta instead of doing a full reload. Note: the background backfill spawned after scan (added in c12940b) will also emit these events, so the frontend must handle dedup reconciliation arriving asynchronously after scan-complete.

4. **`favorites_toggle`** at `crates/mt-tauri/src/commands/favorites.rs`: After toggle, emit `library://reconcile` with `affected_sections: ["liked"]` — the "liked" section count changed

5. **Queue reconciliation**: When tracks are deleted, the queue must also be cleaned. Extend `queue_remove_tracks` at `crates/mt-tauri/src/commands/queue.rs` to accept a list of track IDs and emit `queue://reconcile` with the cleaned queue state

**Frontend changes:**

- `app/frontend/js/stores/library.js`: Remove `_handleDeleteComplete()`, `_handleScanComplete()`, `_handleScanProgress()` local mutation handlers. Replace with a single `_handleReconcile(event)` listener that:
  - If delta: splices removed IDs from current view, updates totals from authoritative delta values
  - If snapshot: replaces current section data entirely
  - If just revision: compares with cached revision, fetches fresh section data via `library_get_section` (TASK-326) if stale
- Remove all `store.totalTracks = ...` and `store.totalDuration = ...` assignments outside of reconcile handler
- `app/frontend/js/stores/queue.js`: Remove local delete-splice logic, listen for `queue://reconcile` events instead

**Key principle**: The frontend NEVER computes totals, counts, or durations. All authoritative numbers come from backend events or command responses.

### Existing code to modify
- `library_delete_tracks` at `crates/mt-tauri/src/library/commands.rs`
- `run_backfill_and_dedup` at `crates/mt-tauri/src/library/commands.rs` (extracted in c12940b, already emits `LibraryUpdatedEvent::deleted`)
- `scan_paths_to_library` background backfill at `crates/mt-tauri/src/scanner/commands.rs` (added in c12940b)
- `favorites_toggle` at `crates/mt-tauri/src/commands/favorites.rs`
- `queue_remove_by_ids` pattern in `crates/mt-tauri/src/commands/queue.rs`
- `_handleDeleteComplete` at `app/frontend/js/stores/library.js:596`
- `_handleScanComplete` at `app/frontend/js/stores/library.js:607`
- `_handleScanProgress` at `app/frontend/js/stores/library.js:561`
- Queue store local splice logic in `app/frontend/js/stores/queue.js`
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Deleting tracks emits a library://reconcile event with removed_track_ids and authoritative new totals computed by the backend
- [ ] #2 Frontend library store no longer splices tracks out of local arrays on delete — it applies the backend delta or re-fetches on revision change
- [ ] #3 Scan completion emits library://reconcile — frontend no longer calls loadLibraryData() on scan_complete event
- [ ] #4 Dedup completion emits library://reconcile with removed IDs — frontend applies delta instead of full reload
- [ ] #5 Favorite toggle emits library://reconcile with affected_sections including 'liked' — liked section count updates without manual JS recount
- [ ] #6 Queue store receives queue://reconcile when tracks are deleted and updates its items array from the backend snapshot
- [ ] #7 Frontend has zero instances of local totalTracks or totalDuration assignment outside of reconcile event handlers
- [ ] #8 All reconciliation events include the revision number from TASK-326's revision system
- [ ] #9 Rust tests cover: delete N tracks -> reconcile event contains correct removed IDs and new totals; concurrent delete + scan -> both events emitted with correct revision ordering; favorite toggle -> affected_sections correct
- [ ] #10 Frontend Vitest tests verify: reconcile delta correctly removes tracks from current view; reconcile snapshot replaces section data; revision mismatch triggers re-fetch
<!-- AC:END -->
