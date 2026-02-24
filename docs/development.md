# Development Guide

Commands, tooling, and workflows for developing the MT music player.

## Initial Setup

```bash
# Install runtimes
mise install

# Copy environment configuration (Last.fm API keys are optional)
cp .env.example .env

# Install dependencies
npm install
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
task tauri:build              # Build Tauri app for current architecture
task tauri:build:arm64        # Build Tauri app for Apple Silicon
task tauri:build:x64          # Build Tauri app for Intel
task tauri:info               # Show Tauri build configuration
task tauri:clean              # Clean Tauri build artifacts
```

### NPM Commands (`npm:`)

```bash
task npm:install              # Install npm dependencies
task npm:clean                # Clean npm cache and node_modules
```

### Build Pipeline

When running `task build`, the following happens automatically:

1. `npm:install` - Install frontend dependencies
2. `tauri:build` - Build Rust backend and bundle with frontend

## Raw Commands (Without Task Runner)

```bash
# Install dependencies
deno install --node-modules-dir=auto --frozen  # Frontend (8x faster than npm ci)
cargo build                                    # Rust backend

# Fast syntax/type checking (no binary output, 2-3x faster than build)
cargo check --manifest-path src-tauri/Cargo.toml
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
| basecoat | Design system (Tailwind CSS) |
| Alpine.js | Lightweight reactive framework |
| Tailwind CSS | Utility-first CSS |
| Playwright | E2E testing |
| Vite | Build tool and dev server |

### Backend

| Crate | Purpose |
|-------|---------|
| tauri | Native system integration |
| rodio/symphonia | Audio playback |
| rusqlite | SQLite database |
| serde | Serialization |
| tokio | Async runtime |

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
