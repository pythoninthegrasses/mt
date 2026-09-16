#!/usr/bin/env -S uv run --script

# /// script
# requires-python = ">=3.13,<3.14"
# dependencies = [
#     "python-decouple>=3.8",
# ]
# [tool.uv]
# exclude-newer = "2026-10-01T00:00:00Z"
# ///

# pyright: reportMissingImports=false

"""
Usage:
    gnhf.py -s <pi|opencode> [smoke-test options]
    gnhf.py -l [launch options] -- <agent command...>

Args:
    -s, --smoke-test AGENT   verify AGENT can reach its currently configured
                             model and produce a real response
    -l, --launch             run AGENT COMMAND detached, bounded by --ttl,
                             with a probe window and 429 backoff/retry

Note:
    Exit codes are shared across both modes:
      0  OK             -- PASS: / LAUNCHED:
      1  FAIL           -- unreachable, wrong reply, agent missing
      2  usage error
      3  RATE_LIMITED   -- 429s persisted past the retry ceiling
      4  EARLY_EXIT     -- died inside the probe window, not a 429

    Codes 3 and 4 both mean the task never got a turn. Neither is ever a task
    verdict (BAILED/DONE) -- see SKILL.md step 5.

    Defaults for every tunable below are resolved through python-decouple:
    CLI flag > process env > skills/gnhf/.env > hardcoded default. See
    .env.example for the full list of GNHF_* names.
"""

import argparse
import contextlib
import os
import random
import re
import shutil
import signal
import subprocess
import sys
import time
from datetime import datetime, timedelta
from decouple import Config, RepositoryEmpty, RepositoryEnv
from pathlib import Path

EXIT_OK = 0
EXIT_FAIL = 1
EXIT_USAGE = 2
EXIT_RATE_LIMITED = 3
EXIT_EARLY_EXIT = 4

SMOKE_TEST_PROMPT = "Reply with exactly this one word and nothing else: PONG"

RATE_LIMIT_PATTERNS = [
    re.compile(r'"code"\s*:\s*"concurrency_limit"'),
    re.compile(r"rate_limit_error", re.IGNORECASE),
    re.compile(r"\b(?:status|http)\b[^\n]{0,10}\b429\b", re.IGNORECASE),
    re.compile(r"\b429\b[^\n]{0,20}\btoo many requests\b", re.IGNORECASE),
]

SCRIPT_DIR = Path(__file__).resolve().parent
ENV_FILE = SCRIPT_DIR.parent / ".env"  # skills/gnhf/.env, not cwd-relative


def load_config(env_file):
    """Build a decouple Config that reads process env, then env_file if it
    exists. Deliberately not decouple's AutoConfig singleton -- that searches
    upward from cwd for a .env, which would pick up an unrelated one from
    whatever task worktree this script happens to be running in."""
    if env_file is not None and Path(env_file).exists():
        return Config(RepositoryEnv(str(env_file)))
    return Config(RepositoryEmpty())


config = load_config(ENV_FILE)

TTL_DEFAULT = config("GNHF_TTL", default=10800, cast=int)
PROBE_DEFAULT = config("GNHF_PROBE", default=25, cast=float)
BASE_BACKOFF_DEFAULT = config("GNHF_BASE_BACKOFF", default=75, cast=float)
MAX_BACKOFF_DEFAULT = config("GNHF_MAX_BACKOFF", default=900, cast=float)
MAX_429_DEFAULT = config("GNHF_MAX_429", default=6, cast=int)
TOTAL_BACKOFF_CAP_DEFAULT = config("GNHF_TOTAL_BACKOFF_CAP", default=2700, cast=float)
TIMEOUT_DEFAULT = config("GNHF_TIMEOUT", default=300, cast=int)
MAX_RETRIES_DEFAULT = config("GNHF_MAX_RETRIES", default=2, cast=int)
PROVIDER_DEFAULT = config("GNHF_PROVIDER", default=None)
MODEL_DEFAULT = config("GNHF_MODEL", default=None)

PROBE_POLL_INTERVAL = 0.05


def is_rate_limited(text):
    return any(pattern.search(text) for pattern in RATE_LIMIT_PATTERNS)


def _raw_backoff(attempt, base, cap):
    return min(base * (2 ** (attempt - 1)), cap)


def backoff_delay(attempt, base, cap):
    return _raw_backoff(attempt, base, cap) * random.uniform(0.8, 1.2)


