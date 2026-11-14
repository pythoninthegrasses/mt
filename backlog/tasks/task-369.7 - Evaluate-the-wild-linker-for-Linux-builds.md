---
id: TASK-369.7
title: Evaluate the wild linker for Linux builds
status: Done
assignee: []
created_date: '2026-11-14T04:38:00Z'
updated_date: '2026-11-14T05:08:00Z'
labels:
  - build-perf
dependencies: []
references:
  - 'https://github.com/wild-linker/wild#feature-support'
  - docs/builds.md
  - crates/mt-tauri/.cargo/config.toml
parent_task_id: TASK-369
priority: low
type: spike
ordinal: 73500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The wild linker (https://github.com/wild-linker/wild) claims to be a very fast linker for iterative development, and docs/builds.md still describes mold on Linux and lld on macOS as the configured linkers. Before changing any linker config for the build-latency initiative, we need evidence of which linker Linux builds actually use today and whether wild improves dev-loop relink time, release time, or correctness. wild supports Linux only (x86-64, AArch64, RISC-V, LoongArch64, PPC64LE) plus wasm32; Mach-O, Windows and incremental linking are not supported, so macOS and Windows jobs cannot use it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Linker actually used by Linux builds today is established from build output, not from config files
- [x] #2 wild, mold and the current default linker are compared on dev incremental relink and release build time on one Linux x86_64 host
- [x] #3 Workspace tests, deb bundle, debug info and binary load check are verified with wild-linked binaries and compared against the default linker
- [x] #4 Go or no-go recommendation is recorded with the measured numbers
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Setup: mt commit 3634b52 (Rust 1.100.0 stable), Debian trixie deps image from docker/linux/Dockerfile, run on mf (AlmaLinux 10.2, x86_64, 16 cores, 91 GB, shared with other containers so timings are noisy). Linkers: wild 0.11.0 and mold 2.37.1 via clang/gcc, rust-lld 23.1.5, GNU ld; each binary's .comment section was checked to prove which linker produced it. FINDING 1: stable Rust 1.100 defaults to linker-flavor gnu-lld-cc, so mt already links with rust-lld on x86_64 Linux; the apparent lld run with -fuse-ld=lld also used rust-lld. FINDING 2: crates/mt-tauri/.cargo/config.toml (mold on Linux, lld on macOS) is only read when cargo runs from crates/mt-tauri; from the repo root and in Docker /build it is not applied (cargo config get target is empty), and docs/builds.md describes it as active. Dev relink after touching crates/mt-tauri/src/lib.rs, 8 runs: GNU ld 14.04s, rust-lld default 2.93s, mold 2.74s, wild 2.42s. Cold dev build is about 97-112s for all. Release (fat LTO, codegen-units=1, strip), 2 runs: relink rust-lld 101.8s, mold 102.1s, wild 104.6s; cold 154.2s, 153.4s, 158.5s, so LTO dominates and the linker is irrelevant. Correctness with wild: cargo test --workspace gives 890 passed, 2 failed, identical to the default linker; deb bundle builds (9.4 MiB); release binary has zero unresolved libs; addr2line resolves a symbol to src/sidecar.rs:99. UNRELATED BUG: shadow_diff_parity_test sidecar_binary() builds the name with format!("mt-zig-core{host}") with no hyphen, but taskfiles/zig.yml stages mt-zig-core-<triple>, so the 2 parity tests fail on Linux unless zig-core/zig-out/bin/mt-zig-core exists (fails identically with the default linker). RECOMMENDATION: no-go on switching to wild. It saves about 0.5s per dev relink on Linux only, nothing on release, and Windows (slowest release job) and macOS cannot use it. Possible follow-ups needing approval: correct the linker section of docs/builds.md, decide whether the inert crates/mt-tauri/.cargo/config.toml should move to the repo root or be deleted, and fix the sidecar name in shadow_diff_parity_test.

Follow-ups landed on main: 44dce2e removes the unapplied crates/mt-tauri/.cargo/config.toml, drops the Dockerfile COPY of it, rewrites the docs/builds.md Linker section and removes mold from the documented Linux packages; 765b2d0 fixes the sidecar name in shadow_diff_parity_test (new test pinned to the externalBin convention; both parity tests and the new test pass locally). Left for a decision: Dockerfile still apt-installs mold (line 28) although nothing uses it, and removing it invalidates the cached deps layer once; benchmarks/edit-to-run/README.md:73 still cites the deleted config file for its Linker row (TASK-369.1 work in progress).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Evaluated wild 0.11.0 against GNU ld, rust-lld and mold on an x86_64 Linux host using the project's Linux Docker image. No-go: wild saves about 0.5 s on a 2.9 s dev relink, nothing on fat-LTO release builds, and cannot be used on macOS or Windows. Found that Rust 1.100 already links Linux with rust-lld and that the per-crate linker config was never applied; removed it and corrected docs/builds.md (44dce2e). Fixed an unrelated sidecar filename bug that made two parity tests fail on Linux (765b2d0). Not pushed.
<!-- SECTION:FINAL_SUMMARY:END -->
