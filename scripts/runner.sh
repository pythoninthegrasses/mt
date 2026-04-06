#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
BUILD_CTX="${REPO_ROOT}/docker/macos"

IMAGE_NAME="${IMAGE_NAME:-mt-runner}"
IMAGE_TAG="${IMAGE_TAG:-latest}"
RUNNER_NAME="${RUNNER_NAME:-mt-macos-container}"
RUNNER_LABELS="${RUNNER_LABELS:-macOS,ARM64}"
GITHUB_REPO_URL="${GITHUB_REPO_URL:-}"
CACHE_DIR="${HOME}/.cache/mt-runner"

# Tool versions (keep in sync with .tool-versions)
NODE_VERSION="${NODE_VERSION:-24.2.0}"
DENO_VERSION="${DENO_VERSION:-2.5.1}"
TASK_VERSION="${TASK_VERSION:-3.49.1}"
RUST_TOOLCHAIN="${RUST_TOOLCHAIN:-nightly-2026-02-09}"
RUNNER_VERSION="${RUNNER_VERSION:-2.333.1}"

die() { echo "error: $*" >&2; exit 1; }

# Download a URL to a file, skipping if the file already exists
fetch() {
    local url="$1" dest="$2"
    if [ -f "${dest}" ]; then
        echo "  exists: $(basename "${dest}")"
        return
    fi
    echo "  fetching: $(basename "${dest}")"
    curl -fsSL "${url}" -o "${dest}"
}

