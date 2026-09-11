#!/usr/bin/env bash
# Verify an agent CLI can reach its currently configured model and produce a
# real response, before handing it an unattended task. Exit 0 = reachable and
# working, non-zero = not ready (missing binary, timeout, error, or bad reply).
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: smoke-test.sh <pi|opencode> [options]

Options:
  --provider NAME   pi only: explicit --provider to pass through
  --model NAME      explicit --model to pass through
                    (pi: bare model id; opencode: "provider/model" pair)
  --path DIR        opencode only: working directory to run in (default: cwd)
  --timeout SECS    max wait for a response (default: 300)
  -h, --help        show this help

With no --provider/--model, the agent runs with whatever it already has
configured as its own default -- this is deliberate: the point is to test
the currently active configuration, not to pin one.

Examples:
  smoke-test.sh pi
  smoke-test.sh pi --provider aperture --model "qwen3.8-flash-next-iq4:builder"
  smoke-test.sh opencode --model "aperture/qwen3.8-flash-next-iq4:builder"
EOF
}

AGENT="${1:-}"
[ -n "$AGENT" ] && shift || true
PROVIDER=""
MODEL=""
RUN_PATH="$PWD"
TIMEOUT=300

while [ $# -gt 0 ]; do
  case "$1" in
    --provider) PROVIDER="$2"; shift 2 ;;
    --model) MODEL="$2"; shift 2 ;;
    --path) RUN_PATH="$2"; shift 2 ;;
    --timeout) TIMEOUT="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage; exit 2 ;;
  esac
done

if [ -z "$AGENT" ]; then
  usage
  exit 2
fi

PROMPT="Reply with exactly this one word and nothing else: PONG"
LOG="$(mktemp)"
trap 'rm -f "$LOG"' EXIT

case "$AGENT" in
  pi)
    if ! command -v pi >/dev/null 2>&1; then
      echo "FAIL: pi is not on PATH" >&2
      exit 1
    fi
    CMD=(pi)
    [ -n "$PROVIDER" ] && CMD+=(--provider "$PROVIDER")
    [ -n "$MODEL" ] && CMD+=(--model "$MODEL")
    CMD+=(-p "$PROMPT" --no-session)
    ;;
  opencode)
    if ! command -v opencode >/dev/null 2>&1; then
      echo "FAIL: opencode is not on PATH" >&2
      exit 1
    fi
    CMD=(opencode run "$PROMPT" --path "$RUN_PATH")
    [ -n "$MODEL" ] && CMD+=(--model "$MODEL")
    ;;
  *)
    echo "Unknown agent: $AGENT (expected 'pi' or 'opencode')" >&2
    usage
    exit 2
    ;;
esac

echo "Running: ${CMD[*]} (timeout ${TIMEOUT}s)" >&2
START=$(date +%s)
RC=0
timeout "$TIMEOUT" "${CMD[@]}" >"$LOG" 2>&1 || RC=$?
ELAPSED=$(( $(date +%s) - START ))

if [ "$RC" -eq 124 ]; then
  echo "FAIL: timed out after ${TIMEOUT}s waiting for a response" >&2
  echo "--- last output ---" >&2
  tail -n 40 "$LOG" >&2
  exit 1
fi

if [ "$RC" -ne 0 ]; then
  echo "FAIL: $AGENT exited with status $RC after ${ELAPSED}s" >&2
  echo "--- output ---" >&2
  tail -n 60 "$LOG" >&2
  exit 1
fi

if grep -qi 'PONG' "$LOG"; then
  echo "PASS: $AGENT responded correctly in ${ELAPSED}s"
  exit 0
fi

echo "FAIL: $AGENT ran without error but did not return the expected reply" >&2
echo "--- output ---" >&2
tail -n 60 "$LOG" >&2
exit 1
