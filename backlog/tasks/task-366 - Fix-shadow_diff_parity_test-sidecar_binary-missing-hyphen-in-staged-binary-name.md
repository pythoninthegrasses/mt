---
id: TASK-366
title: >-
  Fix shadow_diff_parity_test sidecar_binary() missing hyphen in staged binary
  name
status: To Do
assignee: []
created_date: '2026-11-13T19:06:00Z'
labels:
  - zig
  - tests
dependencies: []
references:
  - crates/mt-tauri/src/shadow_diff_parity_test.rs
  - taskfiles/zig.yml
priority: low
type: bug
ordinal: 69500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
crates/mt-tauri/src/shadow_diff_parity_test.rs builds the staged sidecar name with `format!("mt-zig-core{host}")`, producing `mt-zig-coreaarch64-apple-darwin`, but `task zig:stage` and Tauri's externalBin use `mt-zig-core-<triple>` (hyphen). The staged-path candidate therefore never exists and the tests only pass if a plain `task zig:build` output exists at zig-core/zig-out/bin/mt-zig-core. Locally `task cargo:test` fails 2 tests (fixture_library_get_all_matches_between_rust_and_zig, sabotaged_sidecar_divergence_is_caught) right after `task zig:stage`. Found while verifying TASK-361; unrelated to the toolchain.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 sidecar_binary() resolves the binary written by task zig:stage TARGET=<host triple>
- [ ] #2 Both shadow_diff_parity_test tests pass locally after only `task zig:stage` (no zig:build needed)
- [ ] #3 The newest-of-candidates behavior described in the doc comment is preserved
<!-- AC:END -->
