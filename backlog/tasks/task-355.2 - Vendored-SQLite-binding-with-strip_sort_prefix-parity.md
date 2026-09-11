---
id: TASK-355.2
title: Vendored SQLite binding with strip_sort_prefix parity
status: To Do
assignee: []
created_date: '2026-09-11 00:38'
labels: []
dependencies:
  - TASK-355.1
parent_task_id: TASK-355
type: task
ordinal: 59500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The Zig sidecar needs to open and query mt.db with full fidelity to the existing Rust behavior, and the existing community Zig SQLite wrappers (zig-sqlite, zqlite) are rejected as a foundation because the binding needs low-level access -- sqlite3_create_function_v2, exact PRAGMA sequencing, and sqlite3_backup -- that those wrappers don't expose without patching, and their comptime binding machinery is a likely breakage point on future Zig releases. Vendor the SQLite amalgamation and hand-write a thin binding instead. The critical correctness risk here is crates/mt-tauri/src/db/mod.rs:67, which registers a custom scalar SQL function strip_sort_prefix on every connection; any query that uses it will silently behave differently (or fail) in a process that hasn't registered an identical function, and sort-order bugs of this kind are user-visible but easy to miss in casual testing.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The SQLite amalgamation is vendored in-tree and pinned to a version at least matching the version rusqlite 0.38 bundles
- [ ] #2 The vendored SQLite compiles for all four target platforms (macOS arm64, macOS x86_64, Linux, Windows) via zig cc with no host-specific toolchain required
- [ ] #3 strip_sort_prefix is reimplemented in Zig via sqlite3_create_function_v2 and is proven byte-identical to the Rust implementation using a golden test table derived from the existing Rust tests for this function
- [ ] #4 Zig tests for the binding run under std.testing.allocator with zero reported leaks
- [ ] #5 The constraint of never linking a system framework (which would break cross-compilation) is documented in core/README.md along with its rationale
<!-- AC:END -->
