#!/usr/bin/env bash
# The Windows release build and bundling steps, as `task ci:build` and
# `task ci:bundle` perform them for TARGET=x86_64-pc-windows-msvc: cargo-tauri
# with tauri.conf.json's beforeBuildCommand suppressed, because the frontend
# bundle and the Zig sidecar are prepared once by the caller.
#
# These live in a file so profile-bench.yml can hand the build to hyperfine, and
# the bundle to the size-recording step, without quoting the --config JSON twice.
#
# The profile knobs under test (CARGO_PROFILE_RELEASE_LTO and
# CARGO_PROFILE_RELEASE_CODEGEN_UNITS) come from the environment, set per
# candidate by the workflow's matrix.
set -euo pipefail

TRIPLE="${TRIPLE_WINDOWS:-x86_64-pc-windows-msvc}"
CONFIG='{"build":{"beforeBuildCommand":""}}'

case "${1:-build}" in
  build)
    exec cargo tauri build --no-bundle --target "$TRIPLE" --config "$CONFIG"
    ;;
  bundle)
    exec cargo tauri bundle --target "$TRIPLE" --bundles nsis --config "$CONFIG"
    ;;
  *)
    echo "usage: $0 [build|bundle]" >&2
    exit 2
    ;;
esac
