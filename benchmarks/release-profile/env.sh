# Shared environment for the release-profile benchmark (TASK-369.4).
#
# Same shape as benchmarks/edit-to-run/env.sh so the two spikes are comparable:
# it mirrors the env `task` injects from taskfile.yml, calls the rustup shim
# directly (the mise `cargo` shim ignores RUSTUP_TOOLCHAIN -- docs/builds.md#toolchain),
# and derives ROOT from the git toplevel so it works from any worktree.
#
# Differences from the edit-to-run harness, both deliberate:
#   * CARGO_TARGET_DIR points at a scratch directory. The sweep `rm -rf`s its
#     release dirs between runs, and the rule from TASK-369.1 is to never clean
#     a working target dir.
#   * RUSTC_WRAPPER is cleared. sccache answers identical repeat builds from
#     cache (TASK-369.1 finding 6), which would turn a codegen/link benchmark
#     into a cache-lookup benchmark. `sweep.sh ci-parity` turns it back on.
#
# shellcheck shell=bash

MT_ROOT="$(git rev-parse --show-toplevel)"
cd "$MT_ROOT" || exit 1

export RUSTUP_TOOLCHAIN
RUSTUP_TOOLCHAIN="$(grep '^rust ' "$MT_ROOT/.tool-versions" | awk '{print $2}')"

export CARGO_HOME="$MT_ROOT/.cache/cargo"
export CARGO_TARGET_DIR="${BENCH_TARGET_DIR:-$MT_ROOT/.cache/bench-369-4/target}"
export CARGO_BUILD_JOBS
CARGO_BUILD_JOBS="$(($(sysctl -n hw.ncpu) - 2))"

# Nothing may leak extra flags into the measured builds.
unset RUSTC_WRAPPER RUSTFLAGS CARGO_ENCODED_RUSTFLAGS MT_LOG

# CI's macOS release leg builds this triple (release.yml -> task ci:build).
TRIPLE="${BENCH_TRIPLE:-aarch64-apple-darwin}"

CARGO="$HOME/.cargo/bin/cargo"
# Same CLI the taskfiles use (`deno run -A npm:@tauri-apps/cli`), resolved from
# the workspace install so no network is needed mid-sweep.
TAURI="${TAURI_CLI:-$MT_ROOT/app/frontend/node_modules/.bin/tauri}"
HYPERFINE="$(command -v hyperfine)"

BENCH_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESULTS_DIR="${RESULTS_DIR:-$BENCH_DIR/results-$(date +%Y-%m-%d)}"
mkdir -p "$RESULTS_DIR/dmg"

# The profile knobs under test. Cargo reads these env vars with higher
# precedence than [profile.release] in Cargo.toml (verified by sweep.sh doctor:
# a bogus value reaches rustc as -C lto=<bogus> and is rejected there).
# shellcheck disable=SC2034  # both arrays are consumed by sweep.sh
LTO_VALUES=(true thin false)   # `true` == fat; matches the committed profile
# shellcheck disable=SC2034
CGUS_VALUES=(1 4 16)

say() { printf '\n== %s\n' "$*"; }

du_kb() { du -sk "$1" 2>/dev/null | awk '{print $1}'; }

# `fat`/`thin`/`off` in labels -> the value Cargo actually accepts.
lto_param() { case "$1" in fat|true) echo true ;; thin) echo thin ;; off|false) echo false ;; *) echo "$1" ;; esac; }
lto_label() { case "$1" in fat|true) echo fat ;; thin) echo thin ;; off|false) echo off ;; *) echo "$1" ;; esac; }
combo_label() { echo "lto-$(lto_label "$1")-cgus$2"; }

# The measured build: cargo's release build of the Tauri package, CI-parity
# (default features, --target, no bundling, no beforeBuildCommand).
build_cmd() {
  local lto cgus
  lto="$(lto_param "$1")"; cgus="$2"
  printf "env RUSTUP_TOOLCHAIN=%s CARGO_HOME='%s' CARGO_TARGET_DIR='%s' CARGO_BUILD_JOBS=%s CARGO_PROFILE_RELEASE_LTO=%s CARGO_PROFILE_RELEASE_CODEGEN_UNITS=%s '%s' build --release --target %s -p mt-tauri" \
    "$RUSTUP_TOOLCHAIN" "$CARGO_HOME" "$CARGO_TARGET_DIR" "$CARGO_BUILD_JOBS" "$lto" "$cgus" "$CARGO" "$TRIPLE"
}

