---
id: TASK-361
title: 'Migrate Rust toolchain to 1.100 era (unused-deps lint, min-publish-age)'
status: In Progress
assignee: []
created_date: '2026-11-13T18:37:00Z'
updated_date: '2026-11-13T18:56:00Z'
labels: []
dependencies: []
type: chore
ordinal: 64500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
mt pins nightly-2026-02-09 solely for -Zthreads. Benchmark stable 1.100.0 vs current nightly (with -Zthreads), pin the winner across .tool-versions, taskfile.yml, taskfiles/ci.yml, setup-tauri-build action, scripts/build.ps1, scripts/runner.sh, docker/linux/Dockerfile and docs. Adopt Cargo's cargo::unused_dependencies lint and registry.global-min-publish-age = 3 days.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Hyperfine cold and incremental results for stable 1.100.0 vs nightly with -Zthreads recorded in task notes
- [x] #2 Toolchain pin updated consistently in .tool-versions, taskfile.yml, taskfiles/ci.yml, setup-tauri-build action, build.ps1, runner.sh, Dockerfile
- [x] #3 Windows RUSTUP_TOOLCHAIN remains fully qualified with host triple
- [x] #4 Repo-root .cargo/config.toml sets registry.global-min-publish-age = 3 days and override is documented
- [x] #5 docs/builds.md, AGENTS.md, dependency-audit.md updated
- [ ] #6 task lint and task test pass locally (only pre-existing shadow-diff failures); macOS, Linux and Windows CI jobs green
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-11-13: min-publish-age landed (4733513). Verified on cargo 1.100.0: cargo update --dry-run reports 'highest compatible versions as of 3 days ago'. Note: mise shim for cargo ignores RUSTUP_TOOLCHAIN and resolves to the .tool-versions nightly; use ~/.cargo/bin/cargo to test other toolchains.

2026-11-13: cargo::unused_dependencies does NOT fire for mt-tauri on stable 1.100.0 even with [lints.cargo] unused_dependencies=deny, rust-version set, cache cleaned, and a deliberately injected unused dep (itoa, fnv). It does fire on a minimal scratch crate and on the real manifest with stub sources, so the suppression comes from the real sources (bin/example units never report unused externs). Not adding the lint config because it would give false assurance. Fallback check: cargo rustc -p mt-tauri --lib -- -W unused-crate-dependencies reports no unused regular deps with default features (dev-dependencies, optional features and Windows-only deps unchecked).

Sidecar must be staged before any cargo check/build: task zig:stage TARGET=aarch64-apple-darwin. A failed build script rewrites crates/mt-tauri/gen/schemas/*.json; git checkout them.

2026-11-13 benchmark (M4 Max, no sccache, hyperfine, cargo build -p mt-tauri, dev profile, separate target dirs). Cold (3 runs): stable 1.100.0 = 50.30s +/- 0.19, nightly 1.102 + -Zthreads=14 = 47.84s +/- 0.57 (nightly 5% faster). Incremental after touching lib.rs (5 runs, 1 warmup): stable 2.168s, nightly 2.170s (identical). Rule from plan (go stable unless nightly wins incremental by >15%) is met by a wide margin.

Decision: stable 1.100.0 pinned (ccdadb3), docs (967e35b). unused_dependencies lint dropped from scope (does not fire on mt-tauri). build.ps1 also drops the CARGO_PROFILE_RELEASE_CODEGEN_UNITS override that only existed for -Zthreads, so Windows release builds now use codegen-units=1 from Cargo.toml. Local: task cargo:lint ok (7 clippy warnings, new in 1.100), nextest 890/892 pass; the 2 failures are pre-existing shadow_diff_parity_test: sidecar_binary() builds the name as format!("mt-zig-core{host}") without a hyphen so the staged binary is never found (only passes when zig-core/zig-out/bin/mt-zig-core exists).
<!-- SECTION:NOTES:END -->
