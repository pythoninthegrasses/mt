#!/usr/bin/env bash
# Release-profile LTO / codegen-units benchmark (TASK-369.4).
#
# Subcommands (one at a time, on AC power, nothing else compiling -- these are
# CPU-bound wall-clock measurements and a concurrent build invalidates them):
#
#   ./sweep.sh doctor                       tool/pipeline preflight, no builds
#   ./sweep.sh probe [lto cgus]             one cold build + sizes + dmg (cost check)
#   ./sweep.sh matrix [runs]                lto x codegen-units sweep (default 2 runs)
#   ./sweep.sh candidate <lto> <cgus> [n]   one candidate end to end
#   ./sweep.sh head2head <lto:cgus>...      all listed candidates in ONE hyperfine
#                                           run, so the relative column is comparable
#   ./sweep.sh ci-parity <lto> <cgus> [n]   same command with RUSTC_WRAPPER=sccache
#                                           (what a CI leg with a warm cache pays)
#   ./sweep.sh timings <lto> <cgus>         cargo --timings HTML for one cold build
#   ./sweep.sh launch <lto> <cgus> [n]      MT_ENUMERATE_DEVICES=1 launch proxy
#   ./sweep.sh summary                      aggregate json+tsv into SUMMARY.md
#
# `lto` accepts true|fat|thin|false|off. Every artifact lands in results-<date>/
# beside this script. See README.md for the protocol and the machine.

set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=env.sh
source "$HERE/env.sh"

cmd="${1:-doctor}"; shift || true

require_bin() {
  [ -x "$1" ] || { echo "missing $2: $1" >&2; exit 2; }
}

