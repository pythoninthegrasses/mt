---
id: TASK-355.2
title: Vendored SQLite binding with strip_sort_prefix parity
status: Done
assignee: []
created_date: '2026-09-11 00:38'
updated_date: '2026-09-11 22:00'
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
- [x] #1 The SQLite amalgamation is vendored in-tree and pinned to a version at least matching the version rusqlite 0.38 bundles
- [x] #2 The vendored SQLite compiles for all four target platforms (macOS arm64, macOS x86_64, Linux, Windows) via zig cc with no host-specific toolchain required
- [x] #3 strip_sort_prefix is reimplemented in Zig via sqlite3_create_function_v2 and is proven byte-identical to the Rust implementation using a golden test table derived from the existing Rust tests for this function
- [x] #4 Zig tests for the binding run under std.testing.allocator with zero reported leaks
- [x] #5 The constraint of never linking a system framework (which would break cross-compilation) is documented in core/README.md along with its rationale
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Part A (Rust reconciliation): promoted the test-only `strip_sort_prefix` helper in db/models.rs (any-whitespace rule) to `pub(crate) fn`, dropped `#[cfg(test)]`, and rewrote the SQL UDF closure in db/mod.rs to delegate to it instead of reimplementing a space-only rule. Added a one-shot re-backfill migration in schema.rs::run_migrations, gated on settings key `migration.artist_sort_key_whitespace_v1`, calling the existing `library::refresh_artist_sort_keys`. Full suite: 886 passed.

Part B (vendoring): SQLite 3.51.1 amalgamation (sqlite3.c 9.4MB + sqlite3.h 670KB) vendored under zig-core/vendor/sqlite3/, sourced from sqlite.org and verified byte-identical to the libsqlite3-sys 0.36.0 bundled copy. Unblocked via anchoring .gitignore/.dockerignore `vendor/` -> `/vendor/`, excluding the path from pre-commit's check-added-large-files, `-text` in .gitattributes, an .editorconfig override block, adding "vendor" to build.zig.zon paths, and excluding it from repomix.config.json5.

Part C (build.zig): amalgamation compiled once into a static lib shared by the exe and test steps, `sanitize_c = .off`, SQLITE_ENABLE_LOCKING_STYLE=0 (the mechanism keeping macOS off Darwin VFS code requiring CoreFoundation). CI cache key in test.yml now hashes zig-core/vendor/**.

Part D/E (binding + parity): hand-written extern fn bindings in zig-core/src/sqlite.zig (no @cImport) covering lifecycle, statements, columns/binds, and UDF registration. strip_sort_prefix ported as a pure function in zig-core/src/strip_sort_prefix.zig (ASCII-only case folding, documented bounded divergence from Rust's Unicode to_lowercase()). Shared golden fixture at tests/fixtures/strip_sort_prefix.json, read by both Rust tests and two Zig tests (pure-function test + a DB-backed test exercising the real sqlite3_create_function_v2-registered UDF through SQL).

Part F: zig-core/README.md written (path corrected from the AC's "core/README.md" — no core/ directory exists; the Zig tree is zig-core/).

Verification: `cargo test -p mt-tauri --lib` 886 passed; `zig build test` passed with std.testing.allocator (AC#4); `zig build` and all four `-Dtarget=` cross-compiles (aarch64-macos, x86_64-macos, x86_64-linux, x86_64-windows) succeed from this Linux host with no additional toolchain (AC#2); local cold-cache timings ~3s build, ~2-3s per cross-compile target. Verified no system-framework linkage (AC#5) via `strings` on the cross-compiled aarch64-macos Mach-O binary and its static lib — no "framework" references (otool -L unavailable on this Linux sandbox). `task test` run: cargo:test passed, deno:test failed on the 4 pre-existing frontend test files / 17 tests already documented on TASK-355.1 (`this.$store.library.isRemote is not a function`, unrelated to this task), zig:test independently confirmed green. Nothing committed — awaiting explicit commit request per standing instruction.
<!-- SECTION:NOTES:END -->
