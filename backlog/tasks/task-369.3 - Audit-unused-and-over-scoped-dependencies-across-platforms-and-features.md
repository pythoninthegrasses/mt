---
id: TASK-369.3
title: Audit unused and over-scoped dependencies across platforms and features
status: To Do
assignee: []
created_date: '2026-11-14T04:24:00Z'
updated_date: '2026-11-14T05:59:00Z'
labels: []
dependencies:
  - TASK-361
references:
  - 'https://doc.rust-lang.org/cargo/reference/lints.html#unused_dependencies'
documentation:
  - docs/builds.md
parent_task_id: TASK-369
type: task
ordinal: 2000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
mt-tauri declares ~50 direct dependencies plus dev-dependencies (tempfile, proptest, wiremock) against a 1443-normal-dep graph, and some may be dead or platform-misplaced after recent refactors (e.g. raw-window-handle and windows-sys exist only for the Windows souvlaki HWND path). Rust 1.100's cargo::unused_dependencies lint was adopted by TASK-361 but found NOT to fire on mt-tauri at all (bin/lib target shapes suppress it), so this audit must use TASK-361's documented fallback (cargo rustc -p mt-tauri --lib -- -W unused-crate-dependencies) plus CARGO_LOG=cargo::diagnostics::rules::unused_dependencies=debug cargo check --workspace --all-targets for dev-dependencies, and must be repeated per platform (macOS, Linux, Windows) and per optional feature (default, agent, mcp, devtools) because a dep unused on one platform can be load-bearing on another. Removals that survive all matrices land with a green CI run.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Fallback lint run per platform and per feature; findings recorded in task notes including dev-dependency results from the CARGO_LOG debug path
- [ ] #2 Every flagged dependency either removed in a commit or annotated with the platform/feature that requires it
- [ ] #3 False-positive classes documented (feature-activation deps, cfg-gated deps) so a future rerun does not re-litigate them
- [ ] #4 cargo tree -e normal | wc -l recorded before and after; docs/builds.md notes the final count
- [ ] #5 task lint, task test, and CI green after removals
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Heavy-but-narrow candidates found during TASK-369.2 (2026-11-13, untriaged)

Counts come from cargo tree -e normal reachability diffs plus a RUSTC_WRAPPER timing log on macOS aarch64, cargo 1.100. A count is the crates that exist only for that dependency.

reqwest: 39 unique crates / 14.3 MiB of vendored source. Check whether all default features (TLS stack, json, cookies, reconnect) are needed; default-features=false plus an explicit feature list is the same class of win TASK-369.2 got for imageproc.

imageproc after the TASK-369.2 trim: still drags a non-optional linear-algebra stack (nalgebra, simba, wide, safe_arch, matrixmultiply, num and its sub-crates, itertools, libm, rand_distr, approx) — 15 crates, 7.9s of compile CPU, 104 MiB — while we use exactly one function, imageproc drawing draw_text_mut. Dropping imageproc alone was measured and rejected because image plus moxcms and pxfm are kept anyway; revisit if the renderer goes away entirely.

lru 0.12 with parking_lot: backs a 100-entry artwork LRU in scanner/artwork_cache.rs. Compare against a hand-rolled HashMap plus VecDeque or direct hashbrown use; parking_lot is probably shared with other crates, lru may not be.

lofty: largest single tag-reader dependency and it covers every container format. Check which formats the scanner can actually reach and whether lofty's format features can be narrowed.

sha2 0.10.9 and md5 0.7 are declared side by side in the Cargo.toml Hashing block. If both only feed cache keys one may be redundant; if both stay, record which subsystem needs each so the audit does not remove a load-bearing one.
<!-- SECTION:NOTES:END -->