# Cold start for every measured run: no release artifacts for the host
# (build scripts + proc macros) and none for the target triple.
clean_cmd() {
  printf "rm -rf '%s/release' '%s/%s'" "$CARGO_TARGET_DIR" "$CARGO_TARGET_DIR" "$TRIPLE"
}

bin_path() { echo "$CARGO_TARGET_DIR/$TRIPLE/release/mt"; }

# Record binary + artifact sizes for the current contents of the target dir.
record_sizes() {
  local label="$1" out="$RESULTS_DIR/sizes-$1.tsv" bin
  : >"$out"
  bin="$(bin_path)"
  if [ -f "$bin" ]; then
    printf '%s\tbinary-bytes\t%s\n'    "$label" "$(stat -f%z "$bin")" >>"$out"
    printf '%s\tbinary-kib\t%s\n'      "$label" "$(du_kb "$bin")" >>"$out"
    # Mach-O segment table: __TEXT is the part that has to be resident.
    size -m "$bin" >"$RESULTS_DIR/size-$label.txt" 2>&1 || true
    awk -v lab="$label" '/^Segment __TEXT:/ { for (i = NF; i >= 1; i--) if ($i ~ /^[0-9]+$/) { print lab "\t__TEXT-bytes\t" $i; exit } }' \
      "$RESULTS_DIR/size-$label.txt" >>"$out"
  else
    printf '%s\tbinary-bytes\tmissing\n' "$label" >>"$out"
  fi
  # The staticlib/cdylib byproducts TASK-369.1 found in every build-script out
  # dir: LTO cost scales with them, so record what they weigh per candidate.
  local a
  for a in "$CARGO_TARGET_DIR"/release/build/mt-tauri-*/out/libmt_lib.a \
           "$CARGO_TARGET_DIR/$TRIPLE"/release/build/mt-tauri-*/out/libmt_lib.a; do
    [ -f "$a" ] && printf '%s\tlibmt_lib.a-bytes\t%s\n' "$label" "$(stat -f%z "$a")" >>"$out"
  done
  printf '%s\ttarget-triple-kib\t%s\n' "$label" "$(du_kb "$CARGO_TARGET_DIR/$TRIPLE")" >>"$out"
  printf '%s\ttarget-host-kib\t%s\n'   "$label" "$(du_kb "$CARGO_TARGET_DIR/release")" >>"$out"
  echo "sizes -> $out"
}

# Package the already-built binary into a DMG (the bundler does not compile) and
# keep a copy, because every candidate's DMG has the same filename.
record_dmg() {
  local label="$1" src
  say "bundle dmg [$label]"
  "$TAURI" bundle --target "$TRIPLE" --bundles dmg \
    --config '{"build":{"beforeBuildCommand":""}}' >"$RESULTS_DIR/bundle-$label.log" 2>&1 \
    || { echo "bundle failed, see $RESULTS_DIR/bundle-$label.log" >&2; return 1; }
  src="$(ls -t "$CARGO_TARGET_DIR/$TRIPLE"/release/bundle/dmg/*.dmg 2>/dev/null | head -1)"
  if [ -n "$src" ]; then
    cp "$src" "$RESULTS_DIR/dmg/$label.dmg"
    printf '%s\tdmg-bytes\t%s\n' "$label" "$(stat -f%z "$src")" >>"$RESULTS_DIR/sizes-$label.tsv"
    echo "dmg -> $RESULTS_DIR/dmg/$label.dmg"
  else
    printf '%s\tdmg-bytes\tmissing\n' "$label" >>"$RESULTS_DIR/sizes-$label.tsv"
  fi
}

# One candidate end to end: measured cold builds, then sizes and DMG from the
# artifacts the last build left behind.
run_candidate() {
  local lto="$1" cgus="$2" runs="${3:-2}" label cmd
  label="$(combo_label "$lto" "$cgus")"
  cmd="$(build_cmd "$lto" "$cgus")"
  say "$label  (lto=$lto codegen-units=$cgus, $runs cold runs)"
  "$HYPERFINE" --runs "$runs" --warmup 0 --time-unit second \
    --command-name "$label" --prepare "$(clean_cmd)" \
    --export-json "$RESULTS_DIR/hyperfine-$label.json" \
    --export-markdown "$RESULTS_DIR/hyperfine-$label.md" \
    "$cmd" | tee "$RESULTS_DIR/hyperfine-$label.txt"
  record_sizes "$label"
  record_dmg "$label"
}