cmd_prepare() {
    echo "Preparing build context in ${BUILD_CTX}..."
    mkdir -p "${BUILD_CTX}"

    # Xcode Command Line Tools -- package the installed directory
    if [ ! -f "${BUILD_CTX}/CLTools.pkg" ]; then
        [ -d /Library/Developer/CommandLineTools ] \
            || die "Xcode Command Line Tools not installed on host. Run: xcode-select --install"
        echo "  packaging CLT from /Library/Developer/CommandLineTools..."
        tar cf "${BUILD_CTX}/CLTools.pkg" -C / Library/Developer/CommandLineTools
    else
        echo "  exists: CLTools.pkg"
    fi

    # Homebrew -- package only core infrastructure + required formulae
    # Full /opt/homebrew is 80GB+; we only need specific packages
    local brew_pkgs=(git-lfs jq gh sccache cmake pkg-config)
    if [ ! -f "${BUILD_CTX}/homebrew.tar" ]; then
        echo "  packaging homebrew (core + ${brew_pkgs[*]})..."
        [ -d /opt/homebrew ] || die "Homebrew not found at /opt/homebrew"
        local brew_dirs=(
            bin sbin etc lib include share/man
            Homebrew Frameworks Library
        )
        # Add Cellar entries for required formulae and their dependencies
        for pkg in "${brew_pkgs[@]}"; do
            local cellar_dir="/opt/homebrew/Cellar/${pkg}"
            if [ -d "${cellar_dir}" ]; then
                brew_dirs+=("Cellar/${pkg}")
            fi
        done
        # Also include dependencies of those formulae
        for pkg in "${brew_pkgs[@]}"; do
            for dep in $(brew deps --installed "${pkg}" 2>/dev/null); do
                if [ -d "/opt/homebrew/Cellar/${dep}" ]; then
                    brew_dirs+=("Cellar/${dep}")
                fi
            done
        done
        # Deduplicate
        local unique_dirs
        unique_dirs="$(printf '%s\n' "${brew_dirs[@]}" | sort -u)"
        # Build tar with only existing directories
        local tar_args=()
        while IFS= read -r d; do
            [ -e "/opt/homebrew/${d}" ] && tar_args+=("${d}")
        done <<< "${unique_dirs}"
        tar cf "${BUILD_CTX}/homebrew.tar" -C /opt/homebrew "${tar_args[@]}"
    else
        echo "  exists: homebrew.tar"
    fi

    # mise binary
    if [ ! -f "${BUILD_CTX}/mise.tar" ]; then
        local mise_bin
        mise_bin="$(which mise 2>/dev/null)" || die "mise not found on host"
        echo "  packaging mise binary..."
        tar cf "${BUILD_CTX}/mise.tar" -C "$(dirname "${mise_bin}")" mise
    else
        echo "  exists: mise.tar"
    fi

    # Node.js
    local node_dir
    node_dir="${HOME}/.local/share/mise/installs/node/${NODE_VERSION}"
    if [ ! -f "${BUILD_CTX}/node.tar" ]; then
        [ -d "${node_dir}" ] || die "Node.js ${NODE_VERSION} not installed via mise"
        echo "  packaging node ${NODE_VERSION}..."
        tar cf "${BUILD_CTX}/node.tar" -C "${node_dir}" .
    else
        echo "  exists: node.tar"
    fi

    # Deno
    local deno_dir
    deno_dir="${HOME}/.local/share/mise/installs/deno/${DENO_VERSION}"
    if [ ! -f "${BUILD_CTX}/deno.tar" ]; then
        [ -d "${deno_dir}" ] || die "Deno ${DENO_VERSION} not installed via mise"
        echo "  packaging deno ${DENO_VERSION}..."
        tar cf "${BUILD_CTX}/deno.tar" -C "${deno_dir}/bin" .
    else
        echo "  exists: deno.tar"
    fi

    # Task (binary lives directly in the version dir, no bin/ subdirectory)
    local task_dir
    task_dir="${HOME}/.local/share/mise/installs/task/${TASK_VERSION}"
    if [ ! -f "${BUILD_CTX}/task.tar" ]; then
        [ -d "${task_dir}" ] || die "Task ${TASK_VERSION} not installed via mise"
        echo "  packaging task ${TASK_VERSION}..."
        tar cf "${BUILD_CTX}/task.tar" -C "${task_dir}" task
    else
        echo "  exists: task.tar"
    fi

    # Rust toolchain -- only the pinned nightly + rustup metadata (no registry cache)
    if [ ! -f "${BUILD_CTX}/rust.tar" ]; then
        local toolchain_dir="${HOME}/.rustup/toolchains/${RUST_TOOLCHAIN}-aarch64-apple-darwin"
        [ -d "${toolchain_dir}" ] || die "Rust toolchain ${RUST_TOOLCHAIN} not found in ~/.rustup/toolchains/"
        echo "  packaging rust ${RUST_TOOLCHAIN} (excluding registry cache)..."
        tar cf "${BUILD_CTX}/rust.tar" \
            -C "${HOME}" \
            .rustup/settings.toml \
            .rustup/toolchains/${RUST_TOOLCHAIN}-aarch64-apple-darwin \
            .cargo/bin \
            .cargo/env
    else
        echo "  exists: rust.tar"
    fi

    # Cargo tools (tauri-cli, cargo-binstall binaries only)
    if [ ! -f "${BUILD_CTX}/cargo-tools.tar" ]; then
        echo "  packaging cargo tool binaries..."
        local cargo_bin="${HOME}/.cargo/bin"
        local tools=()
        for tool in cargo-tauri cargo-binstall; do
            [ -f "${cargo_bin}/${tool}" ] || die "${tool} not found in ${cargo_bin}"
            tools+=("${tool}")
        done
        tar cf "${BUILD_CTX}/cargo-tools.tar" -C "${cargo_bin}" "${tools[@]}"
    else
        echo "  exists: cargo-tools.tar"
    fi

    # GitHub Actions runner
    fetch \
        "https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-osx-arm64-${RUNNER_VERSION}.tar.gz" \
        "${BUILD_CTX}/actions-runner.tar.gz"

    echo ""
    echo "Build context ready. Files:"
    ls -lhS "${BUILD_CTX}"/*.tar* "${BUILD_CTX}"/*.pkg 2>/dev/null || true
}

cmd_build() {
    command -v container >/dev/null 2>&1 \
        || die "container binary not found. Install from https://github.com/jianliang00/container/releases"

    # Verify build context is prepared
    for f in CLTools.pkg homebrew.tar mise.tar node.tar deno.tar task.tar rust.tar cargo-tools.tar actions-runner.tar.gz; do
        [ -f "${BUILD_CTX}/${f}" ] || die "Missing ${f} in build context. Run: runner.sh prepare"
    done

    echo "Building ${IMAGE_NAME}:${IMAGE_TAG}..."
    container build \
        --platform darwin/arm64 \
        --progress plain \
        -f "${BUILD_CTX}/Dockerfile" \
        -t "${IMAGE_NAME}:${IMAGE_TAG}" \
        "${BUILD_CTX}"
}

cmd_start() {
    while [ $# -gt 0 ]; do
        case "$1" in
            --name)   RUNNER_NAME="$2"; shift 2 ;;
            --labels) RUNNER_LABELS="$2"; shift 2 ;;
            --repo)   GITHUB_REPO_URL="$2"; shift 2 ;;
            *) die "Unknown flag: $1" ;;
        esac
    done

    [ -n "${GITHUB_REPO_URL}" ] || die "GITHUB_REPO_URL required. Set env or pass --repo URL"
    command -v gh >/dev/null 2>&1 || die "gh CLI required for token generation"

    local owner_repo
    owner_repo="$(echo "${GITHUB_REPO_URL}" | sed 's|https://github.com/||')"

    mkdir -p "${CACHE_DIR}/cargo-registry" \
             "${CACHE_DIR}/cargo-git" \
             "${CACHE_DIR}/sccache" \
             "${CACHE_DIR}/npm"

    echo "Starting runner '${RUNNER_NAME}' for ${owner_repo}..."

    while true; do
        echo "Fetching registration token..."
        local token
        token="$(gh api "repos/${owner_repo}/actions/runners/registration-token" --method POST --jq '.token')"

        echo "Launching container..."
        container run \
            --name "${RUNNER_NAME}" \
            -e "GITHUB_REPO_URL=${GITHUB_REPO_URL}" \
            -e "RUNNER_TOKEN=${token}" \
            -e "RUNNER_NAME=${RUNNER_NAME}" \
            -e "RUNNER_LABELS=${RUNNER_LABELS}" \
            -v "${CACHE_DIR}/cargo-registry:/Users/Shared/.cargo/registry" \
            -v "${CACHE_DIR}/cargo-git:/Users/Shared/.cargo/git" \
            -v "${CACHE_DIR}/sccache:/Users/Shared/Library/Caches/Mozilla.sccache" \
            -v "${CACHE_DIR}/npm:/Users/Shared/.npm" \
            --rm \
            "${IMAGE_NAME}:${IMAGE_TAG}" || true

        echo "Runner exited (ephemeral mode). Restarting in 5s..."
        sleep 5
    done
}

cmd_stop() {
    while [ $# -gt 0 ]; do
        case "$1" in
            --name) RUNNER_NAME="$2"; shift 2 ;;
            *) die "Unknown flag: $1" ;;
        esac
    done

    echo "Stopping runner '${RUNNER_NAME}'..."
    container stop "${RUNNER_NAME}" 2>/dev/null || true
}

cmd_status() {
    container ps 2>/dev/null || echo "No running containers"
}

cmd_clean() {
    echo "Removing build context artifacts from ${BUILD_CTX}..."
    rm -f "${BUILD_CTX}"/*.tar "${BUILD_CTX}"/*.tar.gz "${BUILD_CTX}"/*.pkg
    echo "Done."
}

cmd_help() {
    cat <<EOF
Usage: runner.sh <command> [options]

Commands:
  prepare                      Download/package dependencies into build context
  build                        Build the macOS runner container image
  start [options]              Start a runner container (loops for ephemeral mode)
  stop  [options]              Stop a running runner container
  status                       List running runner containers
  clean                        Remove build context artifacts (tarballs)
  help                         Show this help

Start options:
  --name NAME                  Runner name (default: mt-macos-container)
  --labels LABELS              Runner labels (default: macOS,ARM64)
  --repo URL                   GitHub repository URL (or set GITHUB_REPO_URL)

Environment variables:
  IMAGE_NAME                   Container image name (default: mt-runner)
  IMAGE_TAG                    Container image tag (default: latest)
  GITHUB_REPO_URL              GitHub repository URL
  RUNNER_NAME                  Runner name (overridden by --name)
  RUNNER_LABELS                Runner labels (overridden by --labels)
  CACHE_DIR                    Cache directory (default: ~/.cache/mt-runner)
  NODE_VERSION                 Node.js version (default: 24.2.0)
  DENO_VERSION                 Deno version (default: 2.5.1)
  TASK_VERSION                 Task version (default: 3.49.1)
  RUST_TOOLCHAIN               Rust toolchain (default: nightly-2026-02-09)
  RUNNER_VERSION               GitHub Actions runner version (default: 2.333.1)
EOF
}

case "${1:-help}" in
    prepare) shift; cmd_prepare "$@" ;;
    build)   shift; cmd_build "$@" ;;
    start)   shift; cmd_start "$@" ;;
    stop)    shift; cmd_stop "$@" ;;
    status)  shift; cmd_status "$@" ;;
    clean)   shift; cmd_clean "$@" ;;
    help)    cmd_help ;;
    *)       die "Unknown command: $1. Run 'runner.sh help' for usage." ;;
esac
