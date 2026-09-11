---
id: TASK-353
title: 'Extract crates/mt-core, a tauri-free library crate'
status: To Do
assignee: []
created_date: '2026-09-11 00:38'
labels: []
dependencies:
  - TASK-352
type: feature
ordinal: 55500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Core logic and its roughly 910 tests should compile and run without linking tauri/wry/webkit/objc2. Today cargo nextest run --workspace links ~17,750 LOC of #[cfg(test)] against a 421-crate dependency graph. This is expected to be the single largest available CI reduction, requires no Zig, and establishes the exact module seam that a future Zig port would occupy -- so it de-risks any later migration and isolates how much of any CI win comes from decoupling versus from a language change. Scope: move db/, scanner/ (minus artwork), lastfm/, plex/, cache/, and metadata.rs into the new crate; crates/mt-tauri retains lib.rs, commands/, library/commands.rs, scanner/commands.rs, watcher.rs, events.rs, audio/, media_keys.rs, and dialog.rs, depending on mt-core. scanner/scan.rs:41 already takes a Box<dyn Fn(ScanProgress)> callback and needs no change for this seam. The real work is in library/commands.rs (1,952 LOC, 21 Tauri commands) and commands/queue.rs, which currently interleave DB calls with emit_* event calls and need the DB half pushed down while the emit half stays in mt-tauri. db/mod.rs exports are pub(crate) throughout today and need to become pub where mt-tauri still calls them.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 crates/mt-core has no tauri dependency, enforced by a CI check
- [ ] #2 cargo nextest run -p mt-core passes
- [ ] #3 cargo nextest run -p mt-tauri passes
- [ ] #4 Both crates' wall-clock build/test times are recorded and compared against the TASK-352 baseline
- [ ] #5 No behavior change: the full Playwright suite passes unmodified
- [ ] #6 docs/tauri-architecture.md updated to describe the new crate layout
<!-- AC:END -->
