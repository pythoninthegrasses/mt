---
id: TASK-367
title: Fix 7 cargo clippy -D warnings errors in mt-tauri blocking the Rust CI job
status: Done
assignee: []
created_date: '2026-11-13T19:23:00Z'
updated_date: '2026-11-13T19:24:00Z'
labels:
  - ci
  - rust
dependencies:
  - TASK-363
references:
  - crates/mt-tauri/src/commands/plex.rs
  - crates/mt-tauri/src/lib.rs
  - crates/mt-tauri/src/db/removed.rs
  - crates/mt-tauri/src/plex/downloader.rs
priority: high
type: bug
ordinal: 70500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
With the sidecar placeholder from TASK-363, the Rust Lint, Format, and Test job gets past the mt-tauri build script, and `cargo clippy --workspace --all-features -- -D warnings` then fails with 7 errors on rust 1.100.0: explicit_auto_deref at crates/mt-tauri/src/commands/plex.rs:208 (x2) and crates/mt-tauri/src/lib.rs:691 (x2), type_complexity at crates/mt-tauri/src/db/removed.rs:152, collapsible_if at crates/mt-tauri/src/plex/downloader.rs:138, and manual_pattern_char_comparison at crates/mt-tauri/src/plex/downloader.rs:239. Fix each lint without adding blanket allows.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `cargo clippy --workspace --all-features -- -D warnings` exits 0
- [x] #2 No new `#[allow(clippy::...)]` attributes added to silence the lints
- [x] #3 `cargo nextest run --workspace -E 'not test(/shadow_diff_parity_test::/)'` still passes
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Drop explicit derefs in do_plex_sync calls (commands/plex.rs, lib.rs). 2. Add TrackRemovalInfo alias in db/removed.rs. 3. Collapse nested if with a let chain and use a char array pattern in plex/downloader.rs. 4. Run cargo fmt, clippy, nextest.
<!-- SECTION:PLAN:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Fixed all 7 clippy errors without any allow attributes: removed explicit derefs, introduced a TrackRemovalInfo type alias, collapsed the nested if into a let chain, and used a char-array pattern. cargo clippy --workspace --all-features -- -D warnings exits 0; nextest ran 890 tests, all passed (4 skipped).
<!-- SECTION:FINAL_SUMMARY:END -->
