---
id: task-258
title: Optimize runtime memory on Linux ARM64 (CM5)
status: In Progress
assignee: []
created_date: '2026-02-10 03:31'
updated_date: '2026-02-11 03:04'
labels:
  - performance
  - linux
  - arm64
  - memory
dependencies: []
priority: high
ordinal: 10125
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
- [x] #2 No regressions on macOS (task test + task test:e2e pass)
- [x] #3 Library browsing and section switching still work correctly
- [x] #4 Artwork loading still works with reduced cache
- [ ] #5 task tauri:profile confirms improvement on 1up
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementation Complete (2026-02-10)

### Commits (7 total)
1. `ad7fd13` — Remove unused reqwest `blocking` feature
2. `907a378` — Reduce SQLite pool (10→4, min_idle 2→1), artwork cache (100→50)
3. `64b55ae` — Switch zig-core to ReleaseSmall optimization
4. `aad2d84` — glibc malloc arena tuning (Linux only, `MALLOC_ARENA_MAX=2`)
5. `b720148` — Limit rayon thread pool to min(cpus, 4) with 2 MB stacks
6. `c79a3f9` — Stop caching full track arrays in `_sectionCache` (summary-only)
7. `843fccf` — Update Cargo.lock

### Verification (macOS)
- `cargo check`: pass
- `task test` (Rust): 596 tests pass
- `task npm:test` (Vitest): 246 tests pass
- `task test:e2e` (Playwright): 631 pass, 2 pre-existing failures
- MCP section switching: all 6 sections verified, no loading flash

### Docs Updated
- `docs/builds.md` — new "Runtime Memory Optimization" section
- `docs/tauri-architecture.md` — updated performance table with per-platform metrics

### Pending
- Manual RSS measurement on 1up (Raspberry Pi CM5) after installing deb
- Acceptance criterion #1 (RSS < 500 MB) to be validated on-device

### E2E Failures (pre-existing, unrelated)

2 failed tests are from prior commit `96223ce` (Last.fm UI changes), not from memory optimization:
- `[webkit] › tests/library.spec.js:2005:3 › Column Customization › should reset column order when using Reset Columns to Defaults`
- `[webkit] › tests/visual-regression.spec.js:241:3 › Visual Regression: Settings Panels › settings shortcuts panel`

631 passed (1.3m)
<!-- SECTION:NOTES:END -->
