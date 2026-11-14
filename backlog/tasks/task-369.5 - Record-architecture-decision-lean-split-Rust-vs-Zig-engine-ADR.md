---
id: TASK-369.5
title: 'Record architecture decision: lean-split Rust vs Zig engine (ADR)'
status: In Progress
assignee:
  - assistant
created_date: '2026-11-14T04:24:00Z'
updated_date: '2026-11-14T23:19:00Z'
labels: []
dependencies:
  - TASK-369.1
  - TASK-353
  - TASK-355
  - TASK-355.6
references:
  - 'https://doc.rust-lang.org/cargo/reference/profiles.html'
documentation:
  - zig-core/README.md
  - docs/tauri-architecture.md
parent_task_id: TASK-369
type: spike
ordinal: 6000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-355 proves the mechanics of a Zig sidecar but deliberately answers only the narrow POC question; TASK-352 ruled out CI wall-clock as justification and redirected any migration case to dev-loop and code-ownership grounds; TASK-353 will move db/scanner/lastfm/plex/cache/metadata into a tauri-free mt-core crate. What no task yet does is compare, on equal functionality and safety, the two end-states this initiative makes concrete: (A) lean split Rust -- mt-core extracted, unused/over-scoped deps removed, tuned profile, working CI caches -- versus (B) a Zig engine owning a complete subsystem (database/library read path first, per the existing zig-core spike), which must also delete its Rust counterpart to count as a win. Today the migration pays twice: rusqlite's bundled SQLite and zig-core's vendored sqlite3.c both compile. Benchmarks should cover edit-to-run latency for engine-only and shell-only changes, engine-test turnaround, cold/warm builds, and total disk including worktree fan-out; release wall-clock is one column, not the verdict. Produce an ADR-style recommendation (adopt-lean-Rust, adopt-Zig-engine, or hybrid with a named subsystem list) with the measured numbers, and record it on this task and in docs/. Cross-check against the TASK-355.6 POC report when it lands.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Both end-states A and B benchmarked on identical measurements: engine-edit-to-run, shell-edit-to-run, engine-test turnaround, cold/warm build, total disk across worktrees
- [ ] #2 The double-SQLite cost during migration is quantified (Rust bundle + vendored amalgamation) and the delta from actually deleting the Rust side is shown
- [ ] #3 ADR document added under docs/ with decision, measured evidence, rejected alternatives, and consequences
- [ ] #4 Recommendation names concrete next actions (e.g. which subsystem ports, which crates still split) and creates follow-up tasks for them via Backlog
- [ ] #5 TASK-355.6 POC report and TASK-353 results cited as inputs, with divergences explained
- [ ] #6 Complete the measurement gaps handed off by TASK-355.6: completed-sidecar cold/warm build timings and controlled CI wall-clock and Rust dependency-count deltas against TASK-352, distinguishing host/revision/cache differences and unrelated Rust optimizations from migration effects.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Working environment

Worktree `~/git/mt.zig-engine-adr`, branch `zig-engine-adr` off `main` at d5cd25b, managed with worktrunk (`wt switch --create zig-engine-adr`). The arm-B port is deliberately destructive and lives only on this branch; it is never intended to merge. Merge target is the ADR document plus this task's evidence.

## Coordination boundary

TASK-369.6 (CI compilation caching) is being worked in the main checkout, `~/git/mt`, by another agent. Its files are therefore read-only here: `taskfiles/ci.yml`, `.github/actions/setup-tauri-build/action.yml`, `.github/workflows/test.yml`. This task reads their state for the CI column of the comparison but does not edit them, and the CI wall-clock numbers must be re-checked against whatever 369.6 lands.

The Backlog MCP resolves `backlog/tasks/` against the current working directory, so task edits here land on this branch, not on `main`. Two consequences: the kanban in `main` lags until merge, and any `task_create` for AC#4 must check the high-water id in BOTH checkouts first, because Backlog does not enforce id uniqueness (the TASK-341 double-owner incident).

## Existing evidence (do not re-measure)

