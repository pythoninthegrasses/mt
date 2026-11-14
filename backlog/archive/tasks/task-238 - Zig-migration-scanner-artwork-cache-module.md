---
id: task-238
title: 'Zig migration: scanner artwork cache module'
status: Done
assignee: []
created_date: '2026-01-28 23:22'
updated_date: '2026-01-29 05:23'
labels: []
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Migrate scanner artwork cache logic to Zig while preserving cache behavior and Rust-facing API expectations.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Artwork cache behavior (hits/misses/eviction) matches current Rust behavior on sample data
- [x] #2 Rust scanner uses Zig artwork cache via FFI without user-visible behavior changes
- [x] #3 Existing automated tests continue to pass
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
✅ Skeleton implementation complete

Created zig-core/src/scanner/artwork_cache.zig with full structure

Defined Artwork extern struct for FFI

Defined ArtworkCache with LRU methods (init, deinit, getOrLoad, invalidate, clear, len)

Added commented FFI exports in ffi.zig

All methods have TODO markers for implementation

Tests stubbed with error.SkipZigTest

Matches Rust behavior spec: 100-item LRU cache, thread-safe, caches None values

**Full Implementation Complete (2026-01-28):**
- Implemented LRU cache with doubly-linked list + HashMap
- Thread-safe with mutex (two-phase locking pattern)
- Caches both Some and None values (critical behavior)
- Folder artwork extraction working (embedded stays in Rust via lofty)
- 11 Zig unit tests passing
- All acceptance criteria met

**Completed (2026-01-28):** All 118 Zig tests passing. Full LRU cache with thread-safe mutex, caches None values, folder artwork extraction implemented.
<!-- SECTION:NOTES:END -->
