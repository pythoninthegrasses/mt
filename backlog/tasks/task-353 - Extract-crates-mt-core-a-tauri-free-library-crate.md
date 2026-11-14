---
id: TASK-353
title: 'Extract crates/mt-core, a tauri-free library crate'
status: In Progress
assignee:
  - '@opencode'
created_date: '2026-09-11 00:38'
updated_date: '2026-11-14T19:00:00Z'
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

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Audit current module dependencies and TASK-352 measurements; preserve command names and event behavior. 2. Establish mt-core as a workspace library with an initial behavior-preserving cache extraction and mt-tauri re-export; validate isolated tests and native adapter compilation as the first atomic milestone. 3. Move db, pure scanner, Last.fm and Plex modules into mt-core, exposing only cross-crate APIs; keep artwork, Tauri settings/download adapters and metadata command wrappers in mt-tauri. 4. Push library/queue database orchestration into the core while retaining event emission in adapters. 5. Enforce the no-Tauri transitive dependency boundary in CI; run both nextest suites and the unmodified Playwright suite. 6. Record per-crate build/test timings and dependency footprint with platform/cache caveats against TASK-352; update docs/tauri-architecture.md. Keep this task In Progress until all acceptance criteria have evidence.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-11-14 (sequencing after POC closeout): verified via task_view that TASK-352 is completed and this task is unblocked. This is the next implementation priority before TASK-369.5's Rust-versus-Zig decision. Keep behavior unchanged and retain Tauri command/event adapters in mt-tauri; establish the split-Rust timing/test/footprint baseline before attributing savings to a language change. Status stays To Do: this reconciliation did not start the extraction, validate the historical module boundaries against current code, or perform new benchmarks.

2026-11-14 initial implementation milestone: created crates/mt-core (workspace member, edition 2024), moved cache/ and its tests without behavior changes, and re-exported mt_core::cache from mt-tauri so existing callers are unchanged. Moved the Windows filesystem dependency into mt-core; lru/sha2 remain in mt-tauri for artwork/fingerprints. Added CI cargo-tree guard covering transitive normal/build/dev edges across all targets and features; rejects tauri*, tao, wry, webkit* and objc2*. Updated architecture docs to explicitly describe this partial state.

Validation: cargo nextest run -p mt-core: 15 passed (reported compile 5.90s, test 0.021s); cargo nextest run -p mt-tauri: 880 passed, 2 ignored (reported compile 48.13s, test 2.544s), including real sidecar parity tests. cargo check -p mt-tauri, task lint, task format, actionlint .github/workflows/test.yml, git diff --check and the exact CI dependency guard all passed locally. These are initial macOS timings with existing caches, NOT a controlled benchmark or evidence of the full extraction's savings. TASK-352 measured Linux cold dev build 95s and warm rebuild 3.21s, so avoid a direct speedup claim.

Next milestone: extract db and pure scanner/Last.fm/Plex modules, adjusting only required public APIs and keeping adapters in mt-tauri. Audit found metadata.rs has Tauri command macros and plex/downloader.rs uses AppHandle/Emitter/StoreExt; those need thin desktop wrappers, not wholesale relocation. Library/queue orchestration, full unmodified Playwright validation, controlled final per-crate timing/footprint comparison, and final documentation remain pending. No acceptance criteria checked; task remains In Progress.
<!-- SECTION:NOTES:END -->
