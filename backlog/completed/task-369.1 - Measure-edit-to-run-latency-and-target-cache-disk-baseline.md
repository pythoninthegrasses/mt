---
id: TASK-369.1
title: Measure edit-to-run latency and target/cache disk baseline
status: Done
assignee: []
created_date: '2026-11-14T04:24:00Z'
updated_date: '2026-11-14T23:28:00Z'
labels: []
dependencies: []
references:
  - 'https://github.com/sharkdp/hyperfine'
documentation:
  - docs/builds.md
parent_task_id: TASK-369
type: spike
ordinal: 1000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-352 measured CI wall-clock and a single cold/warm pair (cold 1m35s, warm 3.21s on Linux x86_64) but nothing about the two dimensions that motivate this initiative: per-change-type edit-to-run latency and build-directory disk growth. Without a recorded baseline, no profile change, crate split (TASK-353), or Zig comparison can claim a win. Note that touching crates/mt-tauri/src/** currently requires the Zig sidecar to be staged first (task zig:stage TARGET=...) because Tauri's externalBin resolves eagerly; include that in what is measured, since sidecar staging cost is itself part of the dev loop. Machine: the M4 Max dev host, and record runner specs for any CI numbers.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Edit-to-run latency measured with hyperfine for four change classes: engine logic file, Tauri command/wrapper file, main.rs/lib.rs, and frontend-only (no Rust compile)
- [x] #2 cargo build --timings HTML reports archived (task notes) for a cold and a warm full build
- [x] #3 du -sh recorded for target/, target/<each triple>/, zig-core/.zig-cache, and per git worktree
- [x] #4 Disk growth recorded after building dev, release, and each optional feature (agent, mcp, devtools) in the same target dir and in separate worktrees
- [x] #5 Results recorded in task notes as a table a later task can diff against
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Harness: `benchmarks/edit-to-run/` (`bench.sh`, `env.sh`, `worktree-matrix.sh`,
`README.md`). Raw outputs (hyperfine JSON/MD, `du-*.tsv`, `sccache-*.txt`,
`--timings` HTML) are committed under `benchmarks/edit-to-run/results-2026-11-13/`.
Re-run protocol and the change-class/edit-mode definitions live in
`benchmarks/edit-to-run/README.md`. TASK-369.4, TASK-369.5 and TASK-353 should
re-run the same harness and diff against that directory.

### Environment

| | |
|---|---|
| Host | `Mac16,6`, macOS 15.8.1 (24H32), arm64 |
| CPU / RAM | Apple M4 Max, 16 cores (12P + 4E), 64 GB |
| Power | AC, battery 100 %, low-power mode off |
| Toolchain | rustc / cargo 1.100.0 (`.tool-versions`), `RUSTC_WRAPPER=sccache` 0.18.0, `CARGO_BUILD_JOBS=14` |
| Sidecar | Zig 0.16.0, `task zig:stage TARGET=aarch64-apple-darwin` |
| Linker | toolchain default (`ld`) — the repo configures none. `crates/mt-tauri/.cargo/config.toml`'s `-fuse-ld=lld` rustflags never applied (cargo reads `.cargo/config.toml` from the cwd, and cargo runs from the repo root); removed in `44dce2e`. See `docs/builds.md#linker` |
| Commit | `3634b52` (`main`) for the latency, frontend, sidecar and `--timings` runs |

The `worktree-matrix.sh` runs (AC#4b) branched from `main` as it stood mid-session
(`44dce2e` / `765b2d0`, both now on `main`); those commits differ from `3634b52` only
in the never-applied `crates/mt-tauri/.cargo/config.toml`, the Linux Dockerfile and
`docs/builds.md`, so no compiled code changed and the numbers stay comparable.

Env mirrors `taskfile.yml`: `CARGO_HOME=<root>/.cache/cargo`,
`CARGO_TARGET_DIR=<root>/target`, `RUSTC_WRAPPER=sccache`,
`CARGO_BUILD_JOBS=numCPU-2`. The `mise` cargo shim ignores `RUSTUP_TOOLCHAIN`
(see `docs/builds.md#toolchain`), so the harness calls `~/.cargo/bin/cargo`
directly. Destructive measurements (cold builds, growth curves) ran in throwaway
worktrees under `/Users/lance/git/mt.baseline-369-1*` — the main checkout's
`target/` was never cleaned.

### AC#1 — Edit-to-run latency

hyperfine, warm target dir, 1 warmup + 3 runs (10 for the frontend class),
seconds, mean. `touch` = mtime only; `edit` = append a unique comment;
`code` = append a real function (forces codegen); `noincr` = `code` with
`target/debug/incremental` deleted first. `cargo build -p mt-tauri`:

| Change class | touch | edit | code | noincr | check touch | check edit |
|---|---|---|---|---|---|---|
| engine `src/db/library.rs` | 2.17 | 2.07 | 2.23 | 6.87 | 1.03 | 1.02 |
| command `src/commands/queue.rs` | 2.07 | 2.07 | 2.26 | 6.90 | 1.02 | 1.01 |
| `src/main.rs` (bin only) | 0.59 | 0.59 | 0.62 | 0.61 | 0.31 | 0.31 |
| `src/lib.rs` (crate root) | 2.07 | 2.09 | 2.57 | 6.94 | 1.02 | 1.01 |
| frontend `js/stores/queue.js` | 0.17 | 0.17 | 0.18 | — | — | — |

Same classes with `--features agent` (what `task tauri:dev` actually builds):

| Change class | touch | edit | code | noincr | check touch | check edit |
|---|---|---|---|---|---|---|
| engine | 2.20 | 2.24 | 2.38 | 7.58 | 1.09 | 1.10 |
| command | 2.23 | 2.20 | 2.39 | 7.56 | 1.09 | 1.09 |
| `main.rs` | 0.62 | 0.62 | 0.63 | 0.64 | 0.32 | 0.32 |
| `lib.rs` | 2.24 | 2.22 | 2.75 | 7.56 | 1.08 | 1.08 |
| frontend | 0.18 | 0.18 | 0.18 | — | — | — |

Read this as: **where** you edit inside `mt-tauri` does not matter (2.0–2.4 s
for engine, command-wrapper or crate-root files — everything is one crate, so
the whole `mt_lib` crate re-codegens and re-links either way). Only a `main.rs`
change is cheap (0.6 s: bin target, link only). `touch` vs `edit` vs `code` are
within noise of each other because rustc's incremental cache is content-hash
keyed and the crate is re-codegen'd anyway; the real cliff is losing the
incremental cache — 7.6 s (2.2 s incremental + 5.4 s), which is the upper bound
a crate split can save per edit.

### AC#1b — Non-Rust parts of the same loop

| Measurement | Result |
|---|---|
| frontend-only edit → `cargo build` (no-op) | 0.178 s |
| `cargo build` after a fresh vite bundle | 0.194 s (dist does not invalidate Rust) |
| vite production bundle (`npm run build`, beforeBuildCommand) | 0.633 s |
| vite dev server "ready in" (beforeDevCommand, 3 samples) | 118 / 119 / 120 ms |
| process launch proxy: `MT_ENUMERATE_DEVICES=1 target/debug/mt` (headless early exit) | 0.037 s |
| `task zig:stage TARGET=aarch64-apple-darwin` warm | 0.122 s |
| `task zig:stage` cold (`.zig-cache`, `zig-out` **and** the staged binary deleted) | 16.92 s |
| `cargo check` with the staged sidecar removed | fails, exit 101: `resource path binaries/mt-zig-core-aarch64-apple-darwin doesn't exist` |

The eager-`externalBin` claim in the description is confirmed: without
`task zig:stage` first, even `cargo check` dies in `build.rs`
(`results-2026-11-13/check-missing-sidecar.txt`). A fresh worktree therefore pays
~17 s of Zig staging before the first Rust compile. Caveat for any re-run:
`task`'s `sources`/`generates` status check makes `zig:stage` a silent no-op
unless the staged binary itself is deleted, so a cold measurement must remove
`crates/mt-tauri/binaries/mt-zig-core-aarch64-apple-darwin`.

### AC#4a — Growth in one target dir (`mt.baseline-369-1`, cumulative)

Each row is one more `cargo build -p mt-tauri …` in the same worktree; sizes are
`du -sk` converted to GiB, wall time and crate count from the build log.

| # | Build | Wall | Crates | `target/` | `.worktree-total` |
|---|---|---|---|---|---|
| 0 | fresh worktree | 0 s | — | — | 28 MiB |
| 1 | `npm ci` + vite bundle + `zig:stage` | ~21 s | — | — | 197 MiB |
| 2 | `--features agent` (dev loop) | 1m 11s | 496 | 3.79 | 4.33 |
| 3 | `--features agent` again (no-op) | 2.63 s | 1 | 3.79 | 4.33 |
| 4 | `--features mcp` | 13.24 s | +32 | 5.23 | 5.79 |
| 5 | `--features devtools` | 20.41 s | +66 | 6.69 | 7.26 |
| 6 | `--release` | 2m 13s | 474 | 9.30 | 9.87 |
| 7 | `--target aarch64-apple-darwin --release --features agent` | 2m 18s | 496 | 12.06 | 12.63 |
| 8 | `--target aarch64-apple-darwin` (debug) | 1m 04s | 474 | 16.16 | 16.73 |

Final per-path breakdown of that worktree (GiB): `target` 16.16, `target/debug`
7.73 (of which `debug/build` 6.40, `debug/incremental` 0.84), `target/release`
3.21, `target/aarch64-apple-darwin` 5.21 (`/release` 2.16, `/debug` 3.05),
`.cache/cargo` 0.38, `app/frontend/node_modules` 0.12, `zig-core/.zig-cache`
36 MiB, `zig-core/zig-out` 8 MiB, staged sidecar 1.7 MiB.

Marginal cost of each optional feature, once built into the same target dir:
**mcp +1.44 GiB / 13.2 s / 32 crates**, **devtools +1.46 GiB / 20.4 s / 66
crates**. `agent` cannot be measured this way in isolation (it was in the first,
cold build) — see AC#4b for the matched comparison.

### AC#3 — Disk per path and per worktree

Main checkout after a normal dev session plus this spike (never `cargo clean`ed),
`results-2026-11-13/du-main-checkout.tsv`:

| Path | Size |
|---|---|
| `target/` | 12.32 GiB |
| `target/debug/build` | **10.03 GiB** |
| `target/debug/deps` | 1.12 GiB |
| `target/debug/incremental` | 657 MiB |
| `.cache/cargo` | 383 MiB |
| `app/frontend/node_modules` | 122 MiB |
| `zig-core/.zig-cache` | 36 MiB |
| worktree total | 12.96 GiB |

`target/debug/build` — not `deps` — is the footprint problem, and it is almost
all ours. `du -sk target/debug/build/*/` : `mt-tauri/` 4.84 GiB,
`objc2-app-kit/` 716 MiB, `objc2-foundation/` 328 MiB, `objc2-web-kit/` 215 MiB,
`tauri-utils/` 136 MiB, `rig-core/` 135 MiB. Of the 4.84 GiB, four build-script
fingerprint dirs hold 4.38 GiB:

| `target/debug/build/mt-tauri/<fingerprint>/out` | dir | `libmt_lib.a` | stray `mt_lib.*.rcgu.o` | `libmt_lib.rlib` |
|---|---|---|---|---|
| `0ba73eef672b54f4` | 617 MiB | 467 MiB | 65 MiB (512 files) | 85 MiB |
| `21e69052178536dd` | 769 MiB | 506 MiB | 169 MiB (1 024 files) | 93 MiB |
| `4799a73beecd553a` | 1 599 MiB | 496 MiB | 1 011 MiB (12 544 files) | 91 MiB |
| `8e40a4fbae47aeff` | 1 502 MiB | 467 MiB | 949 MiB (12 800 files) | 85 MiB |

Cause: `[lib] crate-type = ["staticlib", "cdylib", "rlib"]` in
`crates/mt-tauri/Cargo.toml`. The staticlib/cdylib codegen drops ~0.5 GiB
`libmt_lib.a` plus up to ~1.0 GiB of unlinked `mt_lib.*.rcgu.o` objects into
each build-script output dir, and every feature-set/profile combination creates
a new fingerprint dir. **The repo builds no mobile targets** (`tauri ios` /
`tauri android` appear in no taskfile or workflow), so nothing links those
artifacts. Per-build-fingerprint cost: 0.6–1.6 GiB (the two fingerprints that
accrued the most stray objects are 1.5 GiB and 1.6 GiB). See AC#4b for the measured
what-if.

### AC#4b — Per-worktree cost and the `crate-type` what-if

Three fresh worktrees from `3634b52`, each running exactly the stages
`task tauri:dev` does — `git worktree add` → `npm ci` → vite prod bundle →
`task zig:stage` → cargo — with **no shared `target/`** (each worktree gets its
own), warm sccache, measured strictly sequentially. Driver:
`benchmarks/edit-to-run/worktree-matrix.sh`; raw rows in
`results-2026-11-13/worktree-matrix-369-1-{plain,agent,rlib}.tsv`. The what-if edit
itself is one line — `results-2026-11-13/whatif-crate-type-rlib.patch`
(`crate-type = ["staticlib", "cdylib", "rlib"]` → `["rlib"]`).

| Stage / size | A: stock, no features | B: stock, `--features agent` | C: `crate-type = ["rlib"]`, `--features agent` |
|---|---|---|---|
| `git worktree add` | 1 s | 0 s | 1 s |
| `npm ci` | 1 s | 2 s | 1 s |
| vite prod bundle | 2 s | 1 s | 1 s |
| `task zig:stage` (cold) | 17 s | 23 s | 18 s |
| **debug build** | **42 s** / 474 crates | **59 s** / 496 crates | **42 s** / 496 crates |
| `target/` after debug | 3.26 GiB | 3.45 GiB | **2.48 GiB** |
| `target/debug/build` | 2.47 GiB | 2.60 GiB | 2.13 GiB |
| `target/debug/build/mt-tauri` | 703 MiB | 745 MiB | **260 MiB** |
| `target/debug/incremental` | 247 MiB | 274 MiB | 274 MiB |
| `libmt_lib.a` (debug) | 468 MiB | 496 MiB | **none** |
| `libmt_lib.dylib` (debug) | 458 KiB | 458 KiB | **none** |
| `mt_lib.*.rcgu.o` (debug) | 256 files / 65 MiB | 256 files / 70 MiB | **0** |
| **release build** | — | **150 s** / 496 crates | **69 s** / 496 crates |
| `target/` after release | — | 6.20 GiB | 4.45 GiB |
| `target/release/build/mt-tauri` | — | 521 MiB | 156 MiB |
| `libmt_lib.a` (release) | — | 355 MiB | **none** |
| `mt` binary (release) | — | 15.5 MiB | 15.5 MiB |
| **whole worktree** | 3.80 GiB | 6.75 GiB | **5.00 GiB** |

**What-if C vs B — matched pairs, same commit, same features, same stages, only
`[lib] crate-type` differs:** dropping `staticlib` + `cdylib` saves **17 s of the
debug build** (59 → 42 s), **81 s of the release build** (150 → 69 s),
**0.97 GiB of debug `target/`** and **1.75 GiB of total worktree** (6.75 → 5.00 GiB).
The release win is the larger one because the `staticlib` is compiled under
`[profile.release]` fat LTO. C also eliminates the stray `.a` / `.dylib` /
`rcgu.o` mass that dominates the long-lived main-checkout `target/` (AC#3), so on
a dev host that accumulates worktrees the saving compounds per worktree.

Nothing links those artifacts today: the only consumers of `mt_lib` are
`src/main.rs` and `examples/audio_test.rs`, both through the `rlib`; there is no
`tauri ios` / `tauri android` invocation or capability config in the repo; the
release `staticlib` only exists because CI's `--target` builds compile the lib
target for every declared crate type. So `crate-type = ["rlib"]` looks like a
~25 % artifact-footprint cut on the dev loop for free — candidate input to
TASK-369.2, gated on confirming the iOS effort (TASK-341) does not need the
`staticlib`.

### AC#2 — `cargo build --timings`

### AC#2 — `cargo build --timings`

HTML reports archived (open in a browser; they embed the crate graph and per-unit
timelines):

| Profile | Wall | Report |
|---|---|---|
| Cold full build, `--features agent` (`target/` destroyed first, in throwaway worktree) | 35.19 s | `results-2026-11-13/timings-cold/cargo-timing.html` |
| Warm full build (`touch lib.rs`, whole crate recompiles, deps cached) | 2.68 s | `results-2026-11-13/timings-warm/cargo-timing.html` |

Both from `bench.sh timings` in `mt.baseline-369-1`; the timestamped sibling files
are the same reports as cargo named them. Cargo 1.100 rejects `--timings=html` and
`--timings-dir`, so the harness runs bare `--timings` and copies
`target/cargo-timings/cargo-timing*.html` out afterwards. Cold-build `du` snapshot:
`results-2026-11-13/du-cold-build.tsv` (`target/` 3.45 GiB after a cold
`--features agent` debug build, i.e. the steady-state size is reached by the first
build, not by accumulation).

Cold shape: the 35 s is dominated by dependency codegen with only modest parallelism
gain from 14 jobs (the graph has long chains — `tauri` → `wry` → `objc2-*`), which is
why sccache matters more than job count here. Warm shape: 2.68 s is one `mt-tauri`
lib codegen unit plus link, matching the AC#1 `edit`-mode numbers.

### Cross-triple release (`x86_64-apple-darwin`)

`task tauri:build:macos-x64` builds this triple, so a universal macOS release
pays for it twice. Fresh worktree `mt.369-1-x64-wt1` (npm ci + vite + `zig:stage`
first), `--features agent`, warm sccache:

| Build | Wall | Crates | Sizes after |
|---|---|---|---|
| `--release` (host arm64) | 2m 22s (143 s) | 496 | `target/` 2.75 GiB (all in `target/release`) |
| `--release --target x86_64-apple-darwin` | 39 s | 482 | `target/` 4.31 GiB, `target/<triple>/release` 0.96 GiB, `target/release` 3.35 GiB |

So a second macOS triple costs **+1.56 GiB** (0.96 GiB in the triple dir plus
0.6 GiB of host-side proc-macro/build-script artifacts) and 39 s with a warm
sccache — the wall time is misleadingly small because dependency crates come
out of sccache; on a cold cache it is a second ~2m 22s build. Worktree total with
both releases: 4.86 GiB.

### CI numbers

Not taken. AC#5 requires runner specs with any CI figure; the existing
`docs/builds.md` / TASK-352 numbers (cold 1m35s, warm 3.21s) are Linux x86_64
self-hosted runners and are not comparable to the M4 Max host above. TASK-369.6
should re-run this harness on the runners and record the runner spec alongside.

### Findings worth carrying forward

1. **Change class is irrelevant inside `mt-tauri`** — 2.0–2.4 s for engine,
   command-wrapper and crate-root edits alike; only `main.rs` (0.6 s) differs.
   Any crate split (TASK-353) must move code *out* of the crate to pay; the
   per-edit ceiling it can recover is the 5.4 s incremental-cache gap
   (7.6 s → 2.2 s).
2. **`target/debug/build/mt-tauri` is the disk story** (4.84 of 12.32 GiB in the
   main checkout): staticlib + cdylib artifacts for targets the repo never
   builds. Removing them is the largest single footprint win, and it also
   removes work from every link.
3. **`cargo check` is ~2× faster than `cargo build`** (1.1 s vs 2.2 s) and is the
   right fast signal for IDE and CI-leg gating.
4. **Frontend work is not Rust-bound**: 0.17 s cargo no-op, 118 ms vite dev
   start, 0.63 s vite prod bundle.
5. **Optional features are not free on disk**: +1.4–1.5 GiB and 13–20 s each for
   `mcp` and `devtools` in a shared target dir.
6. **sccache helps dependencies, not our crate**: Rust hits only appear for
   dependency crates (our own crate is reported non-cacheable with the current
   crate-types). A warm cache takes a fresh-worktree 496-crate dev build from
   1m 11s to 36 s — relevant to TASK-369.6's CI caching fix.
7. **Zig staging is a real dev-loop cost in fresh worktrees**: 16.9 s cold,
   0.12 s warm, and it must run before any Rust compile because `externalBin`
   resolves eagerly.

RAW EVIDENCE DIR REMOVED 2026-11-14 by maintainer decision: benchmark harness output is not kept in the source tree, so the `benchmarks/edit-to-run/results-2026-11-13/` paths cited above no longer exist (line "are committed under ..." above is superseded; the tables in this record are the durable source). Everything deleted is regenerable and still readable in git history before the removal commit: cd benchmarks/edit-to-run && ./bench.sh "latency touch"|"latency edit"|"latency code"|"latency noincr"|"check code"|frontend|sidecar|disk|timings, plus ./worktree-matrix.sh 369-1-{plain,agent,rlib} 1. results-*/ is now gitignored so future runs stay out of git status.

FINDING PRESERVED FROM THE DELETED sccache-*.txt CAPTURES (it existed nowhere else, and it matters for how the latency numbers above should be read): the host dev loop gets essentially no sccache benefit. dev-code 3628 compile requests / 4 hits, dev-agent-code 3656/4, dev-edit 541/0, dev-agent-edit 569/0, dev-noincr 597/0, dev-agent-noincr 625/0, dev-touch 34/0, dev-agent-touch 62/0, check-touch 458/0, check-edit 653/0, check-agent 513/0, check-agent-edit 681/0. Across 22 captures on 2026-11-13 and 2026-11-14 (the later set recorded in TASK-369.5) RUSTC_WRAPPER=sccache returns 0-4 hits on 34-3656 requests, so the edit-to-run figures above are true incremental-compile costs with no cache assistance. Direct evidence for TASK-369.6 (CI compilation caching, sccache bypass); surfaced to the maintainer rather than written into TASK-369.6, which another agent is actively editing.
<!-- SECTION:NOTES:END -->
