# Edit-to-run latency and build-footprint baseline (TASK-369.1)

Reproducible harness behind the baseline recorded in `TASK-369.1`. It measures the
two dimensions TASK-352 did not cover: **edit-to-run latency per change type** and
**build-directory disk growth** (per profile, per feature, per target triple, per
worktree). TASK-369.4 (release profile benchmark), TASK-369.5 (the Rust-vs-Zig ADR)
and TASK-353 (mt-core extraction) should re-run this harness and diff against the
recorded baselines in the **TASK-369.1** and **TASK-369.5** backlog records.

Raw output is deliberately **not committed**: `bench.sh` and `worktree-matrix.sh`
write to `results-<date>/`, which `.gitignore` excludes. The task records hold the
tables, so a re-run is compared against those numbers, not against files in the
tree. (The two baseline dirs this README used to point at, `results-2026-11-13/`
and `results-2026-11-14/`, were removed on 2026-11-14; they remain readable in git
history if a byte-for-byte re-baseline is ever needed.)

## Protocol

One command at a time, on AC power, nothing else compiling. Incremental numbers
are CPU-bound and a concurrent build invalidates them.

```bash
cd benchmarks/edit-to-run
./bench.sh latency touch      # mtime-only edits (the floor)
./bench.sh latency edit       # appends a comment
./bench.sh latency code       # appends a real function (forces codegen; the number to quote)
./bench.sh latency noincr     # content change with the incremental cache wiped (worst case)
./bench.sh check code         # cargo check, same change classes (IDE / CI-leg path)
./bench.sh frontend           # frontend-only class + vite bundle + vite dev start
./bench.sh sidecar            # zig:stage warm/cold + eager-externalBin proof
./bench.sh launch             # MT_ENUMERATE_DEVICES=1 target/debug/mt (launch proxy)
./bench.sh timings "--features agent"        # cold + warm --timings HTML (destroys target/)
./bench.sh growth "<feature args>" <label>   # one build + du snapshot
./bench.sh disk <label>       # du snapshot only
./bench.sh summary            # hyperfine JSON -> one table

# Per-worktree ("new machine") cost. Pass "" for a no-features build; the 4th
# argument is a second cargo invocation in the same worktree; the 5th rewrites
# mt-tauri's crate-type for what-if runs.
./worktree-matrix.sh 369-1-plain 1 ""
./worktree-matrix.sh 369-1-agent 1 "--features agent" "--release --features agent"
./worktree-matrix.sh 369-1-rlib  1 "--features agent" "--release --features agent" '["rlib"]'
# same shape for the other optional features (not run for TASK-369.1; their
# marginal cost was measured in one shared target dir with bench.sh growth):
#   ./worktree-matrix.sh 369-2-mcp      1 "--features agent,mcp"
#   ./worktree-matrix.sh 369-2-devtools 1 "--features agent,devtools"
```

Change classes (`CLASSES` in `bench.sh`) — every Rust class invalidates a big
compile unit. Since TASK-353 the engine lives in `mt-core`, so an `engine` edit
rebuilds that crate and then relinks `mt-tauri`; the `command`, `main` and `lib`
classes still recompile the whole `mt_lib` crate in `mt-tauri`:

| Class | File | Why this file |
|-------|------|---------------|
| `engine` | `crates/mt-core/src/db/library.rs` | largest pure-logic file, no `tauri` import |
| `command` | `crates/mt-tauri/src/commands/queue.rs` | `#[tauri::command]` wrapper layer |
| `main` | `crates/mt-tauri/src/main.rs` | bin target only → link-only cost |
| `lib` | `crates/mt-tauri/src/lib.rs` | crate root → maximal downstream invalidation |
| `frontend` | `app/frontend/js/stores/queue.js` | no Rust compile at all |

Three edit modes, because they answer different questions:

- `touch` — mtime only. Rustc's incremental cache is keyed on content hashes, so
  most codegen is reused. This is what a `task tauri:dev` restart with no actual
  edit pays: the floor.
- `edit` — appends a unique comment line per run, so rustc must redo codegen.
- `code` — appends a real (unique-named, dead-code) function per run: the honest
  "I edited a file" number, and the one to quote.
- `noincr` — same content change with `target/debug/incremental` removed first:
  the worst case an incremental build can hit (branch switch, toolchain bump,
  cache prune).

Files touched by the benchmark are restored with `git checkout` after each group.

## Environment recorded for these measurements

| | |
|---|---|
| Host | `Mac16,6`, macOS 15.8.1 (Build 24H32), `arm64` |
| CPU / RAM | Apple M4 Max, 16 cores (12P + 4E), 64 GB |
| Power | AC adapter, battery 100 %, low-power mode off |
| Toolchain | rustc / cargo 1.100.0 (pinned in `.tool-versions`), `RUSTC_WRAPPER=sccache` 0.18.0, `CARGO_BUILD_JOBS=14` |
| Sidecar | Zig 0.16.0, staged via `task zig:stage TARGET=aarch64-apple-darwin` |
| Commit | `3634b52` (`main`) |
| Linker | `lld` (`crates/mt-tauri/.cargo/config.toml`) |

Numbers come from `hyperfine` (1 warmup, 3 runs for compile classes, 10 for the
no-op class). `du -sk` snapshots land in `du-<label>.tsv`; `--timings` HTML lands
in `timings-<label>/`; sccache counters in `sccache-<label>.txt`.

## Findings

See the AC-by-AC tables in the task notes (`backlog/tasks/task-369.1 - *.md`
Implementation Notes) — that is the record a later task diffs against. This
README keeps only the protocol so a re-run is unambiguous.
