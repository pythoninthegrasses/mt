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
    # Build the named candidate first. The target dir holds whatever the matrix left
    # in it, so timing the binary that happens to be there would label, say, an
    # lto=false cgus=16 launch as `launch-lto-fat-cgus1`. cargo no-ops when the
    # profile is already what was built.
    say "build [$label] for the launch proxy"
    eval "$(build_cmd "$lto" "$cgus")" || { echo "!! $label: build failed" >&2; exit 1; }
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

# The three columns land in different places and prefix their labels differently
# (lto-*, linux-lto-*, windows-lto-*), and each is only comparable to its own
# baseline: a Blacksmith runner's seconds are not an M4 Max's seconds.
def platform(path):
    # Files straight in the results dir are the host column; anything in a
    # subdirectory belongs to that column's platform. GitHub's artifact download
    # nests one directory per job, so match on a prefix rather than a name.
    top = os.path.dirname(os.path.relpath(path, d))
    if top in ("", "."):
        return "macos"
    name = top.split(os.sep)[0].lower()
    for known in ("windows", "linux", "macos"):
        if name.startswith(known):
            return known
    return name

def label_of(path, prefix):
    label = re.sub(r"^%s-|\.json$|\.tsv$" % prefix, "", os.path.basename(path))
    # The Windows workflow names the knob's literal value (`lto-true`), the host and
    # Linux columns name the profile keyword's effect (`lto-fat`), and hyperfine labels
    # are not a good place to harmonise because they are written at run time. Collapse
    # them here so the three columns agree on one spelling per candidate.
    return re.sub(r"\blto-true-cgus", "lto-fat-cgus", label)

rows, sizes = {}, {}
for f in sorted(glob.glob(os.path.join(d, "**", "hyperfine-*.json"), recursive=True)):
    label = label_of(f, "hyperfine")
    # Only matrix candidates belong in the tables. head2head exports its own file,
    # and ci-parity / launch prefix their labels, so those are excluded by shape.
    if not re.search(r"lto-(fat|thin|false|off)-cgus\d+$", label):
        continue
    try:
        results = json.load(open(f))["results"]
    except (ValueError, KeyError, OSError):
        continue                       # an aborted candidate leaves an empty file
    if not results:
        continue
    # Hyperfine puts the statistics on the result object itself; there is no
    # nested "stats" key, and the sample count is the length of `times`.
    s = results[0]
    times = s.get("times") or []
    rows.setdefault(platform(f), {})[label] = {
        "mean": s["mean"], "min": s["min"], "max": s["max"],
        # hyperfine leaves stddev null for a single run.
        "sdev": s.get("stddev") or 0.0, "n": len(times) or s.get("num_runs", "—")}
for f in sorted(glob.glob(os.path.join(d, "**", "sizes-*.tsv"), recursive=True)):
    label = label_of(f, "sizes")
    for line in open(f):
        parts = line.rstrip("\n").split("\t")
        if len(parts) == 3 and parts[2].isdigit():
            sizes.setdefault(platform(f), {}).setdefault(label, {})[parts[1]] = int(parts[2])

# Keys differ per platform because each ships a different artifact.
TEXT_KEYS = ("__TEXT-bytes", "text-bytes")
INST_KEYS = ("dmg-bytes", "deb-bytes", "nsis-bytes")

def pick(s, keys):
    for k in keys:
        if k in s:
            return s[k]
    return None

def mib(v):
    return "—" if v is None else f"{v / 1048576:.2f}"

def delta(v, base):
    if v is None or not base:
        return "—"
    return f"{(v / base - 1) * 100:+.1f}%"

out = ["# TASK-369.4 release-profile matrix", "",
       "Cold release build of `mt-tauri` per candidate, sccache off: the host column",
       "times the bare `cargo build --release --target <triple> -p mt-tauri`, the",
       "Linux and Windows columns time `tauri-build.sh build` (what their release legs",
       "run). Ratios are relative to each platform's own `lto-fat-cgus1` baseline, i.e.",
       "the committed profile; absolute seconds are only comparable within a column.", ""]
for plat in [p for p in ("macos", "linux", "windows") if p in rows or p in sizes] + \
            [p for p in sorted(set(rows) | set(sizes)) if p not in ("macos", "linux", "windows")]:
    r_, s_ = rows.get(plat, {}), sizes.get(plat, {})
    base_label = next((k for k in r_ if k.endswith("lto-fat-cgus1")), None)
    base_time = r_[base_label]["mean"] if base_label else None
    base_size = s_.get(base_label, {})
    out += ["", f"## {plat}", "",
            "| candidate | mean s | vs baseline | n | binary MiB | Δ | text MiB | staticlib MiB | installer MiB | Δ | target MiB |",
            "|---|---|---|---|---|---|---|---|---|---|---|"]
    for label in sorted(set(r_) | set(s_)):
        r, s = r_.get(label, {}), s_.get(label, {})
        text = pick(s, TEXT_KEYS)
        inst = pick(s, INST_KEYS)
        tgt = s.get("target-triple-kib")
        out.append("| {l} | {mean} | {rel} | {n} | {b} | {bd} | {t} | {a} | {i} | {id} | {tg} |".format(
            l=label,
            mean="—" if not r else f"{r['mean']:.1f}",
            rel="—" if not r or not base_time else f"{r['mean'] / base_time:.2f}x",
            n=r.get("n", "—"),
            b=mib(s.get("binary-bytes")),
            bd=delta(s.get("binary-bytes"), base_size.get("binary-bytes")),
            t=mib(text),
            a=mib(s.get("libmt_lib.a-bytes")),
            i=mib(inst),
            id=delta(inst, base_size.get(next((k for k in INST_KEYS if k in base_size), ""))),
            tg="—" if tgt is None else mib(tgt * 1024)))
    missing = [k for k, v in r_.items() if k not in s_]
    if missing:
        out += ["", f"_No size data for: {', '.join(sorted(missing))}_"]
open(os.path.join(d, "SUMMARY.md"), "w").write("\n".join(out) + "\n")
print("\n".join(out))
PY
    ;;

  *)
    echo "unknown subcommand: $cmd (see the header comment)" >&2
    exit 2
    ;;
esac