case "$cmd" in
  doctor)
    say "environment"
    printf 'host            %s\n' "$(sysctl -n hw.model)"
    printf 'macos           %s\n' "$(sw_vers -productVersion) ($(sw_vers -buildVersion))"
    printf 'cores/jobs      %s / %s\n' "$(sysctl -n hw.ncpu)" "$CARGO_BUILD_JOBS"
    printf 'memory          %s GiB\n' "$(( $(sysctl -n hw.memsize) / 1073741824 ))"
    printf 'toolchain       %s\n' "$("$CARGO" --version) / $(rustc -V)"
    printf 'rustup pin      %s\n' "$RUSTUP_TOOLCHAIN"
    printf 'hyperfine       %s\n' "$("$HYPERFINE" --version)"
    printf 'target dir      %s\n' "$CARGO_TARGET_DIR"
    printf 'triple          %s\n' "$TRIPLE"
    printf 'RUSTC_WRAPPER   %q (sweep runs without sccache)\n' "${RUSTC_WRAPPER-<unset>}"
    say "preflight"
    require_bin "$CARGO" cargo
    require_bin "$HYPERFINE" hyperfine
    require_bin "$TAURI" "tauri CLI"
    [ -f "$MT_ROOT/crates/mt-tauri/binaries/mt-zig-core-$TRIPLE" ] \
      || { echo "sidecar not staged: task zig:stage TARGET=$TRIPLE" >&2; exit 2; }
    [ -d "$MT_ROOT/app/frontend/dist" ] \
      || { echo "frontend dist missing: task ci:frontend-build" >&2; exit 2; }
    say "profile env override proof (rustc must reject a bogus -C lto)"
    tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
    mkdir -p "$tmp/src"
    printf '[package]\nname="ltocheck"\nversion="0.1.0"\nedition="2021"\n\n[profile.release]\nlto=true\ncodegen-units=1\n' >"$tmp/Cargo.toml"
    printf 'pub fn add(a:i32,b:i32)->i32{a+b}\nfn main(){println!("{}",add(1,2));}\n' >"$tmp/src/main.rs"
    if CARGO_TARGET_DIR="$tmp/target" CARGO_PROFILE_RELEASE_LTO=bogus \
       "$CARGO" build --release --manifest-path "$tmp/Cargo.toml" >"$tmp/out" 2>&1; then
      status=0; else status=$?; fi
    if [ "$status" -ne 0 ] && grep -q "codegen option .lto" "$tmp/out"; then
      echo "ok: CARGO_PROFILE_RELEASE_LTO reaches rustc as -C lto (bogus rejected)"
    else
      echo "FAILED: env override did not reach rustc (exit $status)" >&2
      tail -5 "$tmp/out" >&2
      exit 2
    fi
    say "size tooling"
    size -m "$MT_ROOT/crates/mt-tauri/binaries/mt-zig-core-$TRIPLE" | awk 'NR<=4'
    say "ready: ./sweep.sh probe"
    ;;

  probe)
    run_candidate "${1:-true}" "${2:-1}" 1
    ;;

  candidate)
    [ $# -ge 2 ] || { echo "usage: candidate <lto> <cgus> [runs]" >&2; exit 2; }
    run_candidate "$1" "$2" "${3:-2}"
    ;;

  matrix)
    runs="${1:-2}"
    failed=()
    for lto in "${LTO_VALUES[@]}"; do
      for cgus in "${CGUS_VALUES[@]}"; do
        # One candidate blowing up (OOM in the LTO linker, a build error) must not
        # cost the rest of the ~40 min pass; summary flags what is missing.
        run_candidate "$lto" "$cgus" "$runs" || failed+=("$(combo_label "$lto" "$cgus")")
      done
    done
    "$HERE/sweep.sh" summary
    if [ "${#failed[@]}" -gt 0 ]; then
      echo "incomplete candidates: ${failed[*]}" >&2
      exit 1
    fi
    ;;

  head2head)
    [ $# -ge 1 ] || { echo "usage: head2head <lto:cgus> [<lto:cgus>...] " >&2; exit 2; }
    args=(); names=(); cmds=()
    for spec in "$@"; do
      lto="${spec%%:*}"; cgus="${spec##*:}"
      cmds+=("$(build_cmd "$lto" "$cgus")")
      names+=("$(combo_label "$lto" "$cgus")")
    done
    for n in "${names[@]}"; do args+=(--command-name "$n"); done
    say "head-to-head: ${names[*]}"
    "$HYPERFINE" --runs 3 --warmup 0 --time-unit second \
      --prepare "$(clean_cmd)" "${args[@]}" \
      --export-json "$RESULTS_DIR/hyperfine-head2head.json" \
      --export-markdown "$RESULTS_DIR/hyperfine-head2head.md" \
      "${cmds[@]}" | tee "$RESULTS_DIR/hyperfine-head2head.txt"
    ;;

  cli-head2head)
    [ $# -ge 1 ] || { echo "usage: cli-head2head <lto:cgus> [<lto:cgus>...]" >&2; exit 2; }
    # Same candidates through the command the release legs run (cargo-tauri in
    # front of cargo). If the ranking from the bare cargo build does not survive
    # this, the CI-parity claim would be wrong, so it is checked rather than
    # assumed. One hyperfine run => directly comparable ratios.
    args=(); names=(); cmds=()
    for spec in "$@"; do
      lto="${spec%%:*}"; cgus="${spec##*:}"
      cmds+=("$(cli_build_cmd "$lto" "$cgus")")
      names+=("cli-$(combo_label "$lto" "$cgus")")
    done
    for n in "${names[@]}"; do args+=(--command-name "$n"); done
    say "head-to-head through the tauri CLI: ${names[*]}"
    "$HYPERFINE" --runs 3 --warmup 0 --time-unit second \
      --prepare "$(clean_cmd)" "${args[@]}" \
      --export-json "$RESULTS_DIR/hyperfine-cli-head2head.json" \
      --export-markdown "$RESULTS_DIR/hyperfine-cli-head2head.md" \
      "${cmds[@]}" | tee "$RESULTS_DIR/hyperfine-cli-head2head.txt"
    ;;

  ci-parity)
    [ $# -ge 2 ] || { echo "usage: ci-parity <lto> <cgus> [runs]" >&2; exit 2; }
    lto="$1"; cgus="$2"; runs="${3:-2}"
    label="ci-$(combo_label "$lto" "$cgus")"
    cmd="$(build_cmd "$lto" "$cgus")"
    # Same command the macOS release leg runs (release.yml -> task ci:build),
    # with the sccache wrapper the root taskfile injects.
    cmd="${cmd/#env /env RUSTC_WRAPPER=sccache }"
    say "$label (sccache on, cold target per run)"
    "$HYPERFINE" --runs "$runs" --warmup 0 --time-unit second \
      --command-name "$label" --prepare "$(clean_cmd)" \
      --export-json "$RESULTS_DIR/hyperfine-$label.json" \
      --export-markdown "$RESULTS_DIR/hyperfine-$label.md" \
      "$cmd" | tee "$RESULTS_DIR/hyperfine-$label.txt"
    sccache --show-stats >"$RESULTS_DIR/sccache-$label.txt" 2>&1 || true
    ;;

  timings)
    [ $# -ge 2 ] || { echo "usage: timings <lto> <cgus>" >&2; exit 2; }
    lto="$1"; cgus="$2"; label="timings-$(combo_label "$lto" "$cgus")"
    say "cargo --timings [$label]"
    eval "$(clean_cmd)"
    # Cargo 1.100 rejects --timings=html/--timings-dir (TASK-369.1), so run bare
    # --timings and copy target/cargo-timings out afterwards.
    eval "$(build_cmd "$lto" "$cgus") --timings"
    mkdir -p "$RESULTS_DIR/$label"
    cp -f "$CARGO_TARGET_DIR"/cargo-timings/cargo-timing*.html "$RESULTS_DIR/$label/" 2>/dev/null || true
    ls -1 "$RESULTS_DIR/$label"
    ;;

  launch)
    [ $# -ge 2 ] || { echo "usage: launch <lto> <cgus> [runs]" >&2; exit 2; }
    lto="$1"; cgus="$2"; runs="${3:-10}"
    label="launch-$(combo_label "$lto" "$cgus")"
    bin="$(bin_path)"
    [ -x "$bin" ] || { echo "no binary at $bin; build it first" >&2; exit 2; }
    say "launch proxy [$label] ($runs runs)"
    "$HYPERFINE" --runs "$runs" --warmup 2 --time-unit second \
      --command-name "$label" \
      --export-json "$RESULTS_DIR/hyperfine-$label.json" \
      --export-markdown "$RESULTS_DIR/hyperfine-$label.md" \
      "env MT_ENUMERATE_DEVICES=1 '$bin'" | tee "$RESULTS_DIR/hyperfine-$label.txt"
    ;;

  summary)
    say "summary -> $RESULTS_DIR/SUMMARY.md"
    MT_RESULTS_DIR="$RESULTS_DIR" python3 - <<'PY'
