#!/usr/bin/env -S uv run --script

# /// script
# requires-python = ">=3.13,<3.14"
# dependencies = [
#     "pytest>=8.0",
#     "python-decouple>=3.8",
# ]
# [tool.uv]
# exclude-newer = "2026-10-01T00:00:00Z"
# ///

# pyright: reportMissingImports=false

"""
Usage:
    ./test_gnhf.py [pytest args...]

Args:
    Any arguments are passed through to pytest.

Note:
    PEP 723 self-contained test suite for gnhf.py -- run directly, `uv run`
    resolves pytest + python-decouple into an isolated environment.
"""

import contextlib
import importlib.util
import os
import pytest
import signal
import subprocess
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
GNHF_PATH = SCRIPT_DIR / "gnhf.py"

spec = importlib.util.spec_from_file_location("gnhf", GNHF_PATH)
gnhf = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gnhf)


def run_gnhf(args, **kwargs):
    kwargs.setdefault("stdout", subprocess.PIPE)
    kwargs.setdefault("stderr", subprocess.PIPE)
    kwargs.setdefault("text", True)
    return subprocess.run([sys.executable, str(GNHF_PATH), *args], **kwargs)


def make_fake_bin(tmp_path, name, body):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir(exist_ok=True)
    script = bin_dir / name
    script.write_text(f"#!/usr/bin/env python3\n{body}\n")
    script.chmod(0o755)
    return bin_dir


def prepend_path(monkeypatch, bin_dir):
    monkeypatch.setenv("PATH", f"{bin_dir}{os.pathsep}{os.environ['PATH']}")


@pytest.fixture
def kill_on_teardown():
    pids = []
    yield pids
    for pid in pids:
        with contextlib.suppress(ProcessLookupError, PermissionError):
            os.killpg(os.getpgid(pid), signal.SIGKILL)


def extract_launched_pid(output):
    for line in output.splitlines():
        if line.startswith("LAUNCHED:"):
            for token in line.split():
                if token.startswith("pid="):
                    return int(token.removeprefix("pid="))
    return None


# --- is_rate_limited ---


@pytest.mark.parametrize(
    "text",
    [
        '{"code": "concurrency_limit", "message": "backend busy"}',
        '{"code":"concurrency_limit"}',
        "rate_limit_error: too many concurrent sessions",
        "HTTP 429 received from upstream",
        "status 429 Too Many Requests",
        "429 Too Many Requests",
    ],
)
def test_is_rate_limited_true(text):
    assert gnhf.is_rate_limited(text) is True


@pytest.mark.parametrize(
    "text",
    [
        "used 429 tokens for this request",
        "the call took 429ms to complete",
        "",
        "ordinary traceback: ValueError: bad thing happened",
    ],
)
def test_is_rate_limited_false(text):
    assert gnhf.is_rate_limited(text) is False


# --- backoff ---


def test_raw_backoff_monotonic_and_capped():
    base, cap = 10, 40
    delays = [gnhf._raw_backoff(attempt, base, cap) for attempt in range(1, 6)]
    assert delays == [10, 20, 40, 40, 40]


def test_backoff_delay_applies_jitter_within_bounds():
    base, cap = 10, 40
    for attempt in range(1, 4):
        raw = gnhf._raw_backoff(attempt, base, cap)
        for _ in range(20):
            delay = gnhf.backoff_delay(attempt, base, cap)
            assert raw * 0.8 <= delay <= raw * 1.2


# --- config precedence ---


def test_config_default_when_nothing_set(monkeypatch):
    monkeypatch.delenv("GNHF_PROBE", raising=False)
    config = gnhf.load_config(None)
    assert config("GNHF_PROBE", default=25, cast=float) == 25.0


def test_config_process_env_overrides_default(monkeypatch):
    monkeypatch.setenv("GNHF_PROBE", "99")
    config = gnhf.load_config(None)
    assert config("GNHF_PROBE", default=25, cast=float) == 99.0


def test_config_env_file_value_used(tmp_path, monkeypatch):
    monkeypatch.delenv("GNHF_PROBE", raising=False)
    env_file = tmp_path / ".env"
    env_file.write_text("GNHF_PROBE=42\n")
    config = gnhf.load_config(env_file)
    assert config("GNHF_PROBE", default=25, cast=float) == 42.0


def test_config_process_env_overrides_env_file(tmp_path, monkeypatch):
    env_file = tmp_path / ".env"
    env_file.write_text("GNHF_PROBE=42\n")
    monkeypatch.setenv("GNHF_PROBE", "7")
    config = gnhf.load_config(env_file)
    assert config("GNHF_PROBE", default=25, cast=float) == 7.0


def test_cli_flag_beats_env_and_default(monkeypatch):
    monkeypatch.setenv("GNHF_PROBE", "99")
    args = gnhf.parse_args(["-l", "-C", "/tmp", "-o", "/tmp/x.log", "-p", "3", "--", "true"])
    assert args.probe == 3.0


# --- mode selection ---


def test_no_mode_selected_is_usage_error():
    result = run_gnhf([])
    assert result.returncode == gnhf.EXIT_USAGE


def test_both_modes_selected_is_usage_error():
    result = run_gnhf(["-s", "pi", "-l", "--", "true"])
    assert result.returncode == gnhf.EXIT_USAGE


def test_launch_without_command_is_usage_error(tmp_path):
    result = run_gnhf(["-l", "-C", str(tmp_path), "-o", str(tmp_path / "x.log")])
    assert result.returncode == gnhf.EXIT_USAGE


def test_launch_without_cwd_or_log_is_usage_error():
    result = run_gnhf(["-l", "--", "true"])
    assert result.returncode == gnhf.EXIT_USAGE


# --- smoke-test mode ---


