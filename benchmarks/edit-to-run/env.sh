# Shared environment for the edit-to-run benchmarks.
#
# Mirrors the env that `task` injects from taskfile.yml so the numbers describe
# the real dev loop (`task tauri:dev` / `task tauri:build`), not a bare cargo
# invocation. ROOT_DIR is derived from the git toplevel so the script works
# from any worktree.
#
# shellcheck shell=bash

MT_ROOT="$(git rev-parse --show-toplevel)"
cd "$MT_ROOT" || exit 1

export RUSTUP_TOOLCHAIN
RUSTUP_TOOLCHAIN="$(grep '^rust ' "$MT_ROOT/.tool-versions" | awk '{print $2}')"

export CARGO_HOME="$MT_ROOT/.cache/cargo"
export CARGO_TARGET_DIR="$MT_ROOT/target"
export CARGO_BUILD_JOBS
CARGO_BUILD_JOBS="$(($(sysctl -n hw.ncpu) - 2))"
export RUSTC_WRAPPER="${RUSTC_WRAPPER:-sccache}"

# The mise `cargo` shim ignores RUSTUP_TOOLCHAIN (docs/builds.md#toolchain), so
# benchmarks call the rustup shim directly.
CARGO="$HOME/.cargo/bin/cargo"
TASK="$(command -v task || echo "$HOME/.local/share/mise/installs/task/3.49.1/task")"
HYPERFINE="$(command -v hyperfine)"

# Results go beside this script, tagged with the run date.
BENCH_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESULTS_DIR="${RESULTS_DIR:-$BENCH_DIR/results-$(date +%Y-%m-%d)}"
mkdir -p "$RESULTS_DIR"

say() { printf '\n== %s\n' "$*"; }

du_kb() { du -sk "$1" 2>/dev/null | awk '{print $1}'; }

# Record a `du -sk` snapshot of every build/cache directory that exists.
du_snapshot() {
  local label="$1"
  local out="$RESULTS_DIR/du-${label}.tsv"
  : >"$out"
  local paths=(
    target
    target/debug
    target/debug/build
    target/debug/deps
    target/debug/incremental
    target/debug/examples
    target/release
    target/aarch64-apple-darwin
    target/aarch64-apple-darwin/debug
    target/aarch64-apple-darwin/release
    target/x86_64-apple-darwin
    zig-core/.zig-cache
    zig-core/zig-out
    crates/mt-tauri/binaries
    .cache/cargo
    .cache/npm
    node_modules
    app/frontend/node_modules
    app/frontend/dist
  )
  local p kb
  for p in "${paths[@]}"; do
    if [ -e "$p" ]; then
      kb="$(du_kb "$p")"
      printf '%s\t%s\t%s\n' "$label" "$p" "${kb:-0}" >>"$out"
    fi
  done
  printf '%s\t.worktree-total\t%s\n' "$label" "$(du_kb "$MT_ROOT")" >>"$out"
  echo "du snapshot -> $out"
}

sccache_stats() {
  local label="$1"
  if command -v sccache >/dev/null 2>&1; then
    sccache --show-stats >"$RESULTS_DIR/sccache-${label}.txt" 2>&1
  fi
}