def print_tail(text, n):
    for line in text.splitlines()[-n:]:
        print(line, file=sys.stderr)


def parse_args(argv):
    if "--" in argv:
        idx = argv.index("--")
        main_argv, launch_cmd = argv[:idx], argv[idx + 1 :]
    else:
        main_argv, launch_cmd = argv, []

    parser = argparse.ArgumentParser(
        prog="gnhf.py",
        description="Smoke-test or launch an agent CLI against aperture, "
        "surviving 429 concurrency-limit contention instead of failing on it.",
    )
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("-s", "--smoke-test", metavar="AGENT", choices=["pi", "opencode"])
    mode.add_argument("-l", "--launch", action="store_true")

    # smoke-test options
    parser.add_argument("-P", "--provider", default=PROVIDER_DEFAULT)
    parser.add_argument("-m", "--model", default=MODEL_DEFAULT)
    parser.add_argument("-d", "--path", default=None)
    parser.add_argument("-t", "--timeout", type=int, default=TIMEOUT_DEFAULT)
    parser.add_argument("-r", "--max-retries", type=int, default=MAX_RETRIES_DEFAULT)

    # launch options
    parser.add_argument("-C", "--cwd", default=None)
    parser.add_argument("-o", "--log", default=None)
    parser.add_argument("-T", "--ttl", type=int, default=TTL_DEFAULT)
    parser.add_argument("-p", "--probe", type=float, default=PROBE_DEFAULT)
    parser.add_argument("-b", "--base-backoff", type=float, default=BASE_BACKOFF_DEFAULT)
    parser.add_argument("-B", "--max-backoff", type=float, default=MAX_BACKOFF_DEFAULT)
    parser.add_argument("-n", "--max-429", type=int, default=MAX_429_DEFAULT)
    parser.add_argument("-c", "--total-backoff-cap", type=float, default=TOTAL_BACKOFF_CAP_DEFAULT)

    args = parser.parse_args(main_argv)
    args.launch_cmd = launch_cmd

    if args.launch:
        if not launch_cmd:
            parser.error("--launch requires a command after --")
        if not args.cwd or not args.log:
            parser.error("--launch requires --cwd and --log")

    return args


def build_smoke_cmd(agent, provider, model, path):
    if agent == "pi":
        if not shutil.which("pi"):
            return None, "FAIL: pi is not on PATH"
        cmd = ["pi"]
        if provider:
            cmd += ["--provider", provider]
        if model:
            cmd += ["--model", model]
        cmd += ["-p", SMOKE_TEST_PROMPT, "--no-session"]
        return cmd, None
    if agent == "opencode":
        if not shutil.which("opencode"):
            return None, "FAIL: opencode is not on PATH"
        cmd = ["opencode", "run", SMOKE_TEST_PROMPT, "--path", path]
        if model:
            cmd += ["--model", model]
        return cmd, None
    return None, f"Unknown agent: {agent} (expected 'pi' or 'opencode')"


def run_with_timeout(cmd, timeout_s):
    start = time.monotonic()
    try:
        proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=timeout_s, text=True)
        rc, output = proc.returncode, proc.stdout
    except subprocess.TimeoutExpired as exc:
        rc = 124
        output = exc.output if isinstance(exc.output, str) else (exc.output or b"").decode(errors="replace")
    return rc, time.monotonic() - start, output


def run_smoke_test(agent, provider, model, path, timeout_s, max_retries, base_backoff, max_backoff):
    cmd, err = build_smoke_cmd(agent, provider, model, path or os.getcwd())
    if cmd is None:
        print(err, file=sys.stderr)
        return EXIT_FAIL

    attempt = 0
    while True:
        attempt += 1
        print(f"Running: {' '.join(cmd)} (timeout {timeout_s}s)", file=sys.stderr)
        rc, elapsed, output = run_with_timeout(cmd, timeout_s)

        if rc == 124:
            print(f"FAIL: timed out after {timeout_s}s waiting for a response", file=sys.stderr)
            print("--- last output ---", file=sys.stderr)
            print_tail(output, 40)
            return EXIT_FAIL

        if rc != 0:
            if is_rate_limited(output):
                if attempt > max_retries:
                    print(f"RATE_LIMITED: {agent} still rate-limited after {attempt} attempts", file=sys.stderr)
                    print("--- output ---", file=sys.stderr)
                    print_tail(output, 60)
                    return EXIT_RATE_LIMITED
                delay = backoff_delay(attempt, base_backoff, max_backoff)
                print(f"RATE_LIMITED: attempt {attempt}, retrying in {delay:.0f}s", file=sys.stderr)
                time.sleep(delay)
                continue
            print(f"FAIL: {agent} exited with status {rc} after {elapsed:.0f}s", file=sys.stderr)
            print("--- output ---", file=sys.stderr)
            print_tail(output, 60)
            return EXIT_FAIL

        if re.search(r"pong", output, re.IGNORECASE):
            print(f"PASS: {agent} responded correctly in {elapsed:.0f}s")
            return EXIT_OK

        print(f"FAIL: {agent} ran without error but did not return the expected reply", file=sys.stderr)
        print("--- output ---", file=sys.stderr)
        print_tail(output, 60)
        return EXIT_FAIL


