#!/usr/bin/env arch -arm64 /opt/homebrew/bin/bash

# shellcheck disable=SC2096

cat <<'EOF'
Conductor workspace automation for mt.

USAGE:
	conductor.sh <setup|run|archive>

DOCS:
	https://docs.conductor.build/core/scripts
EOF

set -euo pipefail

BREW_PREFIX="/opt/homebrew"
MISE_DATA_DIR="${HOME}/.local/share/mise"
export PATH="${MISE_DATA_DIR}/shims:${HOME}/.cargo/bin:${HOME}/.local/bin:${BREW_PREFIX}/bin:${BREW_PREFIX}/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

case "${1:-}" in
  setup)
    ln -sf "$CONDUCTOR_ROOT_PATH/.env" .env
    task deno:clean
    task tauri:build:signed
    ;;
  run)
    task tauri:dev:mcp
    ;;
  archive)
    task deno:clean
    task tauri:clean
    ;;
  *)
    echo -e "USAGE:\n\tconductor.sh <setup|run|archive>" >&2
    exit 1
    ;;
esac
