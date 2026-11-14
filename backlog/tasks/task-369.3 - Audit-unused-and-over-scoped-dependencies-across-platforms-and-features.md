---
id: TASK-369.3
title: Audit unused and over-scoped dependencies across platforms and features
status: Done
assignee:
  - '@lance'
created_date: '2026-11-14T04:24:00Z'
updated_date: '2026-11-14T07:10:00Z'
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
- [x] #1 Fallback lint run per platform and per feature; findings recorded in task notes including dev-dependency results from the CARGO_LOG debug path
- [x] #2 Every flagged dependency either removed in a commit or annotated with the platform/feature that requires it
- [x] #3 False-positive classes documented (feature-activation deps, cfg-gated deps) so a future rerun does not re-litigate them
- [x] #4 cargo tree -e normal | wc -l recorded before and after; docs/builds.md notes the final count
- [x] #5 task lint, task test, and CI green after removals
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Approach

Audit mt-tauri's declared dependencies with the documented fallback lints (cargo::unused_dependencies does not fire on this crate's target shapes — TASK-361), triage every flag, and land removals/feature trims that survive the platform x feature matrix. macOS arm64 runs locally; Linux via the Docker build image; Windows via CI (no local MSVC). No crate upgrades, no renderer/cache/profile/sccache work (sibling tasks own those).

### Stale premises in the task description (verified 2026-11-14)

- raw-window-handle and windows-sys are ALREADY windows-scoped ([target.'cfg(target_os = "windows")'.dependencies]); windows-sys feeds GetDriveTypeW in cache/mount_detect.rs as well as the souvlaki HWND path.
- sha2 and md5 are both load-bearing: sha2 = scanner/fingerprint.rs content hashes; md5 = lastfm/signature.rs API signatures. Not redundant; annotate per AC#2.
- tempfile/proptest/wiremock all have real test consumers.

### Steps

