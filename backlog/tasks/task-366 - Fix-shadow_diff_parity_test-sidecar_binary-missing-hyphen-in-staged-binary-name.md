---
id: TASK-366
title: >-
  Fix shadow_diff_parity_test sidecar_binary() missing hyphen in staged binary
  name
status: Done
assignee: []
created_date: '2026-11-13T19:06:00Z'
updated_date: '2026-11-14T21:39:00Z'
labels:
  - zig
  - tests
dependencies: []
references:
  - crates/mt-tauri/src/shadow_diff_parity_test.rs
  - taskfiles/zig.yml
modified_files:
  - crates/mt-tauri/src/shadow_diff_parity_test.rs
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
- [x] #1 sidecar_binary() resolves the binary written by task zig:stage TARGET=<host triple>
- [x] #2 Both shadow_diff_parity_test tests pass locally after only `task zig:stage` (no zig:build needed)
- [x] #3 The newest-of-candidates behavior described in the doc comment is preserved
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Verification 2026-11-14: `task zig:stage TARGET=aarch64-apple-darwin` reported up to date, then `cargo nextest run -p mt-tauri shadow_diff_parity` ran 3 tests, 3 passed: staged_sidecar_name_matches_tauri_external_bin_convention, sabotaged_sidecar_divergence_is_caught, and fixture_library_get_all_matches_between_rust_and_zig. The last two are exactly the tests this task recorded as failing right after task zig:stage.

AC#3 checked in source: sidecar_binary() still selects max_by_key(modified) over the two candidates (crates/mt-tauri/binaries/mt-zig-core-<host triple> and zig-core/zig-out/bin/mt-zig-core), and the doc comment explaining why newest-wins rather than first-found (a stale staged binary predating --sabotage would otherwise surface as an unrelated spawn failure) is unchanged.

Bookkeeping note: the fix predates this closeout, so the acceptance criteria were checked against the current tree and a fresh test run rather than against new work.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Closed as already fixed: commit 765b2d0 "fix(test): add hyphen to staged sidecar name in parity test" corrected sidecar_binary() to build the staged name as mt-zig-core-<host triple>, matching what task zig:stage writes under crates/mt-tauri/binaries and what Tauri appends to externalBin. The task had been left at 0/3 because the fix landed without the backlog being updated. No further code change was needed. Verification: task zig:stage TARGET=aarch64-apple-darwin followed by cargo nextest run -p mt-tauri shadow_diff_parity gives 3 passed, 332 skipped. Risk: none; the newest-of-candidates fallback to a plain zig-core/zig-out/bin build is untouched, so a checkout that ran task zig:build instead still resolves.
<!-- SECTION:FINAL_SUMMARY:END -->
