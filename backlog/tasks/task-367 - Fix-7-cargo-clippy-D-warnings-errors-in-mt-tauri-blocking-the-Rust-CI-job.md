---
id: TASK-367
title: Fix 7 cargo clippy -D warnings errors in mt-tauri blocking the Rust CI job
status: To Do
assignee: []
created_date: '2026-11-13T19:23:00Z'
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
- [ ] #1 `cargo clippy --workspace --all-features -- -D warnings` exits 0
- [ ] #2 No new `#[allow(clippy::...)]` attributes added to silence the lints
- [ ] #3 `cargo nextest run --workspace -E 'not test(/shadow_diff_parity_test::/)'` still passes
<!-- AC:END -->
