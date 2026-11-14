#!/usr/bin/env bash
# Per-worktree build cost + disk footprint (TASK-369.1 AC#3/#4).
#
# Creates N throwaway worktrees from the current HEAD and runs the dev-loop build
# in each exactly as `task tauri:dev` would -- git worktree add, npm ci, vite
# bundle, zig sidecar staging, cargo build -- recording wall-clock per stage and
# `du -sk` per path. A worktree is the honest "new machine / new branch" case:
# nothing is shared with the main checkout except the sccache and cargo caches,
# which is precisely what the per-worktree footprint question is about.
#
# Optional 4th argument runs a second cargo invocation in the same worktree
# (e.g. "--release --features agent") and snapshots disk again, so the marginal
# cost of a profile is measured on top of the dev build.
#
# Optional 5th argument rewrites mt-tauri's `crate-type` line before building,
# for what-if runs (e.g. '["rlib"]' instead of '["staticlib","cdylib","rlib"]').
#
# Worktrees are left in place; remove them with:
#
#   git worktree remove --force ../mt.<name>-wt<i> && git branch -D baseline/<name>-wt<i>
#
# Usage: ./worktree-matrix.sh <name> <count> [feature args] [extra build args] [crate-type]
#   ./worktree-matrix.sh 369-1-agent 1 "--features agent" "--release --features agent"
#   ./worktree-matrix.sh 369-1-rlib  1 "--features agent" "--release --features agent" '["rlib"]'
#
# NB: feature args are intentionally word-split (they are a flag list, not a
# filename). Pass "" explicitly for a no-features build.

set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

name="${1:?usage: worktree-matrix.sh <name> <count> [feature args] [extra build args] [crate-type]}"
count="${2:-2}"
feats="${3-}"
extra="${4-}"
crate_type="${5-}"

MAIN="$(git -C "$HERE" rev-parse --show-toplevel)"
BASE="$(dirname "$MAIN")"
OS="$(uname -s)"
if [ "$OS" = Darwin ]; then RUST_TRIPLE="aarch64-apple-darwin"; else RUST_TRIPLE="x86_64-unknown-linux-gnu"; fi
CPUS="$(sysctl -n hw.ncpu 2>/dev/null || nproc)"

RESULTS_DIR="${RESULTS_DIR:-$HERE/results-$(date +%Y-%m-%d)}"
mkdir -p "$RESULTS_DIR"
out="$RESULTS_DIR/worktree-matrix-$name.tsv"
: >"$out"

say() { printf '  %s\n' "$*"; }
row() { printf 'wt%s\t%s\t%s\n' "$1" "$2" "$3" >>"$out"; }
stage() { row "$1" "$2" "$3"; say "wt$1 $2: ${3}s"; }