- TASK-369.1 baseline: `benchmarks/edit-to-run/results-2026-11-13/` — 2.2s build / 1.0s check warm, 0.6s main.rs touch, 6.9s with incremental wiped, 35.2s cold; target/ 12.3 GiB with 10.03 GiB in target/debug/build; crate-type rlib what-if: -17s debug, -81s release, -1.75 GiB per worktree; 1270 cargo-tree lines / 421 unique crates.
- TASK-353 AC#4 controlled pair, HEAD b685a9e vs pre-split 2aca72f on this machine: cold build 44.53s (437 crates) vs 48.81s (436); warm no-op 1.83 vs 2.12; warm rebuild on main.rs 0.56 vs 0.56; warm rebuild on moved db/queue.rs 2.37 (2 crates) vs 2.12; first --tests 24.19 (361) vs 25.21 (360); clean -p mt-tauri --tests 7.59 (2) vs 7.72 (1); cold --tests 48.76 (459) vs 47.00 (458); mt-core-only --tests 14.34 (84 crates). Conclusion recorded: no wall-clock claim; the lever is footprint (core 326 crates vs 1,162 pre-split, 686 of 1,071 tests).
- TASK-355.x Zig POC: read-only `GET /api/library` with bearer auth, vendored sqlite3.c, shadow-diff parity harness. TASK-355.6 holds the factual POC report.
- TASK-369.4 / .9: release-profile LTO and codegen-units measurements in `benchmarks/release-profile/results-2026-11-14/`.

## Approach

1. Inventory the recorded numbers above into a single comparison table and name the holes precisely, so no measurement is repeated and no claim rests on a number from a different host, revision or cache state.
2. AC#2 first, because it needs no port: quantify the duplicate SQLite cost. Compile time and artifact bytes for rusqlite's bundled SQLite inside the workspace build, and for zig-core's vendored `sqlite3.c`; cargo-tree and `target/` deltas; then the arithmetic of actually deleting the Rust side (which crates leave the graph, what the read path must then shell or IPC through).
3. AC#1 arm A: run the existing harness (`benchmarks/edit-to-run/bench.sh`, `worktree-matrix.sh`) on this tree for engine-edit-to-run, shell-edit-to-run, engine-test turnaround, cold/warm build and disk across worktrees. Same procedure and cache discipline as the TASK-353 AC#4 pair (separate fresh `CARGO_TARGET_DIR` per arm, sccache noted as a confound) so the columns are comparable.
4. AC#1 arm B: port one complete subsystem to Zig on this branch only — the library read path, which zig-core already serves read-only — and delete its Rust counterpart so the win is real rather than additive. Measure the identical matrix on the same machine. If the port proves too large to be a fair throwaway, shrink the subsystem rather than shrinking the measurement set.
5. AC#6: controlled CI wall-clock and dependency-count deltas against TASK-352, with host/revision/cache differences and unrelated Rust optimizations separated from migration effects. Reuse 369.6's outcome rather than competing with it.
6. AC#3/#5: write the ADR under `docs/` following the existing ADR convention in that directory; cite TASK-355.6 and TASK-353 as inputs and explain divergences. Recommendation is one of adopt-lean-Rust, adopt-Zig-engine, or hybrid with a named subsystem list.
7. AC#4: name concrete next actions and create the follow-up tasks, after cross-checking the high-water task id in both checkouts.

## Explicitly out of scope

Any change to CI caching (369.6), the frontend flip beyond what arm B requires, and merging the arm-B port.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-11-14 (backlog tidy): TASK-355's AC#2 (written recommendation with measured numbers: build times, CI delta, dependency-count delta) was handed here when the POC was closed, so treat it as part of this ADR's scope. Measured inputs already recorded: TASK-369.1 baseline in benchmarks/edit-to-run/results-2026-11-13/ (2.2s build / 1.0s check warm, 0.6s main.rs, 6.9s with incremental wiped, 35.2s cold; target/ 12.3 GiB with 10.03 GiB in target/debug/build; crate-type = ["rlib"] what-if: -17s debug, -81s release, -1.75 GiB per worktree; 1270 cargo-tree lines / 421 unique crates normal-deps) and TASK-355's Zig POC results (read-only /api/library endpoint with bearer-token auth and a shadow-diff parity harness against the Rust path).

2026-11-14 (POC report reconciliation): TASK-355.6 now contains the factual six-subtask POC report and is an explicit dependency. Its original broader recommendation requirement is handed here, consistent with TASK-355's existing closeout. Remaining evidence includes completed-sidecar cold/warm build timings and controlled CI/dependency-count deltas: 355.1's 44s/23s numbers are whole-job timings for the initial Zig 0.15.2 placeholder, 355.2 only records an approximately 3s cold local build, and TASK-352's 9m34s run already contains the sidecar jobs. Do not claim a measured zero CI delta or use 1443-to-1270 tree-line counts from different revisions/hosts as Zig-attributable savings. Complete TASK-353 first, then compare equal functionality with explicit Rust deletion, quantify duplicate SQLite cost, and make the sole broader migration decision here.

