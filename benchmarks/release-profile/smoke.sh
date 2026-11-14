#!/usr/bin/env bash
# AC#3 playback smoke for one release-profile candidate (TASK-369.4).
#
#   ./smoke.sh true 1        # baseline
#   ./smoke.sh thin 4        # a candidate
#
# Answers "does the shipped artifact still work" for a given lto x codegen-units
# build, without the MCP bridge:
#
#   1. cold-build the release binary and the audio_test example with that profile,
#      then bundle the .app (the bundler copies the Zig sidecar next to the binary,
#      which is the layout users actually get and the one externalBin expects)
#   2. MT_ENUMERATE_DEVICES=1 probe: the CoreAudio device enumeration subprocess
#   3. launch the app under an isolated HOME (its own mt.db, settings.json, logs and
#      WebKit caches), let it create the database, and quit it
#   4. register a folder of repo fixtures as a watched folder and relaunch: the
#      startup scan must put those tracks in the library table
#   5. play a fixture through the real rodio output device via audio_test and
#      require the reported position to advance
#   6. fail on anything ERROR or panicked in the app log
#
# The acceptance criterion is that this passes IDENTICALLY for baseline and winner,
# so every run is summarised into results-<date>/smoke-<candidate>.txt and those two
# files are diffed. Output is muted for the playback step and restored after; the
# app window appears twice for a few seconds.

set -euo pipefail

[ $# -ge 2 ] || { echo "usage: $0 <lto: true|thin|false> <codegen-units>" >&2; exit 2; }
lto="$1"; cgus="$2"
case "$lto" in true|thin|false) ;; *) echo "lto must be true, thin or false" >&2; exit 2 ;; esac
case "$cgus" in ''|*[!0-9]*) echo "codegen-units must be a number" >&2; exit 2 ;; esac

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Its own target dir, for two reasons: this script wipes it before building, and it
# must not reach into the directory a matrix pass is still building in; and a smoke
# run should not inherit release artifacts a differently-profiled build left behind.
export BENCH_TARGET_DIR="${BENCH_TARGET_DIR:-$(git -C "$HERE" rev-parse --show-toplevel)/.cache/bench-369-4/target-smoke}"
# shellcheck source=env.sh
. "$HERE/env.sh"

label="$(combo_label "$lto" "$cgus")"
OUT="$RESULTS_DIR/smoke-$label.txt"
mkdir -p "$RESULTS_DIR"
: >"$OUT"

FIXTURES_SRC="$MT_ROOT/crates/mt-tauri/tests/fixtures"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/mt-smoke-$label.XXXXXX")"
SMOKE_HOME="$WORK/home"
LIB_DIR="$WORK/library"
DB="$SMOKE_HOME/Library/Application Support/com.mt.desktop/mt.db"
APP_LOG_DIR="$SMOKE_HOME/Library/Logs/com.mt.desktop"
APP_BIN="$CARGO_TARGET_DIR/$TRIPLE/release/bundle/macos/mt.app/Contents/MacOS/mt"
FAILURES=0
APP_PID=""
VOL=""