1. Baseline on macOS aarch64, cargo 1.100: `cargo tree --locked -e normal | wc -l` (1180), unique package count, `grep -c '^\[\[package\]\]' Cargo.lock` (771). Re-measure after changes; do NOT reuse the 1443 figure from TASK-352.
2. Stage zig sidecar (`task zig:stage-placeholder` per test.yml lint job) before any cargo run; `git checkout crates/mt-tauri/gen/schemas` if build.rs rewrites them.
3. Per feature set (default, agent, mcp, devtools, and --all-features for unification): `~/.cargo/bin/cargo rustc -p mt-tauri --lib -- -W unused-crate-dependencies`, then `CARGO_LOG=cargo::diagnostics::rules::unused_dependencies=debug cargo check --workspace --all-targets` for dev-deps and hidden candidates. Use ~/.cargo/bin/cargo (mise shim ignores RUSTUP_TOOLCHAIN).
4. Linux: same two commands inside docker/linux image via docker run. Windows: cargo rustc --lib lint cannot run locally (needs MSVC); run via CI on the Windows runner or annotate as CI-deferred with source-level cfg evidence for every windows-only dep.
5. Triage each flag: removable / required-by-platform-or-feature / feature-activation or version-pinning dep (documented false positive) / inconclusive.
6. Feature-scope survey (AC#2 "over-scoped"): reqwest (default features incl. TLS/json/cookies vs. actual use in lastfm, lyrics, plex, sidecar, shadow_diff, agent setup), lofty (which container format features are reachable), tokio. Verify reqwest feature list for 0.12 against docs before trimming; confirm savings with cargo tree, and with/without `agent` because feature unification can erase them.
7. Land changes as atomic commits (each removal/trim self-contained with its lockfile), then re-run audit + `task lint`, `task test`, targeted nextest groups.
8. Record findings, before/after counts, and false-positive classes in notes; docs/builds.md gets the reproducible command block and final count; CI green on the branch revision before marking Done.

### Risks

- cfg-gated deps (objc2*, dispatch2, libc, windows-sys) can be invisible to --lib lint on the wrong host: never remove one on the evidence of a single platform.
- reqwest trimming TLS breaks HTTPS silently — mock/HTTP tests won't catch it; needs a live HTTPS check (Plex ping or Last.fm handshake) after the change.
- Lofty feature names/format gating unverified until checked against 0.22 docs; don't guess feature names.

Adjustment made during execution: the Linux leg of the matrix runs natively on CI (blacksmith runner via setup-tauri-build mode=check + task ci:unused-deps) rather than local Docker, giving all 12 platform x feature cells identical clean-checkout conditions in one workflow_dispatch run. Verified windows/devtools cell compiled cold (~6.5 min per command, exit 0, zero warnings). Final solution = task ci:unused-deps + Test workflow dep-audit job + docs/builds.md#dependency-audit.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Heavy-but-narrow candidates found during TASK-369.2 (2026-11-13, untriaged)

Counts come from cargo tree -e normal reachability diffs plus a RUSTC_WRAPPER timing log on macOS aarch64, cargo 1.100. A count is the crates that exist only for that dependency.

reqwest: 39 unique crates / 14.3 MiB of vendored source. Check whether all default features (TLS stack, json, cookies, reconnect) are needed; default-features=false plus an explicit feature list is the same class of win TASK-369.2 got for imageproc.

imageproc after the TASK-369.2 trim: still drags a non-optional linear-algebra stack (nalgebra, simba, wide, safe_arch, matrixmultiply, num and its sub-crates, itertools, libm, rand_distr, approx) — 15 crates, 7.9s of compile CPU, 104 MiB — while we use exactly one function, imageproc drawing draw_text_mut. Dropping imageproc alone was measured and rejected because image plus moxcms and pxfm are kept anyway; revisit if the renderer goes away entirely.

lru 0.12 with parking_lot: backs a 100-entry artwork LRU in scanner/artwork_cache.rs. Compare against a hand-rolled HashMap plus VecDeque or direct hashbrown use; parking_lot is probably shared with other crates, lru may not be.

lofty: largest single tag-reader dependency and it covers every container format. Check which formats the scanner can actually reach and whether lofty's format features can be narrowed.

sha2 0.10.9 and md5 0.7 are declared side by side in the Cargo.toml Hashing block. If both only feed cache keys one may be redundant; if both stay, record which subsystem needs each so the audit does not remove a load-bearing one.

2026-11-14 macOS arm64 audit (cargo 1.100, ~/.cargo/bin/cargo, placeholder sidecar staged): lib-lint `cargo rustc -p mt-tauri --lib -- -W unused-crate-dependencies` and CARGO_LOG=cargo::diagnostics::rules::unused_dependencies=debug `cargo check --workspace --all-targets` run per feature set default/agent/mcp/devtools: ZERO warnings and ZERO mt-tauri debug candidates in all four. Transitive `ignoring unused extern ... package is capped` debug lines are upstream crates' edition-cap quirks, not our manifest. Caveat found: a warm local target/ can replay mt-tauri freshness without recompiling under --all-targets, so the CI dep-audit matrix (clean checkouts, native runners) is the authoritative per-platform record.

AC#2 annotations — every candidate resolved: reqwest default-features=false with default-tls (HTTPS), charset (gates Response::text() used by shadow_diff + agent/setup), json, system-proxy; http2 dropped (commit 7842778). sha2 -> scanner/fingerprint.rs track hashes; md5 -> lastfm/signature.rs API signatures (both load-bearing, NOT redundant). windows-sys (single feature Win32_Storage_FileSystem) -> GetDriveTypeW in cache/mount_detect.rs; raw-window-handle -> souvlaki HWND in media_keys.rs; both already windows-scoped (task description premise stale). libc -> statfs in mount_detect (cfg(unix), lint-clean on macOS). tokio features all have source consumers (fs in lib.rs save paths). Dev-deps tempfile/proptest/wiremock all used by tests. lru kept: sole reverse-dep but removal saves 1 crate; parking_lot shared with r2d2/scheduled-thread-pool. lofty kept: its only optional feature is id3v2_compression_support (default) whose flate2 is shared with png -> zero-crate win. reqwest 0.13.2 in Cargo.lock is tauri's MOBILE-target dep (cfg android/apple-non-macos), never built on desktop.

AC#4 counts: cargo tree --locked -e normal | wc -l = 1180 before, 1162 after the reqwest trim (h2 + its h2-only deps left the production tree; wiremock keeps h2 in dev). Cargo.lock package count 771 unchanged (dev users keep h2). docs/builds.md#dependency-audit records the final count, the rerun commands, and the false-positive classes (AC#3).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The audit found one real trim and closed every other lead with evidence. Landed on branch task-369-3-dep-audit in four commits: build(deps) drop reqwest http2 feature (7842778), ci(audit) add ci:unused-deps task and dispatch-gated dep-audit matrix (9de769f), docs(builds) dependency-audit runbook and matrix fix (64aab09), docs(backlog) record audit, annotations and counts (4caae68).

Change: reqwest is now default-features = false with an explicit list of default-tls, charset, json and system-proxy. http2 was the only default we do not use: Last.fm, Plex, lrclib and the Zig sidecar all speak HTTP/1.1 and ALPN falls back when h2 is absent. That removes h2 and its h2-only dependencies from every production build; cargo tree --locked -e normal goes from 1180 to 1162 lines. Cargo.lock stays at 771 packages because wiremock's hyper/full still pulls h2 for dev builds. Each retained feature is justified in the Cargo.toml comment: default-tls for HTTPS, charset because it gates Response::text() (shadow_diff, agent/setup), json for the API clients, system-proxy to honour OS proxy configuration.

Audit result: zero unused-dependency findings anywhere. On macOS arm64 the lib-level lint (cargo rustc -p mt-tauri --lib -- -W unused-crate-dependencies) and the cargo-level debug path (CARGO_LOG=cargo::diagnostics::rules::unused_dependencies=debug cargo check --workspace --all-targets) were clean for all four feature sets, and the CI dep-audit matrix compiled all 12 cells (macOS/Linux/Windows x default/agent/mcp/devtools) green on clean checkouts in run 43567824407, with zero warnings; the windows/devtools log shows genuine cold compiles of about 6.5 minutes per command rather than freshness replays. The debug path is the only one that inspects dev-dependencies: tempfile, proptest and wiremock all have real test consumers.

Keeps, each with a named consumer (AC#2): sha2 fingerprints tracks in scanner/fingerprint.rs and md5 signs Last.fm requests in lastfm/signature.rs, so the two hashing crates are not redundant. windows-sys (one feature, Win32_Storage_FileSystem) feeds GetDriveTypeW in cache/mount_detect.rs and raw-window-handle feeds the souvlaki HWND path; both already sit in a cfg(target_os = "windows") table, so the task description's premise that they were misplaced is stale. libc does statfs under cfg(unix). Every declared tokio feature has a source consumer. lru stays because removal saves a single crate (hashbrown and parking_lot are shared with r2d2). lofty stays because its only optional feature is id3v2_compression_support and its flate2 is shared with png, so trimming saves nothing. reqwest 0.13.2 in the lock is tauri's mobile-target dependency and is never built on desktop.

New entry point, because a rerun needs the whole matrix on native runners: task ci:unused-deps TARGET=triple FEATURE=default|agent|mcp|devtools, driven by the Test workflow's dispatch-only dep-audit job (gh workflow run test.yml --ref <branch> -f dep-audit=true). Native clean checkouts are mandatory, not a preference: a warm local target/ can replay mt-tauri freshness without recompiling, and cfg-gated deps are invisible to a lint run on the wrong platform. docs/builds.md#dependency-audit carries the commands, the verdict table and the three false-positive classes so a future rerun does not re-litigate them.

Verification: cargo nextest run --workspace 892 passed, 5 skipped; cargo clippy --workspace --all-features -D warnings clean; task lint and task test exit 0; CI run 43567824407 fully green across all 22 jobs including the three platform builds. Because trimming TLS-adjacent reqwest features fails silently for mock-based tests, a live HTTPS smoke test ran through the exact trimmed feature set against Last.fm ping (TLS handshake plus json) and example.com (the charset-gated text() path), both HTTP/1.1 as expected.

Stated gaps: the HTTPS check is a standalone harness, not the app's own code path, so an app-level Last.fm or Plex round trip after this merge is worth a manual glance. Agent builds still get http2 back because rig-core's reqwest-tls feature enables reqwest/default; the comment in Cargo.toml records that caveat rather than fighting it. No crate versions changed and no renderer, cache, profile or sccache work was touched — those belong to sibling tasks.
<!-- SECTION:FINAL_SUMMARY:END -->