Started 2026-11-14 in worktree ~/git/mt.zig-engine-adr (branch zig-engine-adr off main at d5cd25b, created with `wt switch --create zig-engine-adr`). Worktree is bare by design: no crates/mt-tauri/binaries/ (gitignored), no app/frontend/node_modules, no target/, and tests/fixtures/ holds only strip_sort_prefix.json, so mt_fixture.db must be regenerated with task zig:fixture before any workspace test run.

Coordination: another agent is on TASK-369.6 in the main checkout, so taskfiles/ci.yml, .github/actions/setup-tauri-build/action.yml and .github/workflows/test.yml are read-only on this branch.

AC#2 measured 2026-11-14 in the worktree (arm64 macOS, rustc 1.100.0, zig 0.16.0, RUSTC_WRAPPER unset, log at /private/var/folders/d9/hll1wqjj58s73bcqwtgh2sgr0000gn/T/opencode/adr-measure/sqlite-dup-2026-11-14.log). Rust half: `cargo build -p libsqlite3-sys` cold 3.09s (user 6.36s), warm no-op 0.10s, artifact target/debug/build/libsqlite3-sys/246657912ed894a8/out/libsqlite3.a = 3.9 MB at the dev profile. Zig half: vendored zig-core/vendor/sqlite3/sqlite3.c is 9.0 MB / 265,908 lines tracked in the repo; full `zig build -Dtarget=aarch64-macos -Doptimize=ReleaseSafe` cold 16.48s of which the separate `compile lib sqlite3` step is 8s at 674 MB MaxRSS and the app itself 4s at 453 MB; warm no-op 0.10s; .zig-cache 36 MB; staged sidecar 1,826,824 bytes. build.zig:3-4 states its C flags are carried from libsqlite3-sys 0.36 build.rs minus unused extensions, so the two compiles are fairly comparable. Conclusion: the duplicate SQLite compile is real but costs about 11s on a cold build only, against a ~45s cold workspace build, and both halves are 0.10s warm. The "migration pays twice for SQLite" argument is therefore weak as a motivator.

Structural finding that constrains arm B (found while scoping the bounded port, before writing any Zig): deleting the Rust read path cannot remove rusqlite, libsqlite3-sys, r2d2 or r2d2_sqlite from the dependency graph, because SQLite in Rust is pervasive, not read-path-specific. crates/mt-core/src/db holds 22 modules (queue, favorites, playlists, settings, scrobble, watched, lyrics, dedup, revision, removed, schema, models, stats, library, lastfm_loved) and mt-tauri still uses rusqlite::Connection directly in library/reconcile.rs:66 plus with_conn in lib.rs:738,774 and agent/{evals,tools}.rs. cargo tree confirms the edges: rusqlite is pulled by mt-core, mt-tauri directly, and r2d2_sqlite. So the double compile is structural and only disappears if the whole engine moves, not by incrementally porting a read subsystem. Arm B must therefore be judged on code ownership and incremental-rebuild scope, and it adds an HTTP boundary where none exists today: agent/tools.rs calls library::get_all_tracks(conn, &query) at three sites (322, 519, 718) with a live connection, so porting the read path re-points the agent at the sidecar and makes the agent dependent on a running sidecar.

Bounded port size, measured rather than guessed: the Rust read path is crates/mt-core/src/library/queries.rs (8 pub fn) + section.rs (1 pub fn) over crates/mt-core/src/db/library.rs (39 pub fn of SQL), with 64 test functions across queries_tests.rs (14), queries_read_tests.rs (25), section_tests.rs (16) and section_dispatch_tests.rs (9) -- about 1,328 lines, roughly 18 percent of mt-core's 358 test functions -- all of which need a Zig equivalent or deletion. zig-core already carries library.zig at 38 KB, server.zig with exactly one route (GET /api/library, server.zig:85), and sqlite.zig at 11.7 KB of bindings.

