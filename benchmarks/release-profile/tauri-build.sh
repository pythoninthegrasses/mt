#!/usr/bin/env bash
# The cargo-tauri invocation each platform's release leg runs, kept in one file so
# every column of the TASK-369.4 matrix times exactly the same command and nobody
# has to re-quote the --config JSON through two shells to pass it to hyperfine.
#
#   macOS    taskfiles/ci.yml's ci:build  -> cargo tauri build --no-bundle --target <triple>
#   Linux    docker/linux/Dockerfile's build stage -> the same
#   Windows  taskfiles/ci.yml's ci:build  -> the same
#
# tauri.conf.json's beforeBuildCommand is suppressed because the frontend bundle and
# the Zig sidecar are prepared once by the caller: they are identical for every
# candidate, and only the Rust build is under test.
#
# Usage: TRIPLE=<rust target triple> tauri-build.sh [build | bundle <bundles>]
#
# The profile knobs under test (CARGO_PROFILE_RELEASE_LTO and
# CARGO_PROFILE_RELEASE_CODEGEN_UNITS) come from the environment, set per candidate
# by each column's driver.
set -euo pipefail

TRIPLE="${TRIPLE:?set TRIPLE to the Rust target triple, e.g. x86_64-unknown-linux-gnu}"
# The npm-installed CLI on a host that has no cargo-tauri binary; CI has it in
# CARGO_HOME/bin, so the default is what the release legs use.
TAURI_CLI="${TAURI_CLI:-cargo tauri}"
CONFIG='{"build":{"beforeBuildCommand":""}}'

case "${1:-build}" in
  build)
    # shellcheck disable=SC2086  # TAURI_CLI is a command prefix, deliberately split
    exec $TAURI_CLI build --no-bundle --target "$TRIPLE" --config "$CONFIG"
    ;;
  bundle)
    [ $# -ge 2 ] || { echo "usage: $0 bundle <bundles, e.g. deb|nsis|dmg>" >&2; exit 2; }
    # shellcheck disable=SC2086  # TAURI_CLI is a command prefix, deliberately split
    exec $TAURI_CLI bundle --target "$TRIPLE" --bundles "$2" --config "$CONFIG"
    ;;
  *)
    echo "usage: $0 [build | bundle <bundles>]" >&2
    exit 2
    ;;
esac
