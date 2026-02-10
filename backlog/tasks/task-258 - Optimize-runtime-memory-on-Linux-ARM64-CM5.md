---
id: task-258
title: Optimize runtime memory on Linux ARM64 (CM5)
status: In Progress
assignee: []
created_date: '2026-02-10 03:31'
updated_date: '2026-02-10 06:16'
labels:
  - performance
  - linux
  - arm64
  - memory
dependencies: []
priority: high
ordinal: 38250
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The app uses ~896 MB RSS on Linux ARM64 (CM5 with 16 GB RAM) after loading a 2.6 GB music library, compared to ~115 MB on macOS. The WebKitWebProcess alone jumps from 253 → 648 MB when the library loads.

## Root Causes (ranked by impact)

1. **Frontend data duplication** (~400 MB) — `_sectionCache` in `library.js` stores full track arrays (22 fields × thousands of tracks) per section, plus `tracks[]`, `filteredTracks[]`, and persisted copies
2. **glibc malloc arena bloat** (~50-100 MB) — per-thread arenas in multi-process WebKitGTK
3. **WebKitGTK baseline overhead** (~315 MB) — multi-process architecture, unavoidable
4. **Oversized Rust allocations** (~5-10 MB) — DB pool and artwork cache sized for desktop

## Current Measurements

| State | macOS (studio) | Linux ARM64 (1up) |
|---|---|---|
| Idle | 115 MB | 478 MB |
| With 2.6 GB library | N/A | 896 MB |

## Proposed Changes

1. **Frontend: stop caching full track arrays in `_sectionCache`** — cache only summary metadata (count, duration, timestamp), always fetch tracks from local SQLite on section switch
   - File: `app/frontend/js/stores/library.js`
   - Expected savings: **200-400 MB**

2. **glibc malloc tuning** — set `MALLOC_ARENA_MAX=2` and `MALLOC_TRIM_THRESHOLD_=131072` at Rust startup on Linux (inherited by WebKit child processes)
   - Files: `crates/mt-tauri/src/lib.rs`, `taskfiles/tauri.yml`
   - Expected savings: **50-100 MB**

3. **Reduce SQLite connection pool on Linux** — `max_size(10)` → `max_size(4)`, `min_idle(2)` → `min_idle(1)`
   - File: `crates/mt-tauri/src/db/mod.rs`
   - Expected savings: **~0.5-1 MB**

4. **Reduce artwork cache on Linux** — default 100 entries → 50 via `with_capacity(50)`
   - File: `crates/mt-tauri/src/lib.rs`
   - Expected savings: **~1-5 MB**

5. **Remove unused reqwest `blocking` feature** — zero usages of `reqwest::blocking` in codebase
   - File: `crates/mt-tauri/Cargo.toml`
   - Expected savings: **minor**

6. **Switch Zig build `ReleaseFast` → `ReleaseSmall`** — reduces memory-mapped code pages
   - File: `crates/mt-core/build.rs`
   - Expected savings: **~0.5-2 MB**

7. **Limit rayon thread pool on Linux** — 2 threads × 2 MB stack instead of 4 threads × 8 MB
   - File: `crates/mt-tauri/src/lib.rs`
   - Expected savings: **~12 MB virtual**

## Expected Savings

| Optimization | Estimated Savings |
|---|---|
| Stop caching track arrays | 200-400 MB |
| MALLOC_ARENA_MAX=2 | 50-100 MB |
| Smaller DB pool | ~0.5-1 MB |
| Smaller artwork cache | ~1-5 MB |
| Remove reqwest blocking | minor |
| Zig ReleaseSmall | ~0.5-2 MB |
| Rayon pool limits | ~12 MB virtual |
| **Total** | **~265-520 MB** |

**Target: ~400-500 MB with library loaded (down from 896 MB), ~50% reduction**
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 RSS with loaded library is under 500 MB on Linux ARM64 (currently 896 MB)
- [ ] #2 No regressions on macOS (task test + task test:e2e pass)
- [ ] #3 Library browsing and section switching still work correctly
- [ ] #4 Artwork loading still works with reduced cache
- [ ] #5 task tauri:profile confirms improvement on 1up
<!-- AC:END -->