Harness note for the arm A capture: benchmarks/edit-to-run/env.sh pins CARGO_HOME to the project-local .cache/cargo and defaults RUSTC_WRAPPER to sccache, so a fresh worktree pays a full registry download unless .cache/cargo is seeded from the main checkout (done here with `cp -c -R`, APFS clone, 383 MB). The main checkout's target/ is now 32 GB against the 12.3 GiB TASK-369.1 recorded, which is itself evidence for the artifact-footprint column. README.md's change-class table still names engine as crates/mt-tauri/src/db/library.rs, deleted by TASK-353; bench.sh:27 is already correct. Harness timings require nothing else compiling, so the 369.6 agent's builds in the main checkout can contaminate a run: check `pgrep -fl "cargo|rustc|nextest"` and vm.loadavg before trusting a group, and re-run any group that overlapped.

AC#1 arm A measured, harness output in benchmarks/edit-to-run/results-2026-11-14/ (uncommitted, plus raw logs at /private/var/folders/d9/hll1wqjj58s73bcqwtgh2sgr0000gn/T/opencode/adr-measure/{armA-harness.log,armA-rerun.log}). Warm dev profile, arm A = lean split on main, all numbers from an idle machine re-run: dev `cargo build -p mt-tauri` after a code change -- engine (crates/mt-core/src/db/library.rs) 2.647s +/- 0.016, command (mt-tauri/src/commands/queue.rs) 1.810s +/- 0.015, lib (mt-tauri/src/lib.rs) 2.149s +/- 0.016, main (main.rs) 0.560s +/- 0.001, frontend (js/stores/queue.js) 0.170s +/- 0.003; with --features agent: engine 2.854s, command 1.942s. cargo check same classes: engine 1.438s, command 0.841s, lib 0.850s, main 0.305s (agent variants 1.539/0.907/0.917/0.313). Worst case with the incremental cache wiped: engine 7.343s. sidecar task zig:stage 17.536s cold / 0.116s warm. The first pass ran at load 18.4 and 10.1 and was discarded: it inflated dev/code/lib from 2.149 to 3.332 and frontend from 0.170 to 0.259, so keep only the idle figures.

AC#1 footprint, arm A (bench.sh disk, this worktree): target/ 6.39 GB of which target/debug/build alone is 5.52 GB and target/debug/incremental 397 MB; .zig-cache 35.8 MB, zig-out 8.3 MB, staged sidecar 1.7 MB, .cache/cargo 382.6 MB, node_modules 122.4 MB, whole worktree .worktree-total 6.98 GB. main target/ is now 32 GB against the 12.3 GiB TASK-369.1 recorded.

AC#1 engine-test turnaround, the column the TASK-369.1 harness does not cover: `cargo nextest run -p mt-core` 692 passed / 1 skipped in 2.53-2.57s steady state (about 0.13s build + 2.1s run) but 19.88s whenever the test profile has to be compiled; `mt-core --all-features` 698 passed / 1 skipped in 6.46s; `cargo nextest run -p mt-tauri -E "not test(/shadow_diff_parity_test::/)"` (the CI filter) 331 passed / 4 skipped in 47.35s on a first build, dominated by compiling the desktop test profile -- that 47s is the TASK-369.12 pain quantified, but it is a first-build figure, the steady-state repeat was killed before it ran.

Correction to the coordination note above: TASK-369.6 is NOT in the main checkout. The other agent works in its own worktree /Users/lance/git/mt-369-6 on branch ci/369-6-cache-bypass (git worktree list: main, mt-369-6, mt.zig-engine-adr). Contamination risk for timing groups therefore comes from builds in that worktree, and it shares the machine and sccache. Check pgrep -x "cargo|rustc|nextest" and sysctl -n vm.loadavg immediately before every timing group; the load-average 1-minute value lags a killed build by tens of seconds, so wait for it to fall.

Stopped state (2026-11-14, user asked to stop all runs): a background chain doing worktree-matrix.sh 369-5-armA 1 + steady-state mt-tauri and mt-core --all-features nextest repeats + bench.sh timings was SIGTERM-killed while still in the matrix stage, so three AC#1 cells are still empty and must be re-run before the ADR can be written: (1) ./worktree-matrix.sh <label> 1 for the per-worktree column -- baseline for comparison already exists at results-2026-11-13/worktree-matrix-369-1-plain.tsv (git worktree add 1s, npm ci 1s, vite 2s, zig:stage cold 17s, cargo build -p mt-tauri 42s, 474 crates compiled, target 3.42 GB, .cache/cargo 371 MB) and worktree-matrix-369-1-agent.tsv (59s, 496 crates, target 3.62 GB, plus --release 150s); (2) ./bench.sh timings for cold/warm full builds -- it does `rm -rf target` so run it LAST, after every other timing group; (3) one steady-state repeat of the mt-tauri nextest command above. The half-built throwaway worktree ../mt.369-5-armA-wt1 and branch baseline/369-5-armA-wt1 created by the killed run were removed, and the partial results tsv deleted, so a re-run starts clean.