import glob, json, os, re
d = os.environ["MT_RESULTS_DIR"]
rows = {}
for f in sorted(glob.glob(os.path.join(d, "hyperfine-*.json"))):
    label = re.sub(r"^hyperfine-|\.json$", "", os.path.basename(f))
    for r in json.load(open(f))["results"]:
        name = r.get("command") or label
        s = r["stats"]
        rows.setdefault(label, {"mean": s["mean"], "min": s["min"], "max": s["max"],
                                "sdev": s["stddev"], "n": s["n"]})
sizes = {}
for f in sorted(glob.glob(os.path.join(d, "sizes-*.tsv"))):
    label = re.sub(r"^sizes-|\.tsv$", "", os.path.basename(f))
    for line in open(f):
        parts = line.rstrip("\n").split("\t")
        if len(parts) == 3:
            sizes.setdefault(label, {})[parts[1]] = parts[2]
base = rows.get("lto-fat-cgus1", {}).get("mean")
out = ["# TASK-369.4 release-profile matrix", "",
       "| candidate | mean s | min | max | sdev | n | binary MiB | __TEXT MiB | libmt_lib.a MiB | dmg MiB | vs baseline |",
       "|---|---|---|---|---|---|---|---|---|---|---|"]
for label in sorted(set(list(rows) + list(sizes))):
    r = rows.get(label, {})
    s = sizes.get(label, {})
    def mib(k):
        v = s.get(k, "")
        try: return f"{int(v)/1048576:.2f}"
        except ValueError: return "—"
    rel = "—" if not r or not base else f"{r['mean']/base:.2f}x"
    out.append("| {l} | {mean} | {min} | {max} | {sd} | {n} | {b} | {t} | {a} | {d} | {rel} |".format(
        l=label,
        mean="—" if not r else f"{r['mean']:.1f}",
        min="—" if not r else f"{r['min']:.1f}",
        max="—" if not r else f"{r['max']:.1f}",
        sd="—" if not r else f"{r['sdev']:.2f}",
        n=r.get("n", "—"),
        b=mib("binary-bytes"), t=mib("__TEXT-bytes"),
        a=mib("libmt_lib.a-bytes"), d=mib("dmg-bytes"), rel=rel))
open(os.path.join(d, "SUMMARY.md"), "w").write("\n".join(out) + "\n")
print("\n".join(out))
PY
    ;;

  *)
    echo "unknown subcommand: $cmd (see the header comment)" >&2
    exit 2
    ;;
esac
