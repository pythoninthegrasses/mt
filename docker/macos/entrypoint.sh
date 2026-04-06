#!/usr/bin/env bash

set -euo pipefail

export HOME="${HOME:-/Users/Shared}"

# PATH setup -- mirrors .github/actions/setup-tauri-build/action.yml
export PATH="$HOME/.cargo/bin:$HOME/.local/share/mise/shims:/opt/homebrew/bin:/opt/homebrew/sbin:$PATH"

# Enable sccache for Rust builds (CI taskfile disables it; override here)
export RUSTC_WRAPPER=sccache

# Required environment variables
: "${GITHUB_REPO_URL:?GITHUB_REPO_URL is required}"
: "${RUNNER_TOKEN:?RUNNER_TOKEN is required}"

RUNNER_NAME="${RUNNER_NAME:-mt-macos-container}"
RUNNER_LABELS="${RUNNER_LABELS:-macOS,ARM64}"
RUNNER_WORKDIR="${RUNNER_WORKDIR:-_work}"

cleanup() {
    echo "Caught signal, removing runner..."
    ./config.sh remove --token "${RUNNER_TOKEN}" 2>/dev/null || true
    exit 0
}
trap cleanup SIGTERM SIGINT

echo "Configuring runner '${RUNNER_NAME}' with labels '${RUNNER_LABELS}'..."
./config.sh \
    --url "${GITHUB_REPO_URL}" \
    --token "${RUNNER_TOKEN}" \
    --name "${RUNNER_NAME}" \
    --labels "${RUNNER_LABELS}" \
    --work "${RUNNER_WORKDIR}" \
    --ephemeral \
    --unattended \
    --replace

echo "Starting runner..."
./run.sh &
wait $!
