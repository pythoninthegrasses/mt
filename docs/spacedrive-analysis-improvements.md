# Spacedrive Architecture Analysis & mt Improvement Roadmap

## Executive Summary

This document analyzes architectural patterns from [Spacedrive](https://github.com/spacedriveapp/spacedrive) (a Rust/Tauri file manager with a Virtual Distributed File System) and identifies concrete improvements for the mt music player codebase. Improvements are ranked by **impact** (H/M/L) and **complexity** (H/M/L).

---

## Part 1: Spacedrive Architectural Highlights

### 1.1 VDFS & Scanning Architecture
- **Content-addressable storage (CAS)**: Files identified by content hash, not just path — enables move detection without full rehash
- **Multi-phase indexer pipeline**: Separate jobs for indexing (filesystem walk), file identification (content analysis), and media processing (thumbnails/metadata) — each can run independently and be retried
- **Location manager**: Watches filesystem locations via platform-native APIs, dispatches targeted incremental updates rather than full rescans
- **Entry model**: Universal representation of files/directories independent of physical location

### 1.2 Job System
- **Durable jobs**: Persist across app restarts using MessagePack serialization
- **Pause/resume**: Long-running jobs can be paused and resumed
- **Progress tracking with ETA**: Jobs report estimated time remaining
- **Library-scoped**: Jobs are isolated per-library, preventing cross-contamination
- **Task decomposition**: Large operations broken into smaller tasks that can be distributed

### 1.3 Database Layer
- **V1**: Prisma + SQLite with prisma-client-rust for type-safe queries
- **V2**: SeaORM + SQLite, local-first with sync.db for synchronization logs
- **CQRS pattern**: Strict separation of commands (mutations) and queries (reads) — queries never modify state
- **Migration engine**: Prisma migration engine runs on app launch

### 1.4 IPC & State Management
- **rspc**: Type-safe RPC between Rust and TypeScript — function signatures verified at compile time
- **Daemon/client separation**: Core runs as headless process, UI is a thin client
- **CQRS over RPC**: Every operation is either a Command or a Query

### 1.5 Frontend Rendering
- **React with virtualized lists**: Uses virtualization for rendering large file collections
- **Cursor-based pagination**: Not offset-based — more efficient for large datasets
- **Multiple view modes**: Grid, list, media views with optimized rendering per mode

### 1.6 Testing
- **Rust unit tests**: Core logic tested with in-memory databases
- **Integration tests**: Test full pipelines with real filesystem fixtures
- **CI matrix**: Cross-platform CI (macOS, Linux, Windows) with Rust and TypeScript checks

---

## Part 2: mt Current Architecture Assessment

### 2.1 Scanner (`crates/mt-tauri/src/scanner/`)
**Current implementation**: 2-phase scan (inventory + metadata parse) using `walkdir` for filesystem traversal and `lofty-rs` for metadata extraction. Fingerprint-based change detection via mtime + file size.

**Strengths**:
- 2-phase design avoids reparsing unchanged files
- Fingerprint comparison is efficient for no-op rescans
- Move detection via inode and content hash
- Zig FFI for filesystem walking (performance optimization)

**Weaknesses identified**:
1. `extract_metadata_batch` processes files sequentially — no parallelism
2. `to_track_metadata()` computes SHA-256 content hash synchronously for every new track during scan — I/O heavy blocking operation
3. Single `rescan_semaphore` serializes ALL scan operations globally — no per-folder parallelism
4. Watcher triggers full 2-phase rescan on any filesystem event, even for a single file change
5. No job persistence — interrupted scans start from scratch

### 2.2 Library Rendering (`app/frontend/js/`)
**Current implementation**: Virtual scrolling with fixed 34px row height, Alpine.js reactive state, column-based layout with resize/reorder.

**Strengths**:
- Virtual scrolling with buffer rows (15 rows overscan)
- Column width persistence and drag-to-resize
- Section caching with background refresh
- Type-to-jump navigation

**Weaknesses identified**:
1. **`limit: 999999`** — Frontend fetches ALL tracks from the database on every load (`library.js:232`, `albums-browser.js:84`, `artists-browser.js:306`). No true pagination despite the backend supporting it.
2. **Duplicate sorting**: Database applies `ORDER BY`, then client re-sorts for ignore-words normalization — double work
3. **Full reload on any change**: Any library update (`watched-folder:results` event) triggers `_clearCache()` + full `load({ forceReload: true })` — O(n) for n tracks
4. **No incremental DOM updates**: When a single track changes, the entire `filteredTracks` array is replaced, triggering Alpine.js reactivity on all virtual rows
5. **Repeated `reduce()` calls**: `totalDuration` recalculated via `tracks.reduce()` on every load/section switch — could be a DB aggregate

### 2.3 Watcher (`crates/mt-tauri/src/watcher.rs`)
**Current implementation**: `notify-debouncer-full` with 1-second debounce, triggers full `scan_2phase` rescan via `trigger_rescan()`.

**Strengths**:
- Debounced filesystem events prevent thrashing
- Reconciliation of moved files via inode + content hash
- Recovery of previously-missing files that reappear

**Weaknesses identified**:
1. Any filesystem event (even a single file change) triggers a full recursive rescan of the entire watched folder
2. No event batching intelligence — a bulk file move triggers N individual events that each queue a full rescan (semaphore serializes them but each still runs)
3. `trigger_rescan` queries ALL library fingerprints (`SELECT filepath, file_mtime_ns, file_size FROM library`) regardless of which folder changed
4. Duplicate audio extension checking — hardcoded matches in watcher callback vs `AUDIO_EXTENSIONS` constant in scanner module

### 2.4 Testing Gaps
**Current test inventory**:
- **Rust**: 643 `#[test]`/`#[cfg(test)]` occurrences across 47 files, but...
  - Most backend tests verify **serialization** (JSON round-trip) and **struct construction** — not business logic
  - Command tests (`library/commands.rs`, `commands/*.rs`) test only serialization, pagination arithmetic, and path validation — no actual DB interaction
  - No integration tests for Tauri commands with a real database
  - Scanner tests use fake files (`b"fake mp3"`) — don't test actual metadata extraction
  - Only `queue_props_test.rs` uses property-based testing (proptest)
- **Frontend**: 20+ Playwright spec files with comprehensive E2E coverage, but entirely mocked backend (`mock-library.js`, `mock-playlists.js`)
- **Missing entirely**: No end-to-end tests with actual Rust backend + frontend running together

---

## Part 3: Improvement Recommendations (Ranked)

### Legend
- **Impact**: H = High (user-visible performance/reliability), M = Medium, L = Low
- **Complexity**: H = High (multi-week, architectural), M = Medium (days), L = Low (hours)

---

### 🔴 Critical (High Impact)

#### 1. Incremental Filesystem Updates Instead of Full Rescans
| Impact | Complexity | Area |
|--------|-----------|------|
| **H** | **M** | Scanner/Watcher |

**Problem**: The watcher triggers `scan_2phase` (full recursive walk) for every filesystem event. For a library with 50K tracks, a single file rename causes a full re-walk of the entire folder tree.

**Spacedrive approach**: Location watcher dispatches targeted incremental updates — only the affected paths are processed.

**Proposed solution**:
- Add an `incremental_scan` function that accepts specific file paths from notify events
- For `Create` events: extract metadata + add to DB for just that file
- For `Modify` events: re-extract metadata + update DB for just that file
- For `Remove` events: mark as missing in DB for just that file
- Reserve full `scan_2phase` for manual rescans and initial folder setup
- **Estimated impact**: Reduces watcher-triggered scan time from O(n_files_in_folder) to O(changed_files)

#### 2. Server-Side Pagination for Library Queries
| Impact | Complexity | Area |
|--------|-----------|------|
| **H** | **M** | Library Rendering |

**Problem**: `limit: 999999` in `_fetchLibraryData()` loads the entire library into browser memory. For 100K+ track libraries, this causes multi-second loads and high memory usage.

**Spacedrive approach**: Cursor-based pagination with virtualized rendering that fetches pages on demand.

**Proposed solution**:
- Implement windowed data fetching: load only visible rows + buffer (e.g., 200 tracks at a time)
- Virtual scroll already tracks `startIndex`/`endIndex` — use these to drive fetch requests
- Backend already has `limit`/`offset` support in `library::get_all_tracks`
- Add a `totalTracks` count query (without fetching data) for scroll height calculation
- Move `totalDuration` calculation to a DB aggregate (`SELECT SUM(duration) FROM library`)
- **Estimated impact**: Reduces initial load from ~2-5s to <200ms for large libraries, cuts memory usage by 90%+

#### 3. Parallel Metadata Extraction During Scanning
| Impact | Complexity | Area |
|--------|-----------|------|
| **H** | **L** | Scanner |

**Problem**: `extract_metadata_batch` processes files sequentially. For an initial scan of 10K files, this is the bottleneck.

**Spacedrive approach**: Separate indexer and media processor jobs run in parallel across worker threads.

**Proposed solution**:
- Use `rayon::par_iter()` for parallel metadata extraction in `extract_metadata_batch`
- The `lofty-rs` parsing is CPU-bound and file I/O is naturally parallelized by the OS
- Content hash computation (`compute_content_hash`) should also be parallelized or deferred to a background job
- **Estimated impact**: 3-8x speedup on multi-core machines for initial scans

---

### 🟡 Important (Medium-High Impact)

#### 4. Backend Integration Tests with Real Database
| Impact | Complexity | Area |
|--------|-----------|------|
| **H** | **M** | Testing |

**Problem**: All Rust command tests only verify serialization and struct construction. No tests exercise the actual command → DB → response pipeline.

**Spacedrive approach**: Core logic tested with in-memory databases and real filesystem fixtures.

**Proposed solution**:
- Create a `test_utils` module with in-memory SQLite database setup (migrations included)
- Write integration tests for each Tauri command that: create an in-memory DB → seed data → call command function → verify DB state + response
- Priority commands to test: `scan_paths_to_library`, `library_get_all`, `library_rescan_track`, `library_locate_track`, `library_reconcile_scan`
- Add real audio file fixtures (already have `tests/fixtures/test_sample.{mp3,flac,ogg,m4a,wav}`)
- **Estimated impact**: Catches real bugs in SQL queries, sorting, pagination, and track reconciliation

#### 5. Deferred Content Hash Computation
| Impact | Complexity | Area |
|--------|-----------|------|
| **M** | **L** | Scanner |

**Problem**: `to_track_metadata()` (in both `watcher.rs:668` and `scanner/commands.rs:327`) calls `compute_content_hash()` synchronously for every track during scanning. SHA-256 of full file contents is I/O-intensive.

**Proposed solution**:
- During scan, only store fingerprint (mtime + size + inode) — skip content hash
- Compute content hash in a separate background job after scan completes
- `library_reconcile_scan` already backfills fingerprints — make it the canonical path
- **Estimated impact**: 30-50% reduction in scan time for initial library imports

#### 6. Scoped Fingerprint Queries in Watcher
| Impact | Complexity | Area |
|--------|-----------|------|
| **M** | **L** | Watcher |

**Problem**: `trigger_rescan` in `watcher.rs:378` queries ALL library fingerprints (`SELECT filepath, file_mtime_ns, file_size FROM library`) regardless of which folder is being scanned. The `scope_fingerprints_to_paths` function in `scanner/commands.rs` already solves this for manual scans but isn't used in the watcher path.

**Proposed solution**:
- Add a WHERE clause: `SELECT filepath, file_mtime_ns, file_size FROM library WHERE filepath LIKE ?` scoped to the watched folder path
- Or reuse `scope_fingerprints_to_paths` in the watcher rescan path
- **Estimated impact**: Reduces DB query time and memory for multi-folder libraries

#### 7. Move Ignore-Words Sorting to Backend
| Impact | Complexity | Area |
|--------|-----------|------|
| **M** | **M** | Library Rendering |

**Problem**: Backend applies `ORDER BY`, then frontend re-sorts the entire array in `applyFilters()` when ignore-words is enabled. This is O(n log n) on every filter application for large libraries.

**Proposed solution**:
- Add a `sort_ignore_prefix` SQL function or `CASE WHEN` expression to handle prefix stripping in the SQL query
- Or use a `sort_key` column in the library table that stores the normalized sort value (updated on insert/update)
- Remove client-side re-sort entirely
- **Estimated impact**: Eliminates client-side sort jank for 10K+ track libraries

---

### 🟢 Moderate Impact

#### 8. E2E Tests with Real Backend
| Impact | Complexity | Area |
|--------|-----------|------|
| **M** | **H** | Testing |

**Problem**: All Playwright tests run against mocked APIs. Bugs in the Rust ↔ JS boundary (serialization mismatches, event timing, error handling) are invisible to tests.

**Proposed solution**:
- Create a test harness that starts the Tauri app with a test database
- Use Playwright's `_electron` or WebDriver to test against the real app
- Start with smoke tests: app launches → scan folder → tracks appear → play track
- Add regression tests for known pain points: large library scroll performance, rapid section switching, concurrent scan + playback
- **Estimated impact**: Catches the class of bugs that only manifest with real backend (timing, serialization, race conditions)

#### 9. Structured Job System for Background Operations
| Impact | Complexity | Area |
|--------|-----------|------|
| **M** | **H** | Scanner/Architecture |

**Problem**: Scan operations are fire-and-forget async tasks. No persistence, no pause/resume, no consolidated progress tracking across multiple folders.

**Spacedrive approach**: Durable `JobManager` with MessagePack serialization, pause/resume, and ETA.

**Proposed solution**:
- Create a `JobManager` struct that tracks active/completed/failed jobs
- Jobs have states: `Queued`, `Running(progress)`, `Paused`, `Complete(stats)`, `Failed(error)`
- Persist job state to SQLite so interrupted scans can resume
- Expose job list and progress to frontend via Tauri events
- **Estimated impact**: Better UX for large initial imports, crash recovery

#### 10. Property-Based Testing for Scanner Edge Cases
| Impact | Complexity | Area |
|--------|-----------|------|
| **M** | **L** | Testing |

**Problem**: Scanner tests use hardcoded scenarios. Edge cases like symlink loops, permission errors, Unicode filenames, very long paths, and concurrent modifications aren't tested.

**Proposed solution**:
- Add proptest strategies for file paths (Unicode, spaces, special chars, max length)
- Test inventory phase with randomly generated directory trees
- Test fingerprint comparison with randomly generated mtime/size combinations
- Test move reconciliation with random inode/hash scenarios
- **Estimated impact**: Catches edge cases that surface with diverse user libraries

#### 11. Incremental Library Updates via Event Payloads
| Impact | Complexity | Area |
|--------|-----------|------|
| **M** | **M** | Library Rendering |

**Problem**: `LibraryUpdatedEvent` emits empty `track_ids: vec![]` for bulk changes, causing full frontend reload. Even single-track updates trigger full cache invalidation.

**Proposed solution**:
- Always include affected `track_ids` in `LibraryUpdatedEvent`
- Frontend patches local `tracks` array in-place for small updates (< 100 tracks)
- Only full reload for bulk changes (initial scan, reconciliation)
- **Estimated impact**: Eliminates unnecessary full reloads during normal listening

#### 12. Deduplicate Audio Extension Checking
| Impact | Complexity | Area |
|--------|-----------|------|
| **L** | **L** | Scanner/Watcher |

**Problem**: Watcher callback (`watcher.rs:246-255`) hardcodes audio extension matching with `matches!()` macro, while `scanner/mod.rs` defines `AUDIO_EXTENSIONS` constant. Two sources of truth — adding a new format requires changes in two places.

**Proposed solution**:
- Use `scanner::is_audio_file()` in the watcher callback instead of hardcoded matches
- **Estimated impact**: Eliminates maintenance risk of divergent extension lists

---

## Part 4: Priority Matrix

```
                    LOW COMPLEXITY          MEDIUM COMPLEXITY       HIGH COMPLEXITY
                ┌─────────────────────┬─────────────────────┬─────────────────────┐
HIGH IMPACT     │ 3. Parallel metadata│ 1. Incremental FS   │                     │
                │ extraction          │ updates              │                     │
                │                     │ 2. Server-side       │                     │
                │                     │ pagination           │                     │
                │                     │ 4. DB integration    │                     │
                │                     │ tests                │                     │
                ├─────────────────────┼─────────────────────┼─────────────────────┤
MEDIUM IMPACT   │ 5. Deferred content │ 7. Backend ignore-  │ 8. E2E with real    │
                │ hash                │ words sorting        │ backend             │
                │ 6. Scoped FP queries│ 11. Incremental     │ 9. Job system       │
                │ 10. Property tests  │ library updates      │                     │
                │ 12. Dedup extension │                     │                     │
                │ checking            │                     │                     │
                ├─────────────────────┼─────────────────────┼─────────────────────┤
LOW IMPACT      │                     │                     │                     │
                │                     │                     │                     │
                └─────────────────────┴─────────────────────┴─────────────────────┘
```

## Part 5: Recommended Implementation Order

**Phase 1 — Quick wins (Low complexity, High/Medium impact)**:
1. Parallel metadata extraction (#3) — `rayon::par_iter()` in `extract_metadata_batch`
2. Deferred content hash (#5) — Remove from scan, defer to reconciliation
3. Scoped fingerprint queries (#6) — Add WHERE clause in watcher rescan
4. Deduplicate extensions (#12) — Use `is_audio_file()` in watcher

**Phase 2 — Core improvements (Medium complexity, High impact)**:
5. Incremental filesystem updates (#1) — Targeted file processing in watcher
6. Server-side pagination (#2) — Windowed data fetching in library browser
7. Backend integration tests (#4) — In-memory SQLite test harness

**Phase 3 — Architecture evolution (Medium-High complexity)**:
8. Backend ignore-words sorting (#7) — SQL-level sort key normalization
9. Incremental library updates (#11) — Event payloads with track IDs
10. Property-based scanner tests (#10) — proptest strategies for scanner
11. E2E tests with real backend (#8) — Playwright against real Tauri app
12. Job system (#9) — Durable, persistent background operations

---

## Appendix: Key File References

| Area | File | Line(s) | Issue |
|------|------|---------|-------|
| All-tracks fetch | `app/frontend/js/stores/library.js` | 232 | `limit: 999999` |
| All-tracks fetch | `app/frontend/js/components/albums-browser.js` | 84 | `limit: 999999` |
| All-tracks fetch | `app/frontend/js/components/artists-browser.js` | 306 | `limit: 999999` |
| Full rescan on event | `crates/mt-tauri/src/watcher.rs` | 284-287 | `trigger_rescan` on every FS event |
| Global fingerprint query | `crates/mt-tauri/src/watcher.rs` | 378-396 | Unscoped `SELECT FROM library` |
| Sync content hash | `crates/mt-tauri/src/watcher.rs` | 668 | `compute_content_hash` in `to_track_metadata` |
| Sync content hash | `crates/mt-tauri/src/scanner/commands.rs` | 327 | `compute_content_hash` in `to_db_metadata` |
| Hardcoded extensions | `crates/mt-tauri/src/watcher.rs` | 246-255 | Duplicates `AUDIO_EXTENSIONS` |
| Client-side re-sort | `app/frontend/js/stores/library.js` | 706-823 | `applyFilters()` re-sorts entire array |
| Sequential metadata | `crates/mt-tauri/src/scanner/metadata.rs` | — | `extract_metadata_batch` is sequential |
| Serialization-only tests | `crates/mt-tauri/src/library/commands.rs` | 474-763 | Tests verify JSON, not DB logic |
| Empty event payloads | `crates/mt-tauri/src/scanner/commands.rs` | 268 | `LibraryUpdatedEvent::added(vec![])` |
