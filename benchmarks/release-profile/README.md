# Release-profile LTO / codegen-units benchmark (TASK-369.4)

Reproducible harness behind the release-profile matrix recorded in `TASK-369.4`.
It answers one question with numbers: what does `opt-level = "s"` +
`panic = "abort"` + `strip` cost, and what do `lto` and `codegen-units` cost on
top of it, in build wall-clock and in shipped artifact size.

The three columns run on different machines because the profiles have to be
timed where they actually ship:

| Column | Where | Command timed |
|---|---|---|
| macOS (authoritative, host) | this M4 Max | `cargo build --release --target aarch64-apple-darwin -p mt-tauri` |
| Linux x86_64 (CI-parity image) | `mf`, 16-core AlmaLinux, in `docker/linux`'s deps stage | same, `--target x86_64-unknown-linux-gnu` |
| Windows x64 (real release runner) | `blacksmith-4vcpu-windows-2025` via `.github/workflows/profile-bench.yml` | `task ci:build TARGET=x86_64-pc-windows-msvc` (the exact release.yml step) |

## Protocol

One pass at a time, on AC power, nothing else compiling. These are CPU-bound
wall-clock measurements; a concurrent build invalidates them.

```bash
cd benchmarks/release-profile
./sweep.sh doctor                      # preflight: tools, sidecar, dist, env-override proof
./sweep.sh probe                       # one cold build + sizes + dmg: prices a run
./sweep.sh matrix 2                    # 9 candidates x 2 cold runs, sizes + dmg each
./sweep.sh candidate thin 16           # one candidate end to end
./sweep.sh head2head true:1 thin:16 false:16   # ONE hyperfine run => comparable ratios
./sweep.sh ci-parity true 1 2          # same build with RUSTC_WRAPPER=sccache
./sweep.sh timings true 1              # cargo --timings HTML for one cold build
./sweep.sh launch false 16 10          # MT_ENUMERATE_DEVICES=1 launch proxy
./sweep.sh summary                     # aggregate everything into SUMMARY.md

RUNS=2 ./linux-on-mf.sh                # Linux column on mf (see the script header)
```

Every candidate is a cold build: hyperfine `--prepare` deletes
`target/release` and `target/<triple>` before each run, so nothing from the
previous run survives. Repeat builds of the *same* candidate would come back out
of sccache, so the sweep clears `RUSTC_WRAPPER`; `ci-parity` turns it back on to
record what a warm-cache CI leg pays. The profile knobs travel as
`CARGO_PROFILE_RELEASE_LTO` / `CARGO_PROFILE_RELEASE_CODEGEN_UNITS` env vars,
which Cargo prefers over `Cargo.toml` (`doctor` proves a bogus value reaches
rustc as `-C lto`), so the manifest never changes between candidates and the
fingerprints differ only by the settings under test.

The measured command is the CI build step's cargo invocation with **default
features**: `release.yml` calls `task ci:build`, `tauri.conf.json` declares no
build features, and `[features] default = []`, so the shipped release binary has
no `agent`/`mcp`/`devtools` code. `tauri bundle` only packages an existing
binary, so DMG/NSIS/deb sizes come from the bundler without a second compile.

Per candidate the harness records: hyperfine JSON/markdown, binary bytes,
Mach-O `__TEXT` (Linux: `.text`/`.data`), `libmt_lib.a` bytes (the `staticlib`
byproduct TASK-369.1 found dominates artifact cost), `du` of the triple and host
target dirs, and the bundled artifact copied to `dmg/<candidate>.dmg` because
every candidate's DMG has the same filename.

## Environment recorded for these measurements

| | |
|---|---|
| Host | `Mac16,6`, macOS 15.8.1 (Build 24H32), `arm64` |
| CPU / RAM | Apple M4 Max, 16 cores (12P + 4E), 64 GB |
| Power | AC adapter, low-power mode off |
| Toolchain | rustc / cargo 1.100.0 (pinned in `.tool-versions`), `CARGO_BUILD_JOBS=14`, no `RUSTC_WRAPPER` |
| Target | `aarch64-apple-darwin`, default features |
| Sidecar | Zig 0.16.0, staged by `task zig:stage TARGET=aarch64-apple-darwin` |
| Linker | toolchain default (repo configures none, see docs/builds.md#linker) |

`mf` (Linux column) and the Blacksmith Windows runner report their own spec into
`results-<date>/linux/runner-spec.txt` and the workflow's `results/runner-spec.txt`
artifact respectively.

## Findings

The AC-by-AC tables live in the task notes (`backlog/tasks/task-369.4 - *.md`)
and the accepted trade-off is written up in `docs/builds.md#release-profile`.
This README keeps only the protocol so a re-run is unambiguous. Re-measure
here, in this order, before re-tuning the profile: `doctor`, `probe`, `matrix 2`,
`head2head` on the shortlist, `cli-head2head` on the winner, then `smoke.sh` on
baseline and winner and a diff of the two `smoke-*.txt` files.

## Playback smoke (AC#3)

`./smoke.sh <lto> <cgus>` answers "does the shipped artifact still work" for one
candidate, and it is the AC that build time and sizes cannot answer: fat LTO is
exactly the setting that can break something through optimisation while every
number still looks good. It builds the candidate and the `audio_test` example in a
target dir of its own (`.cache/bench-369-4/target-smoke`, so it never wipes a dir a
matrix pass is using), bundles the `.app` so the sidecar lands where `externalBin`
expects it, then checks six things and writes `results-<date>/smoke-<candidate>.txt`:

| Check | Evidence |
|---|---|
| `enumerate-devices` | `MT_ENUMERATE_DEVICES=1 <app binary>` exits 0 and prints ≥1 device |
| `first-launch-db` | the app creates `mt.db` under an isolated `HOME` |
| `library-scan` | a folder of `crates/mt-tauri/tests/fixtures` registered in `watched_folders` is scanned into the `library` table |
| `playback-advances` | `audio_test` reports ≥3 increasing positions through the real rodio output device, over a generated 6 s tone (every repo fixture is exactly 1 s, so it cannot show the clock moving) |
| `playback-fixture` | `audio_test` decodes `test_sample.mp3` and reports its real length |
| `app-log` | no panic and no `ERROR` level line in the app's own log, except the sidecar kill this script itself causes |

Both runs happen under a private `HOME`, so the real library, settings and logs are
untouched and the two candidates see identical state. Output volume is muted for the
playback step and restored afterwards, and the app window appears twice for a few
seconds. Only verdict lines go into the summary file — diagnostics that legitimately
differ run to run (elapsed positions, byte counts) print to the terminal, and a
failing run keeps its raw transcripts as `smoke-<candidate>-*.log`. AC#3 is met when
the two summary files differ only in the candidate label.
