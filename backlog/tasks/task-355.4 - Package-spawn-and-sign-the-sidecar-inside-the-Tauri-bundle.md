---
id: TASK-355.4
title: 'Package, spawn, and sign the sidecar inside the Tauri bundle'
status: To Do
assignee: []
created_date: '2026-09-11 00:39'
labels: []
dependencies:
  - TASK-355.3
parent_task_id: TASK-355
type: task
ordinal: 61500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The Zig sidecar binary must ship inside the Tauri app bundle via externalBin, be spawned and supervised by the Rust process, and survive macOS notarization as a second signed binary. The key gotcha: Tauri appends the *Rust* host target triple to an externalBin filename to resolve which binary to run, and this does not match Zig's own target naming -- for example a musl-linked Linux build must be named with the suffix `-unknown-linux-gnu` (not `-linux-musl`) and a MinGW-built Windows binary must be named with the suffix `-pc-windows-msvc` (not `-windows-gnu`), because the suffix encodes the consuming Rust host triple, not the ABI the sidecar was actually built with. This mapping must be explicit and hardcoded in the build tooling, never derived by pattern-matching on the Zig target string. git show af04d61 in this repo is prior art for the spawn/lifecycle wiring shape (a prior, later-reverted Python sidecar), useful as a reference for structure even though the transport differs.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 externalBin is configured in tauri.conf.json and the Rust-triple filename mapping for each Zig target is explicit in the build tooling, not derived
- [ ] #2 The Tauri app spawns the sidecar on startup and terminates it cleanly on app exit
- [ ] #3 The app does not panic or crash if the sidecar binary is missing; it fails gracefully with a logged error
- [ ] #4 Sidecar stderr output is forwarded into the existing tracing pipeline in crates/mt-tauri/src/logging.rs
- [ ] #5 capabilities/default.json is unchanged, since Rust (not JS) owns the sidecar lifecycle
- [ ] #6 A CI verification step confirms nested code signatures and the hardened runtime flag on the sidecar binary before the notarization step runs, failing fast on a problem rather than waiting on a 10-minute notarytool round trip
- [ ] #7 A signed and notarized macOS app bundle successfully launches and the sidecar serves a request from it
- [ ] #8 The Zig-emitted binary is not stripped or otherwise post-processed after `zig build`, since that would invalidate Zig's ad-hoc code signature on Apple Silicon
<!-- AC:END -->
