# Zig-first: historical evidence, not an adoption gate

See [ADR-0001](adr/0001-zig-first-engine.md). Sources are the Backlog records
TASK-353, TASK-355.6, TASK-369.1 and TASK-369.5. Their historical plans and old AC
numbers are superseded by the Zig-first scope; do not execute a throwaway arm B.

## What was established

| Source / context | Recorded result | What it means |
|------------------|-----------------|---------------|
| TASK-353 controlled split, `b685a9e` vs `2aca72f`, same machine | Cold build 44.53s / 437 crates vs 48.81s / 436; warm no-op 1.83s vs 2.12s; main edit 0.56s both; moved DB edit 2.37s vs 2.12s | Useful isolation, not a general wall-clock win |
| TASK-353 test footprint | Recorded normal `cargo tree` footprint: core 326 vs 1,162 pre-split; 686 of 1,071 tests isolated | Tree footprint is not a distinct-package comparison; this is isolation, not Zig savings |
| TASK-353 tests, same controlled pair | First `--tests` 24.19s vs 25.21s; clean desktop tests 7.59s vs 7.72s; cold tests 48.76s vs 47.00s; core-only tests 14.34s / 84 crates | Costs vary with profile/cache state |
| TASK-355.6 completed POC | One read-only `GET /api/library`, bearer auth, bundled sidecar and shadow comparison | Mechanics work; no Rust domain deletion, full-engine parity or speedup |
| TASK-369.1 earlier baseline | Warm build/check about 2.2s/1.0s; main 0.6s; wiped incremental 6.9s; cold 35.2s | Its revision/cache context is not interchangeable with later arm A |
| TASK-369.1 footprint | `target/` 12.3 GiB; 10.03 GiB in `debug/build`; 1,270 normal dependency-tree lines / 421 distinct crates | Historical footprint, not a current graph |
| TASK-369.1 crate-type what-if | About 17s debug, 81s release and 1.75 GiB/worktree reduction | Separate Rust build configuration experiment, not a Zig effect |
| TASK-369.5 arm A, idle 2026-11-14 macOS ARM64 | Code-change builds: engine 2.647s, command 1.810s, lib 2.149s, main 0.560s, frontend 0.170s; agent engine/command 2.854s/1.942s | Lean split Rust rebuild measurements only |
| Same arm A | Checks engine/command/lib/main 1.438/0.841/0.850/0.305s; agent 1.539/0.907/0.917/0.313s; wiped incremental engine build 7.343s | No arm B exists for comparison |
| Same arm A sidecar staging | Cold 17.536s, warm 0.116s | Additive sidecar cost, not equivalent-functionality engine comparison |
| Same arm A tests | Core 692 passed / 1 skipped in 2.53–2.57s steady state; test-profile compile 19.88s; all-features 698/1 in 6.46s; desktop first build 331/4 in 47.35s | Desktop steady-state repeat was killed, not measured |
| Same arm A disk, corrected KiB arithmetic | `target/` 6,547,592 KiB = 6.24 GiB; whole worktree 7,144,920 KiB = 6.81 GiB; build 5,650,252 KiB; incremental 406,672 KiB | Earlier task prose mixed units; use these corrected figures |
| Same arm A other disk | Zig cache 36,660 KiB; Zig output 8,456 KiB; staged binaries 1,788 KiB; Cargo home 391,772 KiB; node_modules 125,292 KiB | Separate artifact categories, not net migration savings |

The first arm-A pass was load-contaminated (load 18.4/10.1) and discarded.
For example lib build inflated to 3.332s and frontend to 0.259s; quote the idle
rerun instead. The main checkout's later 32 GB `target/` also cannot be compared
as though it were the same fresh-worktree profile/cache state.

## Duplicate SQLite

TASK-369.5 recorded rustc 1.100.0, Zig 0.16.0, macOS ARM64, wrapper unset:

- Rust `libsqlite3-sys` cold build 3.09s, warm 0.10s; archive about 3.9 MB.
- Zig full ReleaseSafe build 16.48s, of which SQLite compilation was about 8s;
  warm 0.10s, cache about 36 MB, sidecar 1,826,824 bytes.
- Vendored SQLite C source about 9.0 MB / 265,908 lines.

About 11s of cold SQLite compilation is a real duplicate cost, not a persuasive
warm-loop motivator. Removing a library read endpoint alone cannot eliminate
rusqlite, libsqlite3-sys, r2d2 or r2d2_sqlite: other Rust domains still use them.
Only the complete caller/migrator handoff can retire the Rust SQL stack.

## Explicitly unknown / no longer gates

- Arm B (a destructive bounded Zig port with Rust deletion) was **never
  implemented**. No equal-functionality Rust-vs-Zig performance result exists.
- Arm-A fresh-worktree matrix, full cold/warm build repeat and steady-state
  desktop test repeat were stopped/incomplete.
- TASK-355.1's 44s/23s were whole-job placeholder timings on Zig 0.15.2, not
  completed-engine builds. TASK-355.2's roughly 3s was an earlier local build.
- TASK-352's 9m34s CI run already included sidecar jobs. Controlled incremental
  CI delta is unknown, not zero.
- The 1,443-to-1,270 dependency-tree counts came from different revisions/hosts;
  they do not establish Zig-attributable savings.
- Historical sccache captures returned 0–4 hits on 34–3,656 requests; they show
  negligible assistance in those captures, not a universal cache theorem.

These omitted benchmark/CI cells are **not acceptance gates**. No new matrix,
paid CI campaign, cache wipe or throwaway implementation is authorized here.

Raw result directories were removed by maintainer decision. Summaries remain in
the task records; the original files are in git history (arm-A evidence commit
`3f81920`, task closeout `bcdca12`). Do not restore generated harness output to
the source tree merely to document the language decision.
