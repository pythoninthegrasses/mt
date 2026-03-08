# Development Guide

Commands, tooling, and workflows for developing the MT music player.

## Initial Setup

```bash
# Install runtimes
mise install

# Copy environment configuration (Last.fm API keys are optional)
cp .env.example .env

# Install dependencies
task deno:install
```

## Worktree Setup (Agent Orchestrators)

When using agent orchestrators like [Conductor](https://conductor.build) or
[Superset](https://superset.sh), each agent works in an isolated git worktree.
Git-untracked files (`.env`, `node_modules/`) are not copied into new worktrees
and must be restored via a setup script.

### Standard git worktree

```bash
# Create a worktree on a new branch
git worktree add ../mt-feature -b feature-branch

# Enter the worktree
cd ../mt-feature

# Symlink .env from the parent repo (single source of truth)
ln -sf /path/to/mt/.env .env

# Install dependencies
task deno:install
```

### Conductor

Conductor exposes `$CONDUCTOR_ROOT_PATH` pointing to the parent repo.
Add a `conductor.json` at the repo root:

```json
{
  "scripts": {
    "setup": "ln -sf \"$CONDUCTOR_ROOT_PATH/.env\" .env && deno install --node-modules-dir=auto --frozen",
    "run": "deno run -A npm:@tauri-apps/cli dev",
    "archive": ""
  }
}
```

Or for more control, create `bin/conductor-setup`:

```bash
#!/bin/sh
set -e
cd "$(dirname "$0")"/..

if [ -z "$CONDUCTOR_ROOT_PATH" ]; then
  echo "Not running in Conductor, skipping workspace setup."
  exit 0
fi

# Symlink .env from parent repo
if [ -f "$CONDUCTOR_ROOT_PATH/.env" ]; then
  ln -sf "$CONDUCTOR_ROOT_PATH/.env" .env
else
  echo "Warning: $CONDUCTOR_ROOT_PATH/.env not found."
  echo "Create it from .env.example: cp .env.example $CONDUCTOR_ROOT_PATH/.env"
fi

# Install frontend dependencies
deno install --node-modules-dir=auto --frozen
```

### Superset

Superset exposes `$SUPERSET_ROOT_PATH` pointing to the parent repo.
It creates a `config.json` at the repo root:

```json
{
  "setup": [
    "ln -sf \"$SUPERSET_ROOT_PATH/.env\" .env && deno install --node-modules-dir=auto --frozen"
  ],
  "teardown": []
}
```

## Running the Application

```bash
# Development mode with hot-reload
task tauri:dev

# Build the application
task build
```

## Task Runner Commands

The project uses [Taskfile](https://taskfile.dev/) for orchestrating workflows.

### Main Commands

```bash
# Development
task lint                     # Run Rust and JS linters
task format                   # Run Rust and JS formatters
task test                     # Run Rust and JS tests
task test:e2e                 # Run Playwright E2E tests
task pre-commit               # Run pre-commit hooks

# Building
task build                    # Build Tauri app for current arch
task build:arm64              # Build for Apple Silicon (arm64)
task build:x64                # Build for Intel (x86_64)
task build:timings            # Analyze build performance bottlenecks (opens HTML report)

# Utilities
task install                  # Install project dependencies via devbox
```

### Tauri Commands (`tauri:`)

```bash
task tauri:dev                # Run Tauri in development mode
task tauri:dev:mcp            # Run Tauri dev with MCP bridge for AI agent debugging
task tauri:build              # Build Tauri app for current architecture
task tauri:build:arm64        # Build Tauri app for Apple Silicon
task tauri:build:x64          # Build Tauri app for Intel
task tauri:info               # Show Tauri build configuration
task tauri:doctor             # Check Tauri environment
task tauri:clean              # Clean Tauri build artifacts
```

### Deno Commands (`deno:`)

```bash
task deno:install             # Install dependencies via Deno (8x faster than npm ci)
task deno:lint                # Run Deno linter
task deno:format              # Format JS/TS code
task deno:test                # Run Vitest unit/property tests
task deno:test:e2e            # Run Playwright E2E tests
task deno:dev                 # Run Vite dev server via Deno
task deno:build               # Build frontend via Deno (2.2x faster than npm)
task deno:clean               # Clean deno artifacts
```

### Build Pipeline

When running `task build`, the following happens automatically:

1. `deno:install` - Install frontend dependencies
2. `cargo:install-sccache` - Ensure sccache is available for build caching
3. `tauri:build` - Build Rust backend and bundle with frontend

## Raw Commands (Without Task Runner)

```bash
# Install dependencies
deno install --node-modules-dir=auto --frozen  # Frontend (8x faster than npm ci)
cargo build                                    # Rust backend

# Fast syntax/type checking (no binary output, 2-3x faster than build)
cargo check --manifest-path crates/mt-tauri/Cargo.toml
cargo check --all-features

# Linting
deno lint                             # Frontend (Deno linter)
cargo clippy --workspace              # Rust

# Formatting
deno fmt                              # Frontend (Deno formatter)
deno fmt --check                      # Check without changes
cargo fmt --all                       # Rust

# Tests
cargo nextest run --workspace                   # Rust (falls back to cargo test)
cd app/frontend && npx vitest run               # Vitest unit/property tests
cd app/frontend && npx playwright test          # Playwright E2E

# Pre-commit hooks
pre-commit run --all-files

# Clean build artifacts
cargo clean
rm -rf node_modules dist
```

## Hot Reload

- Vite provides instant HMR for frontend changes
- Tauri dev mode auto-rebuilds Rust backend on changes
- Frontend changes reflect immediately without full app restart
- Backend changes trigger incremental rebuild and app restart

## Browser Development Mode

**Audio playback only works in Tauri.** When running the frontend in a standalone browser:

- `window.__TAURI__` is undefined
- Audio playback commands silently fail
- Use browser mode **only for UI/styling work**, not playback testing
- For playback testing, always use `task tauri:dev`

## Dependencies

### Frontend

| Package | Purpose |
|---------|---------|
| Tauri | Desktop application framework |
| Deno | Package manager and runtime |
| basecoat | Design system (Tailwind CSS) |
| Alpine.js | Lightweight reactive framework |
| Tailwind CSS | Utility-first CSS |
| Vitest | Unit and property testing |
| fast-check | Property-based testing |
| Playwright | E2E testing |
| Vite | Build tool and dev server |

### Backend

| Crate | Purpose |
|-------|---------|
| tauri | Native system integration |
| rodio/symphonia | Audio playback |
| souvlaki | Media key integration |
| lofty | Audio metadata parsing |
| rusqlite | SQLite database |
| r2d2 | Database connection pooling |
| serde | Serialization |
| tokio | Async runtime |
| rayon | Parallel iteration |
| tracing | Structured logging |

### Adding Dependencies

```bash
# Frontend
npm install package-name
npm install --save-dev package-name

# Backend
cargo add crate-name
cargo add --dev crate-name
```

## Logging

### Frontend

```javascript
console.log('[Action]', 'play_track', { trackId, trackName });
console.error('[Error]', 'Failed to load track', { error, trackId });
console.debug('[IPC]', 'invoke', { command: 'play_track', args });
```

### Backend (Rust)

```rust
use log::{info, warn, error, debug};

#[tauri::command]
fn play_track(track_id: String) -> Result<(), String> {
    info!("Playing track: {}", track_id);
    Ok(())
}
```

Log levels: trace, debug, info, warn, error. Visible in terminal during `cargo tauri dev`.

## Development Tools

- **rust-analyzer**: LSP for IDE integration
- **cargo-watch**: Auto-rebuild on changes: `cargo watch -x build`
- **clippy**: Rust linter: `cargo clippy`
- **rustfmt**: Rust formatter: `cargo fmt`
- **cargo-expand**: View macro expansions: `cargo expand`

## Video Demo

Convert screen recording to AVIF for README:

```bash
ffmpeg -i input.mp4 -c:v libsvtav1 -vf scale=-1:720 -crf 30 demo.avif
```

### Frame Extraction for Debugging

```bash
# PNG frames at source resolution
ffmpeg -i video.mp4 -vf "fps=15" /tmp/frames/frame_%03d.png

# Downscaled to 720p
ffmpeg -i video.mp4 -vf "fps=15,scale=-1:720" /tmp/frames/frame_%03d.png

# Specific time range (2s to 5s)
ffmpeg -i video.mp4 -ss 2 -to 5 -vf "fps=15" /tmp/frames/frame_%03d.png

# JPEG for smaller files
ffmpeg -i video.mp4 -vf "fps=15" -qscale:v 2 /tmp/frames/frame_%03d.jpg
```
