#!/usr/bin/env bash
# Edit-to-run latency + build-directory footprint baseline (TASK-369.1).
#
# Subcommands (run them separately; never concurrently -- CPU contention
# invalidates the numbers):
#
#   ./bench.sh latency    hyperfine incremental rebuild per change class
#   ./bench.sh check      same classes, cargo check (IDE / CI-leg parity)
#   ./bench.sh frontend   frontend-only change class + vite build/dev-start
#   ./bench.sh sidecar    zig:stage cost (warm and cold) + eager externalBin proof
#   ./bench.sh timings    cargo --timings report for a cold and a warm full build
#   ./bench.sh disk       du snapshot of target/, per-triple dirs, zig cache, worktree
#   ./bench.sh growth     cumulative disk growth, one config per build (needs a clean target)
#
# Each subcommand writes JSON/markdown/tsv into results-<date>/ next to this
# script. See README.md for the protocol and the machine it was run on.

set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=env.sh
source "$HERE/env.sh"

# Change classes: <id>:<file under the repo>. Every Rust class recompiles the
# whole mt_lib crate because engine code, #[tauri::command] wrappers and the
# crate roots all live in the single mt-tauri crate (that is the point of the
# measurement -- see TASK-353 for the split under consideration).
CLASSES=(
  "engine:crates/mt-tauri/src/db/library.rs"
  "command:crates/mt-tauri/src/commands/queue.rs"
  "main:crates/mt-tauri/src/main.rs"
  "lib:crates/mt-tauri/src/lib.rs"
  "frontend:app/frontend/js/stores/queue.js"
)

runs_for() { case "$1" in frontend|noop) echo 10 ;; *) echo 3 ;; esac; }

# mode=touch  -> mtime-only change: cargo reruns the crate, rustc's incremental
#                cache can reuse most codegen. This is the floor (what a
#                `task tauri:dev` restart with no edits pays).
# mode=edit   -> content actually changes (unique trailing comment), so rustc
#                must redo codegen for the touched module. This is the honest
#                "I edited a file" number. Files are restored with git after
#                each group.
bench_group() {
  local verb="$1" feature_args="$2" label="$3" mode="${4:-touch}"
  local cmd extra=()
  if [ -n "$feature_args" ]; then extra=($feature_args); fi
  cmd="$CARGO $verb -p mt-tauri ${extra[*]-}"

  say "$label [$mode] ($cmd)"
  for entry in "${CLASSES[@]}"; do
    local id="${entry%%:*}" file="$MT_ROOT/${entry#*:}" runs prepare
    runs="$(runs_for "$id")"
    [ "$id" = "frontend" ] && [ "$verb" = "check" ] && continue
    case "$mode" in
      touch) prepare="touch '$file'" ;;
      edit)  prepare="printf '\\n// bench-tick %s\\n' \"\$RANDOM\$RANDOM\" >> '$file'" ;;
      # Worst case an incremental build can hit: the incremental cache is gone
      # (branch switch, cargo version bump, manual prune) so the whole crate is
      # re-parsed/re-codegen'd before linking.
      noincr) prepare="rm -rf '$CARGO_TARGET_DIR/debug/incremental'; printf '\\n// bench-tick %s\\n' \"\$RANDOM\$RANDOM\" >> '$file'" ;;
      # Content change that actually adds code (unique name + body), so rustc
      # cannot reuse the previous codegen the way a comment-only append can.
      code)
        case "$file" in
          *.rs) prepare="printf '\\n#[allow(dead_code)] fn __bench_tick_%s() -> u64 { %s %% 1000003 + 1 }\\n' \"\$(date +%s%N)\" \"\$(date +%s%N)\" >> '$file'" ;;
          *)    prepare="printf '\\nconst __benchTick%s = %s %% 7 + 1\\n' \"\$(date +%s%N)\" \"\$(date +%s%N)\" >> '$file'" ;;
        esac ;;
      *) echo "bad mode $mode" >&2; exit 2 ;;
    esac
    say "  $id -> $mode ${entry#*:} ($runs runs)"
    "$HYPERFINE" --shell bash \
      --warmup 1 --runs "$runs" \
      --prepare "$prepare" \
      --time-unit second \
      --command-name "$label/$mode/$id" \
      --export-json "$RESULTS_DIR/hyperfine-$label-$mode-$id.json" \
      --export-markdown "$RESULTS_DIR/hyperfine-$label-$mode-$id.md" \
      "$cmd" 2>&1 | tail -n 8
  done
  git -C "$MT_ROOT" checkout -- "${CLASSES[@]#*:}" 2>/dev/null || true
  sccache_stats "$label-$mode"
}