note() { printf '%s\n' "$*" | tee -a "$OUT"; }
# Diagnostics go to the terminal only. The two summary files are what AC#3 diffs, so
# anything that legitimately varies run to run (elapsed positions, byte counts that
# the size tables already record) stays out of them; otherwise the diff says nothing
# about whether the two candidates behaved the same.
detail() { printf '      %s\n' "$*"; }
# check <name> <status: 0 = pass> <detail>
check() {
  if [ "$2" = "0" ]; then note "PASS  $1: $3"; else note "FAIL  $1: $3"; FAILURES=$((FAILURES + 1)); fi
}
cleanup() {
  [ -n "$APP_PID" ] && kill "$APP_PID" 2>/dev/null || true
  [ -n "$VOL" ] && osascript -e "set volume output volume $VOL" >/dev/null 2>&1 || true
  # On a failure the raw transcripts are the only explanation, and $WORK is a
  # temp dir. They are kept in the results dir, where .gitignore already excludes
  # *.log, so a passing run leaves nothing behind.
  if [ "$FAILURES" -gt 0 ]; then
    for f in "$WORK"/*.log "$WORK"/devices.err; do
      [ -f "$f" ] && cp "$f" "$RESULTS_DIR/smoke-$label-$(basename "$f")" 2>/dev/null || true
    done
    echo "diagnostics kept in $RESULTS_DIR/smoke-$label-*.log"
  fi
  rm -rf "$WORK"
}
trap cleanup EXIT

start_app() {
  HOME="$SMOKE_HOME" MT_LOG=debug "$APP_BIN" >"$WORK/app-stdout.$1.log" 2>&1 &
  APP_PID=$!
}
stop_app() {
  [ -n "$APP_PID" ] || return 0
  # The app spawns the sidecar and the device-enumeration subprocess, so take the
  # process group's children too; then escalate, because a GUI app that ignores
  # SIGTERM would otherwise hang the smoke run on `wait`.
  pkill -P "$APP_PID" 2>/dev/null || true
  kill "$APP_PID" 2>/dev/null || true
  for _ in {1..20}; do kill -0 "$APP_PID" 2>/dev/null || break; sleep 0.25; done
  kill -9 "$APP_PID" 2>/dev/null || true
  wait "$APP_PID" 2>/dev/null || true
  APP_PID=""
}
wait_for_file() {
  local _
  for _ in {1..40}; do [ -f "$1" ] && return 0; sleep 0.5; done
  return 1
}
db() { /usr/bin/sqlite3 -cmd ".timeout 8000" "$DB" "$1"; }

# audio_test samples once a second and returns when the sink reports done. If the
# output device never delivers a callback (no running audio daemon, a device that
# refuses the stream) it samples forever, and an unbounded call here once wedged a
# smoke run for eight hours, so every invocation is bounded. 124 is the timeout exit.
run_timed() {
  local secs="$1"; shift
  if command -v gtimeout >/dev/null 2>&1; then gtimeout "$secs" "$@"
  elif command -v timeout >/dev/null 2>&1; then timeout "$secs" "$@"
  else "$@"; fi
}

# A sine WAV, generated rather than committed: the repo fixtures are all exactly one
# second, which is too short to show a clock advancing.
make_tone() {
  local path="$1" secs="${2:-6}"
  MT_TONE_SECS="$secs" python3 - "$path" <<'PY'
import math, os, struct, sys, wave
path, rate, secs = sys.argv[1], 44100, int(os.environ["MT_TONE_SECS"])
with wave.open(path, "wb") as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(rate)
    w.writeframes(b"".join(
        struct.pack("<h", int(0.25 * 32767 * math.sin(2 * math.pi * 220 * i / rate)))
        for i in range(rate * secs)))
PY
}

# Skipped checks are recorded but never counted as failures, so a host that cannot
# exercise a path does not fail a candidate for it. They still land in the summary
# file: AC#3 compares the two files, and "skipped here too" has to be visible.
skip() { note "SKIP  $1: $2"; }

say "build and bundle [$label] (lto=$lto codegen-units=$cgus)"
# Tauri resolves externalBin eagerly, so bundling fails outright without the sidecar.
# It is not built here because it is identical for every candidate.
sidecar="crates/mt-tauri/binaries/mt-zig-core-$TRIPLE"
if [ ! -x "$MT_ROOT/$sidecar" ]; then
  note "FAIL  sidecar: $sidecar is missing. Run: task zig:stage TARGET=$TRIPLE"
  exit 1
fi
export CARGO_PROFILE_RELEASE_LTO="$lto" CARGO_PROFILE_RELEASE_CODEGEN_UNITS="$cgus"
unset RUSTC_WRAPPER
eval "$(clean_cmd)"
# The example links the same mt_lib under the same profile, so the playback step
# exercises the codegen being tested rather than some other build. --bin mt is
# explicit because naming --example alone selects only that target, and the bundler
# needs the app binary to already exist.
if ! env RUSTUP_TOOLCHAIN="$RUSTUP_TOOLCHAIN" CARGO_HOME="$CARGO_HOME" \
    CARGO_TARGET_DIR="$CARGO_TARGET_DIR" CARGO_BUILD_JOBS="$CARGO_BUILD_JOBS" \
    "$CARGO" build --release --target "$TRIPLE" -p mt-tauri --bin mt --example audio_test \
    >"$WORK/build.log" 2>&1; then
  note "FAIL  build: see $WORK/build.log"
  tail -20 "$WORK/build.log" | tee -a "$OUT"
  exit 1
fi
# Bundle just the .app: the bundler copies the Zig sidecar next to the binary, which
# is the layout users actually get and the one externalBin expects.
"$TAURI" bundle --target "$TRIPLE" --bundles app --config '{"build":{"beforeBuildCommand":""}}' \
  >"$WORK/bundle.log" 2>&1 || { note "FAIL  bundle: see $WORK/bundle.log"; tail -20 "$WORK/bundle.log" | tee -a "$OUT"; exit 1; }

AUDIO_TEST="$CARGO_TARGET_DIR/$TRIPLE/release/examples/audio_test"
if [ ! -x "$APP_BIN" ] || [ ! -x "$AUDIO_TEST" ]; then
  note "FAIL  artifacts: missing $APP_BIN or $AUDIO_TEST"
  exit 1
fi
note "candidate: lto=$lto codegen-units=$cgus, host $(uname -m), macOS $(sw_vers -productVersion)"
detail "app: $APP_BIN ($(stat -f%z "$APP_BIN") bytes)"

say "0. audio path pre-flight"
# Every audio check below depends on the machine actually being able to render. When
# coreaudiod is wedged, rodio opens a device, reports Playing, and the position never
# advances; afplay hangs the same way. Distinguishing that from a candidate regression
# matters: an unplayable host would otherwise fail both candidates identically and the
# diff would prove nothing. `afplay` is Apple's own player, so it is the control.
PROBE="$WORK/probe.wav"
make_tone "$PROBE" 2
AUDIO_OK=0
if run_timed 25 afplay "$PROBE" >/dev/null 2>&1; then
  AUDIO_OK=1
  check "audio-path" 0 "afplay rendered a 2 s tone"
else
  check "audio-path" 1 "afplay did not finish in 25 s (coreaudiod wedged?)"
fi

say "1. device enumeration subprocess"
if run_timed 20 env HOME="$SMOKE_HOME" MT_ENUMERATE_DEVICES=1 "$APP_BIN" >"$WORK/devices.json" 2>"$WORK/devices.err"; then
  # The subprocess prints the JSON form of Vec<String> -- a bare array of names.
  devices="$(python3 -c 'import json,sys; print(len(json.load(open(sys.argv[1]))))' \
    "$WORK/devices.json" 2>/dev/null || echo 0)"
  check "enumerate-devices" "$([ "${devices:-0}" -ge 1 ] && echo 0 || echo 1)" "${devices:-0} device(s), exit 0"
else
  status=$?
  # SIGSEGV here means CoreAudio itself crashed inside the enumeration subprocess,
  # which is the exact failure that subprocess was isolated to absorb. On a host whose
  # audio daemon is wedged every candidate hits it, so it is reported as a skip.
  if [ "$AUDIO_OK" -eq 0 ] && { [ "$status" = "139" ] || [ "$status" = "124" ]; }; then
    skip "enumerate-devices" "host audio is broken (exit $status in CoreAudio)"
  else
    check "enumerate-devices" 1 "exit $status: $(head -2 "$WORK/devices.err" | tr '\n' ' ')"
  fi
fi

say "2. first launch creates the database"
mkdir -p "$SMOKE_HOME"
start_app first
if wait_for_file "$DB"; then
  check "first-launch-db" 0 "mt.db created under the isolated HOME"
else
  check "first-launch-db" 1 "no mt.db after 20 s: $(head -3 "$WORK/app-stdout.first.log" | tr '\n' ' ')"
fi
stop_app

say "3. register a watched folder and scan it"
mkdir -p "$LIB_DIR"
# A private copy of the fixtures, so the expected count is exact and the scanner
# never sees files another test added to the checkout.
cp "$FIXTURES_SRC"/test_sample.* "$LIB_DIR/"
expected="$(find "$LIB_DIR" -type f \( -name '*.mp3' -o -name '*.flac' -o -name '*.m4a' -o -name '*.ogg' -o -name '*.wav' \) | wc -l | tr -d ' ')"
db "INSERT OR REPLACE INTO watched_folders (path, mode, enabled) VALUES ('$LIB_DIR', 'startup', 1);"

start_app scan
scanned=0
for _ in $(seq 1 60); do
  scanned="$(db 'SELECT COUNT(*) FROM library;' 2>/dev/null || echo 0)"
  [ "${scanned:-0}" -ge 1 ] && break
  sleep 0.5
done
check "library-scan" "$([ "${scanned:-0}" -ge 1 ] && echo 0 || echo 1)" "$scanned of $expected fixture track(s) in the library table"
stop_app

say "4. playback through the real output device"
# Every repo fixture is exactly one second (they are metadata test samples), and
# audio_test samples its position once a second, so a fixture alone can never show
# the clock advancing three times. Generate a six-second tone for the advance check;
# the mp3 fixture is still played, for what it proves about decoding.
TONE="$WORK/tone.wav"
make_tone "$TONE" 6 || { note "FAIL  tone: could not generate a test file"; exit 1; }
VOL="$(osascript -e 'output volume of (get volume settings)' 2>/dev/null || echo '')"
osascript -e 'set volume output volume 0' >/dev/null 2>&1 || true
# With a wedged audio path the sink never reports done and audio_test samples forever
# (it did once for eight hours), so on such a host the tone is not played at all and
# the mp3 gets only the short budget a decode proof needs.
tone_runs=60; fix_runs=60
if [ "$AUDIO_OK" -eq 0 ]; then tone_runs=0; fix_runs=20; fi
[ "$tone_runs" -gt 0 ] && run_timed "$tone_runs" "$AUDIO_TEST" "$TONE" >"$WORK/playback.log" 2>&1 || true
[ -f "$WORK/playback.log" ] || : >"$WORK/playback.log"
run_timed "$fix_runs" "$AUDIO_TEST" "$LIB_DIR/test_sample.mp3" >"$WORK/playback-fixture.log" 2>&1 || true
[ -n "$VOL" ] && osascript -e "set volume output volume $VOL" >/dev/null 2>&1 || true
VOL=""
# audio_test prints "[Ns] Position: <ms>ms / <ms>ms | State: Playing" once a second.
positions="$(awk '{ for (i = 1; i < NF; i++) if ($i == "Position:") { v = $(i + 1); gsub(/[^0-9].*/, "", v); print v } }' "$WORK/playback.log")"
n_positions="$(printf '%s\n' "$positions" | grep -c . || true)"
advanced="$(printf '%s\n' "$positions" | awk 'NR > 1 && $1 > prev { c++ } { prev = $1 } END { print c + 0 }')"
detail "tone positions: $(printf '%s' "$positions" | tr '\n' ' ')"
detail "$(grep -m1 'Duration:' "$WORK/playback.log" || echo 'no Duration line')"
if [ "$AUDIO_OK" -eq 0 ]; then
  # Skipping, not failing: the same host fails Apple's own player, so this measures
  # the machine, not the codegen. It is still recorded, so both summary files say the
  # same thing and the diff stays meaningful.
  skip "playback-advances" "host cannot render audio (see audio-path), clock not measured"