def test_smoke_test_pass(tmp_path, monkeypatch):
    bin_dir = make_fake_bin(tmp_path, "pi", 'print("PONG")')
    prepend_path(monkeypatch, bin_dir)
    rc = gnhf.run_smoke_test(
        agent="pi",
        provider=None,
        model=None,
        path=str(tmp_path),
        timeout_s=10,
        max_retries=1,
        base_backoff=0.05,
        max_backoff=0.1,
    )
    assert rc == gnhf.EXIT_OK


def test_smoke_test_rate_limited_exhausts_retries(tmp_path, monkeypatch):
    bin_dir = make_fake_bin(
        tmp_path,
        "pi",
        'import sys; print(\'{"code":"concurrency_limit"}\'); sys.exit(1)',
    )
    prepend_path(monkeypatch, bin_dir)
    rc = gnhf.run_smoke_test(
        agent="pi",
        provider=None,
        model=None,
        path=str(tmp_path),
        timeout_s=10,
        max_retries=1,
        base_backoff=0.05,
        max_backoff=0.1,
    )
    assert rc == gnhf.EXIT_RATE_LIMITED


def test_smoke_test_ordinary_failure_is_not_rate_limited(tmp_path, monkeypatch):
    bin_dir = make_fake_bin(
        tmp_path,
        "pi",
        'import sys; print("boom: connection refused"); sys.exit(1)',
    )
    prepend_path(monkeypatch, bin_dir)
    rc = gnhf.run_smoke_test(
        agent="pi",
        provider=None,
        model=None,
        path=str(tmp_path),
        timeout_s=10,
        max_retries=1,
        base_backoff=0.05,
        max_backoff=0.1,
    )
    assert rc == gnhf.EXIT_FAIL


# --- launch mode ---

LAUNCH_TUNING = dict(probe=0.3, base_backoff=0.05, max_backoff=0.1, max_429=3, total_backoff_cap=5)


def test_launch_creates_missing_log_dir(tmp_path, kill_on_teardown, capsys):
    log_path = tmp_path / "nested" / "does" / "not" / "exist" / "run.log"
    script = tmp_path / "sleeper.py"
    script.write_text("import time; time.sleep(5)\n")
    rc = gnhf.run_launch(
        cwd=str(tmp_path),
        log_path=str(log_path),
        ttl=30,
        command=[sys.executable, str(script)],
        **LAUNCH_TUNING,
    )
    assert rc == gnhf.EXIT_OK
    assert log_path.exists()
    pid = extract_launched_pid(capsys.readouterr().out)
    if pid:
        kill_on_teardown.append(pid)


def test_launch_rate_limited_immediately_gives_up_at_ceiling(tmp_path):
    script = tmp_path / "always_429.py"
    script.write_text('import sys; print(\'{"code":"concurrency_limit"}\'); sys.exit(1)\n')
    log_path = tmp_path / "run.log"
    rc = gnhf.run_launch(
        cwd=str(tmp_path),
        log_path=str(log_path),
        ttl=30,
        command=[sys.executable, str(script)],
        **LAUNCH_TUNING,
    )
    assert rc == gnhf.EXIT_RATE_LIMITED
    attempts = log_path.read_text().count("gnhf launch attempt")
    assert attempts == LAUNCH_TUNING["max_429"]


def test_launch_survives_after_two_429s(tmp_path, kill_on_teardown, capsys):
    counter_file = tmp_path / "counter"
    script = tmp_path / "flaky.py"
    script.write_text(
        "import sys, pathlib, time\n"
        f"counter_file = pathlib.Path({str(counter_file)!r})\n"
        "n = int(counter_file.read_text()) if counter_file.exists() else 0\n"
        "n += 1\n"
        "counter_file.write_text(str(n))\n"
        "if n <= 2:\n"
        "    print('{\"code\":\"concurrency_limit\"}')\n"
        "    sys.exit(1)\n"
        "time.sleep(10)\n"
    )
    log_path = tmp_path / "run.log"
    rc = gnhf.run_launch(
        cwd=str(tmp_path),
        log_path=str(log_path),
        ttl=30,
        command=[sys.executable, str(script)],
        **LAUNCH_TUNING,
    )
    assert rc == gnhf.EXIT_OK
    assert "concurrency_limit" in log_path.read_text()
    pid = extract_launched_pid(capsys.readouterr().out)
    if pid:
        kill_on_teardown.append(pid)


def test_launch_early_exit_is_not_rate_limited(tmp_path):
    script = tmp_path / "ordinary_fail.py"
    script.write_text('import sys; print("Traceback: boom"); sys.exit(1)\n')
    log_path = tmp_path / "run.log"
    rc = gnhf.run_launch(
        cwd=str(tmp_path),
        log_path=str(log_path),
        ttl=30,
        command=[sys.executable, str(script)],
        **LAUNCH_TUNING,
    )
    assert rc == gnhf.EXIT_EARLY_EXIT
    attempts = log_path.read_text().count("gnhf launch attempt")
    assert attempts == 1


def test_launch_sleep_past_probe_reports_launched_pid(tmp_path, kill_on_teardown, capsys):
    script = tmp_path / "sleeper.py"
    script.write_text("import time; time.sleep(10)\n")
    log_path = tmp_path / "run.log"
    rc = gnhf.run_launch(
        cwd=str(tmp_path),
        log_path=str(log_path),
        ttl=30,
        command=[sys.executable, str(script)],
        **LAUNCH_TUNING,
    )
    assert rc == gnhf.EXIT_OK
    out = capsys.readouterr().out
    assert "LAUNCHED: pid=" in out
    pid = extract_launched_pid(out)
    if pid:
        kill_on_teardown.append(pid)


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, *sys.argv[1:]]))