Harness defects found while preparing the evidence dir. One is fixed, one remains. Fixed: an earlier interrupted pass left benchmarks/edit-to-run/results-2026-11-14/hyperfine-dev-code-main.json at 0 bytes, which broke `bench.sh summary` because bench.sh:209 feeds every hyperfine-*.json to the python summarizer with no guard; the idle re-run overwrote it, and the committed dir now has all 54 exports parseable with `./bench.sh summary` exiting 0. Note the underlying fragility is still unfixed in the script: any killed run can leave a 0-byte export and break summary again. Remains: README.md's change-class table still names engine as crates/mt-tauri/src/db/library.rs, deleted by TASK-353, while bench.sh:27 already points at crates/mt-core/src/db/library.rs, so only the doc is stale.

Arm B design input found before writing any Zig: parity verification is largely already built. crates/mt-tauri/src/shadow_diff.rs (355 lines) plus crates/mt-tauri/src/shadow_diff_parity_test.rs (394 lines, excluded from CI by the shadow_diff_parity_test filter) already diff the Rust library response against the sidecar GET /api/library, with zig_query_string() translating a LibraryQuery to the sidecar query contract and a form_urlencode with its own tests. On the Zig side zig-core/src/library.zig already implements the read-path query layer -- SortColumn/SortOrder, artist_sort_expr, orderByClause, Query, parseQuery, buildWhere, buildCountSql, the 23-column select_columns list and respond()/respondWithSabotage() -- and carries 19 of zig-core's 35 tests. So the port is response-shaping plus callers, not SQL from scratch. The Rust side to delete is mt-core/src/library/queries.rs (get_all_query, get_all, get_count, find_offset, find_track_offset, get_stats, get_track, get_missing) and section.rs (1 pub fn); note mt-tauri/src/commands/library/mod.rs:608 calls db::library::get_all_tracks directly and crates/mt-tauri/src/db/library.rs stays because mutations, reconcile and the other 21 db modules depend on it.

Evidence committed 2026-11-14 in benchmarks/edit-to-run/results-2026-11-14/ alongside this task: 54 hyperfine JSON+MD exports, du-disk.tsv, check-missing-sidecar.txt, and four provenance-headed raw logs -- log-sqlite-dup-ac2.txt (AC#2), log-armA-idle-rerun-authoritative.txt (the numbers to quote), log-armA-first-pass-discarded.txt (load-contaminated, kept only for transparency), log-armA-matrix-killed-incomplete.txt (documents that the per-worktree and cold/warm full-build cells were never measured, so nobody mistakes their absence for an oversight). Convention follows the committed results-2026-11-13/ baseline dir from TASK-369.1. Stray matrix-369-5-armA-wt1-*.log files from the killed run were deleted with its throwaway worktree.

Branch and worktree retired 2026-11-14: the two arm A commits (3f81920 bench(build): record arm A edit-to-run and disk measurements, bcdca12 docs(backlog): record TASK-369.5 arm A evidence and stopped state) were fast-forward merged into main and ~/git/mt.zig-engine-adr was removed with its branch, so the notes above that say "in worktree ~/git/mt.zig-engine-adr" describe a tree that no longer exists -- the arm A numbers and logs are safe on main, not lost. Resuming this spike means a fresh `wt switch --create zig-engine-adr`, then re-seeding the worktree the way the first pass did: task zig:stage TARGET=aarch64-apple-darwin, npm ci in app/frontend, and `cp -c -R ~/git/mt/.cache/cargo .cache/cargo` (APFS clone) so the fresh CARGO_HOME does not pay a full registry download. Regenerate tests/fixtures/mt_fixture.db before any workspace test run, and note task zig:fixture has a broken test filter that matches 0 tests and leaves an empty db. Arm B (the bounded library-read-path port plus deleting its Rust counterpart) was never started, so it is still the open half of AC#1 alongside the three arm A cells listed above.
<!-- SECTION:NOTES:END -->