else
  check "playback-advances" "$([ "${advanced:-0}" -ge 3 ] && echo 0 || echo 1)" \
    "${advanced:-0} of ${n_positions:-0} one-second sample(s) advanced, state Playing"
fi
played="$(grep -c "Failed to" "$WORK/playback-fixture.log" || true)"
fixdur="$(awk '/Duration:/ {gsub(/[^0-9]/,"",$2); print $2; exit}' "$WORK/playback-fixture.log")"
# A one-second track is usually Stopped by the first sample, so the fixture proves
# the decoder path (it loaded, and reported its real length), not the clock. That
# proof does not need a working device, so it runs either way.
check "playback-fixture" "$( [ "${played:-1}" -eq 0 ] && [ "${fixdur:-0}" -gt 0 ] && echo 0 || echo 1)" \
  "test_sample.mp3 decoded as ${fixdur:-?}ms, ${played:-0} load failure(s)"

say "5. app log cleanliness"
log_file="$(find "$APP_LOG_DIR" -name 'mt.log*' -type f 2>/dev/null | head -1)"
if [ -n "$log_file" ]; then
  # Match the level column, not the word: WARN lines carry `error=...` field names
  # and would otherwise count as failures. The sidecar-termination ERROR is the one
  # this script causes itself, by killing the app between steps, so it is excluded.
  bad="$(awk '$2 == "ERROR"' "$log_file" |
          grep -v 'sidecar process terminated' | grep -icE 'panicked|ERROR' || true)"
  check "app-log" "$([ "${bad:-0}" -eq 0 ] && echo 0 || echo 1)" "$bad unexpected error line(s) in $(basename "$log_file")"
  if [ "${bad:-0}" -gt 0 ]; then
    awk '$2 == "ERROR"' "$log_file" | grep -v 'sidecar process terminated' |
      head -5 | tee -a "$OUT" || true
  fi
else
  check "app-log" 1 "no log file under $APP_LOG_DIR"
fi

say "verdict"
if [ "$FAILURES" -eq 0 ]; then
  note "RESULT $label: PASS"
else
  note "RESULT $label: FAIL ($FAILURES check(s))"
fi
echo "smoke -> $OUT"
[ "$FAILURES" -eq 0 ]
