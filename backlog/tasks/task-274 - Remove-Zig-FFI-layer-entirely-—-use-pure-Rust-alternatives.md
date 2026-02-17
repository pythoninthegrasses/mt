---
id: task-274
title: Remove Zig FFI layer entirely — use pure Rust alternatives
status: In Progress
assignee: []
created_date: '2026-02-17 01:29'
updated_date: '2026-02-17 01:31'
labels:
  - refactor
  - rust
  - stability
dependencies: []
priority: high
ordinal: 250
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The Zig FFI layer (`mt-core` crate + `zig-core/` directory) causes a deterministic SIGBUS crash at `0x161746164` during startup due to heap corruption in the Zig GeneralPurposeAllocator under concurrent tokio task execution. The layer provides 54 FFI functions but only **2 are actively used in production**. Pure Rust alternatives already exist for both.

### Root Cause
The Zig FFI `run_inventory_zig` function corrupts memory when called concurrently from multiple tokio-runtime-worker threads (triggered by overlapping watched folders). Switching to the pure Rust `run_inventory` (walkdir-based) scanner eliminated the crash entirely.

### Active FFI consumers (only 2)
1. **Last.fm signature** (`lastfm/signature_ffi.rs`) → Pure Rust alternative at `lastfm/signature.rs` using `md5` crate
2. **Artwork LRU cache** (`scanner/artwork_cache_ffi.rs`) → Pure Rust alternative at `scanner/artwork_cache.rs` behind `#[cfg(feature = "rust-lru-cache")]` using `lru` crate

### What to remove
- `crates/mt-core/` — entire crate (just Zig FFI bindings)
- `zig-core/` — entire directory (Zig source + build system)
- `taskfiles/zig.yml` — Zig task definitions
- `crates/mt-tauri/src/scanner/artwork_cache_ffi.rs`
- `crates/mt-tauri/src/scanner/inventory_ffi.rs`
- `crates/mt-tauri/src/lastfm/signature_ffi.rs`
- `crates/mt-tauri/tests/ffi_integration.rs`
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Last.fm client uses pure Rust signature module (lastfm/signature.rs) instead of signature_ffi
- [ ] #2 Artwork cache exports RustArtworkCache as ArtworkCache (remove feature gate)
- [ ] #3 mt-core crate removed from workspace Cargo.toml members
- [ ] #4 crates/mt-core/ directory deleted
- [ ] #5 zig-core/ directory deleted
- [ ] #6 All FFI wrapper files deleted (artwork_cache_ffi.rs, inventory_ffi.rs, signature_ffi.rs)
- [ ] #7 FFI integration test deleted
- [ ] #8 taskfiles/zig.yml deleted and references removed from taskfile.yml
- [ ] #9 rust-lru-cache feature flag removed from mt-tauri Cargo.toml
- [ ] #10 cargo build succeeds
- [ ] #11 cargo test --lib passes
- [ ] #12 cargo clippy has no warnings
- [ ] #13 App starts and runs stable (no crash reports in ~/Library/Logs/DiagnosticReports/)
- [ ] #14 Artwork loads correctly in the UI
- [ ] #15 Last.fm scrobbling works (check console for [lastfm] messages)
<!-- AC:END -->
