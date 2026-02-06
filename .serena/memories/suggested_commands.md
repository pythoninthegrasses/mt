# Suggested Commands for mt Development

## Running the Application

### Development Mode (with hot-reload)
```bash
task tauri:dev
```

### Development with MCP Bridge (for E2E test authoring)
```bash
task tauri:dev:mcp
```

### Build
```bash
task build                # Current architecture
task build:arm64          # Apple Silicon
task build:x64            # Intel
```

## Development Workflow

### Dependencies
```bash
npm install               # Frontend dependencies
cargo build               # Rust backend dependencies
```

### Code Quality — Frontend
```bash
deno lint                  # Native Deno linter
deno fmt                   # Native Deno formatter
```

### Code Quality — Backend
```bash
cargo check --workspace                # Fast type/syntax check
cargo clippy --workspace               # Rust linting
cargo fmt --all                        # Rust formatting
```

### Testing
```bash
task test                 # All tests (Rust + Vitest)
task npm:test             # Vitest unit tests only (~210 tests)
task test:e2e             # Playwright E2E, fast mode, webkit only (~413 tests)
E2E_MODE=full task test:e2e   # Playwright E2E, all browsers (~1239 tests)
task npm:test:e2e:ui      # Playwright interactive UI mode
```

### Running Specific Tests
**IMPORTANT: Playwright tests must be run from `app/frontend/` directory**
```bash
cargo nextest run --workspace                                              # Rust backend (preferred)
cargo test --workspace                                                     # Rust backend (fallback)
npm --prefix app/frontend test                                             # Vitest unit
cd app/frontend && npx playwright test tests/library.spec.js               # Single E2E file
cd app/frontend && npx playwright test --headed                            # Headed browser
cd app/frontend && npx playwright test --debug tests/sidebar.spec.js       # Debug mode
```

### Pre-commit
```bash
pre-commit run --all-files
```

## Task Runner Commands (Taskfile)
```bash
task lint                 # Rust + JS linters
task format               # Rust + JS formatters
task test                 # Rust + JS tests
task test:e2e             # Playwright E2E tests
task pre-commit           # Pre-commit hooks
task tauri:dev            # Development mode
task tauri:clean          # Clean Tauri build artifacts
task tauri:info           # Show Tauri build configuration
task build:timings        # Analyze build performance bottlenecks
```

## Initial Setup
```bash
mise install              # Install runtimes
cp .env.example .env      # Environment config (Last.fm keys optional)
npm install               # Install dependencies
```