def _kill_process_group(proc):
    try:
        pgid = os.getpgid(proc.pid)
    except ProcessLookupError:
        return
    try:
        os.killpg(pgid, signal.SIGTERM)
        proc.wait(timeout=5)
    except (ProcessLookupError, subprocess.TimeoutExpired):
        with contextlib.suppress(ProcessLookupError):
            os.killpg(pgid, signal.SIGKILL)


def run_launch(cwd, log_path, ttl, probe, base_backoff, max_backoff, max_429, total_backoff_cap, command):
    log_path = Path(log_path)
    log_path.parent.mkdir(parents=True, exist_ok=True)

    attempt = 0
    total_backoff = 0.0

    with open(log_path, "a") as logf:
        while True:
            attempt += 1
            logf.write(f"\n--- gnhf launch attempt {attempt} at {datetime.now().isoformat()} ---\n")
            logf.flush()
            attempt_offset = logf.tell()

            full_cmd = ["timeout", str(ttl), *command]
            proc = subprocess.Popen(full_cmd, cwd=cwd, stdout=logf, stderr=subprocess.STDOUT, start_new_session=True)

            def attempt_output():
                with open(log_path, errors="replace") as f:
                    f.seek(attempt_offset)
                    return f.read()

            rate_limited = False
            exited_early = False
            deadline = time.monotonic() + probe
            while time.monotonic() < deadline:
                time.sleep(PROBE_POLL_INTERVAL)
                if is_rate_limited(attempt_output()):
                    rate_limited = True
                    break
                if proc.poll() is not None:
                    exited_early = True
                    break

            if not rate_limited and not exited_early and proc.poll() is not None:
                if is_rate_limited(attempt_output()):
                    rate_limited = True
                else:
                    exited_early = True

            if rate_limited:
                _kill_process_group(proc)
                if attempt >= max_429 or total_backoff >= total_backoff_cap:
                    print(
                        f"RATE_LIMITED: gave up after {attempt} attempts, {total_backoff:.0f}s of backoff",
                        file=sys.stderr,
                    )
                    return EXIT_RATE_LIMITED
                delay = backoff_delay(attempt, base_backoff, max_backoff)
                total_backoff += delay
                print(f"RATE_LIMITED: attempt {attempt}, backing off {delay:.0f}s", file=sys.stderr)
                time.sleep(delay)
                continue

            if exited_early:
                print(
                    f"EARLY_EXIT: process exited during the {probe}s probe window, not rate-limited -- a real dispatch failure",
                    file=sys.stderr,
                )
                return EXIT_EARLY_EXIT

            ttl_expires = (datetime.now() + timedelta(seconds=max(ttl - probe, 0))).isoformat()
            print(f"LAUNCHED: pid={proc.pid} attempt={attempt} ttl_expires={ttl_expires}")
            return EXIT_OK


def main(argv=None):
    args = parse_args(sys.argv[1:] if argv is None else argv)

    if args.launch:
        return run_launch(
            cwd=args.cwd,
            log_path=args.log,
            ttl=args.ttl,
            probe=args.probe,
            base_backoff=args.base_backoff,
            max_backoff=args.max_backoff,
            max_429=args.max_429,
            total_backoff_cap=args.total_backoff_cap,
            command=args.launch_cmd,
        )

    return run_smoke_test(
        agent=args.smoke_test,
        provider=args.provider,
        model=args.model,
        path=args.path,
        timeout_s=args.timeout,
        max_retries=args.max_retries,
        base_backoff=BASE_BACKOFF_DEFAULT,
        max_backoff=MAX_BACKOFF_DEFAULT,
    )


if __name__ == "__main__":
    sys.exit(main())