case "${1:-latency}" in
  latency)
    mode="${2:-touch}"
    bench_group build "" "dev" "$mode"
    bench_group build "--features agent" "dev-agent" "$mode"
    ;;
  check)
    mode="${2:-touch}"
    bench_group check "" "check" "$mode"
    bench_group check "--features agent" "check-agent" "$mode"
    ;;
  launch)
    say "process launch cost: MT_ENUMERATE_DEVICES=1 target/debug/mt (headless early-exit path in main.rs; dyld + static init, no WebView)"
    "$HYPERFINE" --shell bash --warmup 2 --runs 10 --command-name "launch-mt-headless" \
      --export-json "$RESULTS_DIR/hyperfine-launch.json" \
      --export-markdown "$RESULTS_DIR/hyperfine-launch.md" \
      "MT_ENUMERATE_DEVICES=1 '$CARGO_TARGET_DIR/debug/mt' >/dev/null 2>&1" 2>&1 | tail -n 8
    ;;
  frontend)
    say "frontend-only change: cargo sees nothing to do"
    touch "$MT_ROOT/app/frontend/js/stores/queue.js"
    "$HYPERFINE" --shell bash --warmup 2 --runs 10 --command-name "cargo-noop-after-js-edit" \
      --export-json "$RESULTS_DIR/hyperfine-frontend-noop.json" \
      --export-markdown "$RESULTS_DIR/hyperfine-frontend-noop.md" \
      "$CARGO build -p mt-tauri" 2>&1 | tail -n 8

    say "vite production bundle (beforeBuildCommand)"
    "$HYPERFINE" --shell bash --warmup 1 --runs 3 --command-name "vite-build" \
      --export-json "$RESULTS_DIR/hyperfine-frontend-vite-build.json" \
      --export-markdown "$RESULTS_DIR/hyperfine-frontend-vite-build.md" \
      "npm --prefix '$MT_ROOT/app/frontend' run build" 2>&1 | tail -n 8

    say "cargo cost after a fresh vite bundle (does app/frontend/dist invalidate Rust?)"
    "$HYPERFINE" --shell bash --warmup 1 --runs 3 \
      --prepare "npm --prefix '$MT_ROOT/app/frontend' run build >/dev/null 2>&1" \
      --command-name "cargo-after-vite-build" \
      --export-json "$RESULTS_DIR/hyperfine-frontend-cargo-after-vite.json" \
      --export-markdown "$RESULTS_DIR/hyperfine-frontend-cargo-after-vite.md" \
      "$CARGO build -p mt-tauri" 2>&1 | tail -n 8

    say "vite dev server cold start (beforeDevCommand, HMR path)"
    {
      for i in 1 2 3; do
        out="$(mktemp)"
        ( cd "$MT_ROOT/app/frontend" && npm run dev >"$out" 2>&1 &
          pid=$!
          for _ in $(seq 1 200); do
            grep -q "ready in" "$out" && break
            sleep 0.1
          done
          grep -o "ready in [0-9]* ms" "$out" || echo "ready in (not detected)"
          pkill -P "$pid" 2>/dev/null || true
          kill "$pid" 2>/dev/null || true
        )
        rm -f "$out"
      done
    } >"$RESULTS_DIR/vite-dev-start.txt" 2>&1
    cat "$RESULTS_DIR/vite-dev-start.txt"
    ;;
  sidecar)
    say "zig:stage warm (task status check hits, nothing to do)"
    "$HYPERFINE" --shell bash --warmup 1 --runs 5 --command-name "zig-stage-warm" \
      --export-json "$RESULTS_DIR/hyperfine-zig-stage-warm.json" \
      --export-markdown "$RESULTS_DIR/hyperfine-zig-stage-warm.md" \
      "$TASK zig:stage TARGET=aarch64-apple-darwin" 2>&1 | tail -n 8

    say "zig:stage cold (prepare wipes .zig-cache, zig-out AND the staged binary so Task's status check re-runs the recipe)"
    "$HYPERFINE" --shell bash --warmup 0 --runs 3 \
      --prepare "rm -rf '$MT_ROOT/zig-core/.zig-cache' '$MT_ROOT/zig-core/zig-out' '$MT_ROOT/crates/mt-tauri/binaries/mt-zig-core-aarch64-apple-darwin'" \
      --command-name "zig-stage-cold" \
      --export-json "$RESULTS_DIR/hyperfine-zig-stage-cold.json" \
      --export-markdown "$RESULTS_DIR/hyperfine-zig-stage-cold.md" \
      "$TASK zig:stage TARGET=aarch64-apple-darwin" 2>&1 | tail -n 8

    say "eager externalBin proof: cargo check with the sidecar removed"
    staged="$MT_ROOT/crates/mt-tauri/binaries/mt-zig-core-aarch64-apple-darwin"
    mv "$staged" "$staged.bak"
    set +e
    "$HYPERFINE" --shell bash --warmup 0 --runs 1 --ignore-failure --command-name "check-missing-sidecar" \
      --export-json "$RESULTS_DIR/hyperfine-check-missing-sidecar.json" \
      "$CARGO check -p mt-tauri" 2>&1 | tail -n 6
    $CARGO check -p mt-tauri >"$RESULTS_DIR/check-missing-sidecar.txt" 2>&1
    echo "exit=$? (non-zero proves externalBin is resolved eagerly)" | tee -a "$RESULTS_DIR/check-missing-sidecar.txt"
    set -e
    say "restore sidecar via task zig:stage (the documented fix)"
    "$TASK" zig:stage TARGET=aarch64-apple-darwin
    ls -la "$staged"
    mv -f "$staged.bak" "$staged" 2>/dev/null || true
    ;;
  timings)
    feats="${2-}"
    # NB: this cargo build rejects a value on --timings (--timings=html and
    # --timings-dir are nightly/-Z options), so use the flag alone: cargo writes
    # target/cargo-timings/cargo-timing[-<stamp>].html and we archive that.
    archive_timings() {
      local mode="$1"
      local dir="$RESULTS_DIR/timings-$mode"
      mkdir -p "$dir"
      rm -f "$dir"/cargo-timing*.html
      cp "$CARGO_TARGET_DIR"/cargo-timings/cargo-timing*.html "$dir"/ 2>/dev/null || {
        echo "no timings HTML found under $CARGO_TARGET_DIR/cargo-timings" >&2; return 1; }
      tail -n 4 "$RESULTS_DIR/timings-$mode.log"
      echo "  report: $dir ($(find "$dir" -name 'cargo-timing*.html' -exec basename {} \; | tr '\n' ' '))"
    }

    say "timings: cold full build (${feats:-no features}) -- target/ is destroyed"
    rm -rf "$CARGO_TARGET_DIR"
    "$CARGO" build -p mt-tauri $feats --timings >"$RESULTS_DIR/timings-cold.log" 2>&1
    archive_timings cold
    du_snapshot cold-build

    say "timings: warm full build (touch lib.rs, whole crate recompiles)"
    touch "$MT_ROOT/crates/mt-tauri/src/lib.rs"
    "$CARGO" build -p mt-tauri $feats --timings >"$RESULTS_DIR/timings-warm.log" 2>&1
    archive_timings warm
    rm -rf "$CARGO_TARGET_DIR/cargo-timings"
    git -C "$MT_ROOT" checkout -- crates/mt-tauri/src/lib.rs 2>/dev/null || true
    ;;
  disk)
    du_snapshot "${2:-disk}"
    column -t "$RESULTS_DIR/du-${2:-disk}.tsv"
    ;;
  summary)
    {
      printf 'class\tmean_s\tsd\tmin\tmax\truns\n'
      for f in "$RESULTS_DIR"/hyperfine-*.json; do
        jq -r '.results[] | select(.mean != null) | [.command, (.mean*1000|round/1000),
              (.stddev*1000|round/1000), (.min*1000|round/1000), (.max*1000|round/1000),
              (.times|length)] | @tsv' "$f" 2>/dev/null || true
      done | sort
    } | awk -F'\t' '{printf "%-34s %8s %8s %8s %8s %4s\n",$1,$2,$3,$4,$5,$6}' |
      tee "$RESULTS_DIR/summary.txt"
    ;;
  growth)
    feats="${2-}"
    label="${3:-build}"
    say "growth build: cargo build -p mt-tauri $feats"
    "$CARGO" build -p mt-tauri $feats >"$RESULTS_DIR/growth-$label.log" 2>&1 || {
      tail -n 20 "$RESULTS_DIR/growth-$label.log"; exit 1; }
    tail -n 2 "$RESULTS_DIR/growth-$label.log"
    du_snapshot "$label"
    ls -la "$CARGO_TARGET_DIR"/*/*.a "$CARGO_TARGET_DIR"/*/mt 2>/dev/null | true
    ;;
  *)
    echo "unknown subcommand: ${1:-}" >&2
    exit 2
    ;;
esac

echo "results: $RESULTS_DIR"