# `set -o pipefail` turns a missing path or a failed `ls` into a script exit, so
# every optional probe below returns 0 explicitly.
durow() {
  if [ -e "$2" ]; then
    row "$1" "${2#"$PWD"/}" "$(du -sk "$2" | awk '{print $1}')"
  fi
  return 0
}
count_compiling() { # <log> <wt> <label>
  local n
  n=$(grep -cE '^   Compiling' "$1" 2>/dev/null || true)
  row "$2" "$3" "${n:-0}"
  return 0
}
artifacts() { # <wt> <profile dir> <wt label>
  local wt="$1" profile="$2" i="$3" f ext
  for ext in a dylib so; do
    for f in "$wt/target/$profile"/*."$ext"; do
      [ -e "$f" ] && row "$i" "artifact ${f#"$wt"/}" "$(wc -c <"$f" | tr -d ' ')"
    done
  done
  if [ -e "$wt/target/$profile/mt" ]; then
    row "$i" "artifact $profile/mt" "$(wc -c <"$wt/target/$profile/mt" | tr -d ' ')"
  fi
  return 0
}
cargo_in() { # <wt> [cargo build args...]
  local wt="$1"; shift
  ( cd "$wt" && RUSTUP_TOOLCHAIN="$(grep '^rust ' .tool-versions | awk '{print $2}')" \
      CARGO_HOME="$wt/.cache/cargo" CARGO_TARGET_DIR="$wt/target" \
      CARGO_BUILD_JOBS="$((CPUS - 2))" RUSTC_WRAPPER=sccache \
      "$HOME/.cargo/bin/cargo" build -p mt-tauri "$@" )
}

for i in $(seq 1 "$count"); do
  wt="$BASE/mt.$name-wt$i"
  br="baseline/$name-wt$i"
  git -C "$MAIN" worktree remove --force "$wt" >/dev/null 2>&1 || true
  rm -rf "$wt"
  git -C "$MAIN" branch -D "$br" >/dev/null 2>&1 || true

  t0=$(date +%s)
  git -C "$MAIN" worktree add "$wt" -b "$br" HEAD >/dev/null
  stage "$i" "git worktree add" $(( $(date +%s) - t0 ))
  cd "$wt"

  if [ -n "$crate_type" ]; then
    sed -i '' -E 's/^crate-type = .*/crate-type = '"$crate_type"'/' crates/mt-tauri/Cargo.toml
    row "$i" "crate-type override" "$crate_type"
  fi

  t0=$(date +%s); npm --prefix app/frontend ci >"$RESULTS_DIR/matrix-$name-wt$i-npm-ci.log" 2>&1
  stage "$i" "npm ci" $(( $(date +%s) - t0 ))

  t0=$(date +%s); ( cd app/frontend && npm run build ) >"$RESULTS_DIR/matrix-$name-wt$i-vite.log" 2>&1
  stage "$i" "vite build (dist)" $(( $(date +%s) - t0 ))

  t0=$(date +%s); task zig:stage TARGET="$RUST_TRIPLE" >"$RESULTS_DIR/matrix-$name-wt$i-zig.log" 2>&1
  stage "$i" "task zig:stage (cold)" $(( $(date +%s) - t0 ))

  t0=$(date +%s)
  cargo_in "$wt" $feats >"$RESULTS_DIR/matrix-$name-wt$i-cargo.log" 2>&1 || {
    echo "cargo build failed in $wt; last 20 lines:" >&2
    tail -n 20 "$RESULTS_DIR/matrix-$name-wt$i-cargo.log" >&2; exit 1; }
  stage "$i" "cargo build -p mt-tauri ${feats:-(no features)}" $(( $(date +%s) - t0 ))
  count_compiling "$RESULTS_DIR/matrix-$name-wt$i-cargo.log" "$i" "crates compiled (debug)"
  for p in target target/debug target/debug/build target/debug/build/mt-tauri \
    target/debug/deps target/debug/incremental; do
    durow "$i" "$p"
  done
  # The staticlib/cdylib tax: unlinked codegen objects cargo leaves in the
  # build-script output dir (only present with crate-type staticlib/cdylib).
  local_rcgu=$(find target/debug/build/mt-tauri -name 'mt_lib.*.rcgu.o' 2>/dev/null | wc -l | tr -d ' ')
  row "$i" "mt_lib.*.rcgu.o files (count)" "${local_rcgu:-0}"
  row "$i" "mt_lib.*.rcgu.o files (KiB)" \
    "$(find target/debug/build/mt-tauri -name 'mt_lib.*.rcgu.o' -exec du -k {} + 2>/dev/null | awk '{s+=$1} END {print s+0}')"
  artifacts "$wt" debug "$i"

  if [ -n "$extra" ]; then
    t0=$(date +%s)
    cargo_in "$wt" $extra >"$RESULTS_DIR/matrix-$name-wt$i-cargo-extra.log" 2>&1 || {
      echo "cargo build ($extra) failed in $wt; last 20 lines:" >&2
      tail -n 20 "$RESULTS_DIR/matrix-$name-wt$i-cargo-extra.log" >&2; exit 1; }
    stage "$i" "cargo build -p mt-tauri $extra" $(( $(date +%s) - t0 ))
    count_compiling "$RESULTS_DIR/matrix-$name-wt$i-cargo-extra.log" "$i" "crates compiled (extra)"
    for p in target target/release target/release/deps target/release/build/mt-tauri; do durow "$i" "$p"; done
    row "$i" "release mt_lib.*.rcgu.o files (count)" \
      "$(find target/release/build/mt-tauri -name 'mt_lib.*.rcgu.o' 2>/dev/null | wc -l | tr -d ' ')"
    row "$i" "release mt_lib.*.rcgu.o files (KiB)" \
      "$(find target/release/build/mt-tauri -name 'mt_lib.*.rcgu.o' -exec du -k {} + 2>/dev/null | awk '{s+=$1} END {print s+0}')"
    artifacts "$wt" release "$i"
  fi

  for p in .cache/cargo app/frontend/node_modules crates/mt-tauri/binaries; do durow "$i" "$p"; done
  row "$i" ".worktree-total" "$(du -sk "$wt" | awk '{print $1}')"
  say "wt$i: done, total $(du -sh "$wt" | awk '{print $1}')"
done

echo "results: $out"
column -t -s"$(printf '\t')" "$out"
