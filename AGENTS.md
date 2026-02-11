# AGENTS.md

This file provides guidance to LLMs when working with code in this repository.

## Project Overview

mt is a desktop music player designed for large music collections, built with Tauri (Rust backend), basecoat (with Tailwind CSS), and Alpine.js. The backend uses Rust for audio playback and system integration, while the frontend is a modern web-based UI with reactive components.

## General Guidelines

- ALWAYS use atomic commits throughout development
  - Each commit should represent a single, complete, and coherent unit of work
  - "Don't mix your apples with your toaster" - keep changes distinct and focused
  - Commit frequently after completing subtasks or reaching meaningful progress points
  - Write clear commit messages explaining both what changed and why
  - Use `git add -i` (interactive mode) or `git add -p` (patch mode) to stage specific changes
  - Break files with multiple changes into smaller hunks using patch mode's split feature
  - Verify each commit is not broken - ensure all necessary files/chunks are included
  - After user confirms changes are ready to push, offer to squash related atomic commits using `git rebase -i`
- NEVER create *.backup files. This is a version controlled repo

## Context7

Always use Context7 MCP when I need library/API documentation, code generation, setup or configuration steps without me having to explicitly ask.

### AlpineJS + Basecoat + Tauri Libraries

- alpinejs/alpine
- dubzzz/fast-check
- hunvreus/basecoat
- jdx/mise
- microsoft/playwright
- mrlesk/backlog.md
- nextest-rs/nextest
- serial-ata/lofty-rs
- sharkdp/hyperfine
- tailwindlabs/tailwindcss
- websites/deno
- websites/last_fm_api
- websites/rs_tauri_2_9_5
- websites/taskfile_dev

## Atomic Commit Workflow

### Why Atomic Commits

Atomic commits make code reviews easier, improve history browsing, and simplify reverting changes. Each commit should contain a single, complete, and coherent unit of work that stands independently.

### Benefits

- **Debugging**: Use `git bisect` to rapidly identify problems
- **Code History**: Create organized, understandable histories with clear stories
- **Collaboration**: Streamline code reviews by focusing on single changes
- **Safe Operations**: Revert or cherry-pick individual changes without side effects

### Creating Atomic Commits

**Keep changes small and simple** - The more complex your changes, the harder it is to break them into atomic commits without mistakes.

**Use Interactive Staging** - Stage specific files and parts of files:

```bash
# Interactive mode - select which files/hunks to stage
git add -i

# Patch mode - directly choose hunks to stage
git add -p <file>

# Other patch commands
git reset --patch        # Unstage specific hunks
git checkout --patch     # Discard specific hunks
git stash save --patch   # Stash specific hunks
```

**Interactive Mode Commands** (`git add -i`):

- `s` or `1`: View status (staged vs unstaged changes)
- `u` or `2`: Stage files (equivalent to `git add <file>`)
- `r` or `3`: Unstage files (equivalent to `git rm --cached <file>`)
- `a` or `4`: Add untracked files
- `p` or `5`: Patch mode - select parts of files (hunks) to stage
- `d` or `6`: View diff of staged files

**Patch Mode Commands** (after selecting `p` or using `git add -p`):

- `y`: Stage this hunk
- `n`: Don't stage this hunk
- `s`: Split the hunk into smaller hunks ⭐ (most useful!)
- `e`: Manually edit the hunk
- `q`: Quit without staging remaining hunks
- `a`: Stage this hunk and all later hunks in the file
- `d`: Don't stage this or any later hunks
- `g`: Jump to a specific hunk
- `/`: Search for hunks matching regex
- `?`: Show help

### Workflow Example

1. **Check what changed**: `git status` and `git diff`
2. **Start interactive mode**: `git add -i`
3. **Stage related files**: Use `u` to stage complete files that belong together
4. **Handle mixed changes**: Use `p` to enter patch mode for files with multiple unrelated changes
5. **Split hunks**: Use `s` to break large hunks into smaller pieces
6. **Stage relevant hunks**: Use `y` to stage only the hunks for this commit
7. **Review staged changes**: Use `d` to review what will be committed
8. **Commit**: Exit with `q` and run `git commit -m "descriptive message"`
9. **Repeat**: Continue staging and committing remaining changes

### Before Pushing

After completing development with multiple atomic commits:

1. Review your commit history: `git log --oneline`
2. Review what changed: `git status` and `git diff`
3. When user confirms readiness to push, ask: "Would you like me to squash these related atomic commits into a single commit using `git rebase -i`?"
4. If yes, use `git rebase -i HEAD~N` (where N = number of commits to review)

### Important Warnings

⚠️ **Verify each commit is not broken** - Ensure all necessary files and code chunks are included before committing. A broken commit defeats the purpose of atomic commits.

⚠️ **Don't mix unrelated changes** - "Don't mix your apples with your toaster." Each commit should be focused on one logical change.

## Common Development Commands

### Running the Application

```bash
# Development mode with hot-reload
task tauri:dev

# Build the application
task build
```

### Running Tests (Task Commands)

| Layer | Task Command | Tests | Duration |
|-------|--------------|-------|----------|
| **All Tests** | `task test` | Rust + Vitest | ~30s |
| **Rust Backend** | `task test` | 320 tests | ~15s |
| **Vitest Unit** | `task npm:test` | 210 tests | ~2s |
| **Playwright E2E** | `task test:e2e` | 413 tests | ~1m |

```bash
# Run all tests (Rust + Vitest unit tests)
task test

# Run only Vitest unit/property tests
task npm:test

# Run Vitest in watch mode (development)
task npm:test:watch

# Run Playwright E2E tests (fast mode - webkit only)
task test:e2e

# Run E2E with all browsers
E2E_MODE=full task test:e2e

# Run E2E in interactive UI mode
task npm:test:e2e:ui
```

### Initial setup

```bash
# Install runtimes
mise install

# Copy environment configuration (Last.fm API keys are optional)
cp .env.example .env

# Install dependencies
npm install
```

### Development Workflow

#### Task runner abstraction

```bash
# Start development server
task tauri:dev
```

#### Raw commands (without task runner)

```bash
# Install dependencies
npm install                           # Frontend dependencies
cargo build                           # Rust backend dependencies

# Fast syntax/type checking (no binary output, 2-3x faster than build)
cargo check --manifest-path src-tauri/Cargo.toml  # Quick validation during development
cargo check --all-features            # Check with all feature combinations

# Run linting
npm run lint                          # Frontend linting (ESLint)
cargo clippy                          # Rust linting

# Run formatting
npm run format                        # Frontend formatting (Prettier)
cargo fmt                             # Rust formatting

# Run tests directly
cargo test --manifest-path src-tauri/Cargo.toml  # Rust backend (320 tests)
npm --prefix app/frontend test                    # Vitest unit (210 tests)
npm --prefix app/frontend run test:e2e            # Playwright E2E (413 tests)

# Run pre-commit hooks
pre-commit run --all-files

# Clean build artifacts
cargo clean
rm -rf node_modules dist
```

### Playwright E2E Testing

The application uses Playwright for end-to-end testing of the Tauri application. All integration and E2E tests should be written using Playwright.

**E2E_MODE Environment Variable:**

Tests are controlled by the `E2E_MODE` env var to optimize for different scenarios:

| Mode | Browsers | @tauri tests | Tests | Duration |
|------|----------|--------------|-------|----------|
| `fast` (default) | WebKit only | Skipped | ~413 | ~1m |
| `full` | All 3 | Skipped | ~1239 | ~3m |
| `tauri` | All 3 | Included | ~1300+ | ~4m |

Tests tagged with `@tauri` in their describe block require the Tauri runtime (audio playback, queue behavior, etc.) and will fail in browser-only mode.

**Running Playwright Tests:**

```bash
# Fast mode (default): WebKit only, skip @tauri tests
task npm:test:e2e

# Full mode: All browsers, skip @tauri tests
E2E_MODE=full task npm:test:e2e

# Tauri mode: All browsers, include @tauri tests
E2E_MODE=tauri task npm:test:e2e

# Run E2E tests in UI mode (interactive debugging)
task npm:test:e2e:ui

# Run specific test file
npx playwright test tests/library.spec.js

# Run tests in headed mode (see browser)
npx playwright test --headed

# Debug a specific test
npx playwright test --debug tests/sidebar.spec.js

# Generate test code with Playwright codegen
npx playwright codegen
```

**Browser Installation:**

Playwright requires browser binaries that match the installed Playwright version. If tests fail with errors like:
```
Error: browserType.launch: Executable doesn't exist at .../webkit-XXXX/pw_run.sh
```

Run the following to install/update browsers:
```bash
# Install all browsers
npx playwright install

# Install specific browser only
npx playwright install webkit
npx playwright install chromium
npx playwright install firefox

# Check installed browsers vs required
npx playwright --version
ls ~/Library/Caches/ms-playwright/
```

Browser binaries are cached in `~/Library/Caches/ms-playwright/` (macOS). Each Playwright version requires specific browser builds (e.g., Playwright 1.57.0 requires webkit-2227).

**Test counts by mode:**

- `fast`: ~413 tests (webkit only, ~1m)
- `full`: ~1239 tests (all 3 browsers, ~3m)
- `tauri`: ~1300+ tests (all browsers + @tauri tagged tests, ~4m)

**Playwright Test Structure:**

```javascript
import { test, expect } from '@playwright/test';

test('should play track when clicked', async ({ page }) => {
  // Set viewport size to mimic desktop use (minimum 1624x1057)
  await page.setViewportSize({ width: 1624, height: 1057 });

  // Navigate to application
  await page.goto('/');

  // Interact with UI
  await page.click('[data-testid="play-button"]');

  // Assert expected behavior
  await expect(page.locator('[data-testid="now-playing"]')).toBeVisible();
});
```

**Best Practices:**

- **Viewport Size**: Set minimum viewport to 1624x1057 to mimic desktop use
- Use `data-testid` attributes for stable selectors
- Wait for network requests and animations to complete
- Use `page.waitForSelector()` for dynamic content
- Take screenshots on failure: `await page.screenshot({ path: 'failure.png' })`
- Use `test.beforeEach()` and `test.afterEach()` for setup/teardown
- Organize tests by feature in separate files
- Use Playwright's auto-waiting features instead of arbitrary timeouts

**API Mocking for Tests:**

When running Playwright tests in browser mode (without Tauri backend), the frontend falls back to HTTP requests at `http://127.0.0.1:8765/api/*` which fails. Use the mock fixtures to intercept these requests:

```javascript
import { test } from '@playwright/test';
import { createLibraryState, setupLibraryMocks } from './fixtures/mock-library.js';
import { createPlaylistState, setupPlaylistMocks } from './fixtures/mock-playlists.js';

test.describe('My Test Suite', () => {
  test.beforeEach(async ({ page }) => {
    // Set up mocks BEFORE page.goto()
    const libraryState = createLibraryState();
    await setupLibraryMocks(page, libraryState);

    // Optional: also mock playlists
    const playlistState = createPlaylistState();
    await setupPlaylistMocks(page, playlistState);

    await page.goto('/');
  });
});
```

Available mock fixtures:

- `mock-library.js`: Library API (`/api/library`, track CRUD operations)
- `mock-playlists.js`: Playlist API (`/api/playlists`, playlist CRUD operations)

Each mock creates a mutable state object that persists for the test and tracks API calls for assertions.

**E2E Test Authoring with MCP (Required Workflow):**

When **drafting or debugging** Playwright E2E tests, you MUST use the MCP bridge for faster iteration and richer diagnostics. This requirement applies to test authoring only—test runs in CI use mocks.

1. **Start the app with MCP enabled:**
   ```bash
   task tauri:dev:mcp
   ```

2. **Capture required diagnostics** during test development:

   | Artifact | MCP Tool | Purpose |
   |----------|----------|---------|
   | Screenshots | `webview_screenshot` | Visual proof of UI state |
   | Console logs | `read_logs` (source: console) | Capture JS errors/warnings |
   | Network traces | `ipc_get_captured` | Verify IPC command payloads |
   | IPC logs | `ipc_monitor` | Monitor backend communication |

3. **Store evidence** under `/tmp/mt-e2e-evidence/<test-name>-<timestamp>/`
   - On Windows: use `%TEMP%\mt-e2e-evidence\`
   - Evidence is for debugging; no cleanup required

4. **Validate before committing tests:**
   - Confirm test passes with mocks (browser-only mode)
   - Confirm test captures expected diagnostics
   - Reference [MCP Bridge docs](docs/tauri-architecture.md#mcp-bridge-ai-agent-debugging) for full tool list

**Note:** MCP is required for **drafting** tests only. Production test runs use mocks and do not require MCP.

### Tauri MCP Tool Reference

When connected via `task tauri:dev:mcp`, use these tools for debugging and testing:

**Session Management:**
```javascript
// Start a session (required before other tools)
driver_session({ action: "start", port: 9223 })

// Check connection status
driver_session({ action: "status" })

// End session when done
driver_session({ action: "stop" })
```

**View Navigation:**
```javascript
// Navigate to a view (library, settings, etc.)
// IMPORTANT: Use $store.ui.view, NOT showSettings
webview_execute_js({ script: "Alpine.store('ui').view = 'settings'" })

// Navigate to a specific settings section
webview_execute_js({ script: "(() => { Alpine.store('ui').view = 'settings'; Alpine.store('ui').settingsSection = 'lastfm'; return 'done'; })()" })
```

**Screenshots (preferred for visual state):**
```javascript
// Capture current viewport
webview_screenshot({ format: "png" })

// Save to specific file
webview_screenshot({ format: "png", filePath: "/tmp/debug.png" })

// Limit size for large viewports
webview_screenshot({ format: "jpeg", quality: 80, maxWidth: 1200 })
```

**Console & Log Reading:**
```javascript
// Read JS console logs (errors, warnings, debug)
read_logs({ source: "console", lines: 50 })

// Filter by keyword
read_logs({ source: "console", filter: "queue", lines: 100 })

// Read since timestamp
read_logs({ source: "console", since: "2026-02-03T10:00:00Z" })
```

**IPC Monitoring (Tauri commands):**
```javascript
// Start monitoring IPC traffic
ipc_monitor({ action: "start" })

// Get captured IPC calls (invoke + responses)
ipc_get_captured({})

// Filter by command name
ipc_get_captured({ filter: "queue" })

// Stop monitoring
ipc_monitor({ action: "stop" })
```

**UI Interaction:**
```javascript
// Click element by CSS selector
webview_interact({ action: "click", selector: "[data-testid='play-button']" })

// Double-click
webview_interact({ action: "double-click", selector: ".track-row" })

// Scroll
webview_interact({ action: "scroll", selector: ".library-scroll-container", scrollY: 500 })

// Focus element
webview_interact({ action: "focus", selector: "input[type='search']" })
```

**Keyboard Input:**
```javascript
// Type into focused/selected element
webview_keyboard({ action: "type", selector: "input", text: "search query" })

// Press key
webview_keyboard({ action: "press", key: "Enter" })

// Key with modifiers
webview_keyboard({ action: "press", key: "a", modifiers: ["Control"] })
```

**JavaScript Execution:**
```javascript
// Execute JS in webview context (has access to Alpine stores)
webview_execute_js({ script: "Alpine.store('queue').items.length" })

// IIFE for return values (must be JSON-serializable)
webview_execute_js({ script: "(() => { return Alpine.store('player').currentTrack; })()" })
```

**Window Management:**
```javascript
// List all windows
manage_window({ action: "list" })

// Get window info
manage_window({ action: "info", windowId: "main" })

// Resize window
manage_window({ action: "resize", width: 1624, height: 1057 })
```

**Wait Conditions:**
```javascript
// Wait for element
webview_wait_for({ type: "selector", value: "[data-testid='loaded']", timeout: 5000 })

// Wait for text
webview_wait_for({ type: "text", value: "Library loaded", timeout: 5000 })

// Wait for IPC event
webview_wait_for({ type: "ipc-event", value: "queue:updated", timeout: 5000 })
```

**Tools to AVOID:**

- `webview_dom_snapshot` - Triggers accessibility tree traversal; DOM is 12k+ lines
- `webview_find_element` - Reads DOM directly; prefer `webview_execute_js` with selectors
- `list_devices` - Mobile only, not needed for desktop development

### Code Coverage

The project uses code coverage tools to track test effectiveness:

**Frontend Coverage (Vitest):**

```bash
# Run Vitest unit tests with coverage
cd app/frontend
npm run test:coverage

# Coverage report generated at app/frontend/coverage/
```

- Uses `@vitest/coverage-v8` for V8-based coverage
- Per-file thresholds configured in `vitest.config.js`
- Primary coverage target: `js/stores/queue.js` (35% minimum)
- Note: Most frontend testing is E2E via Playwright; Vitest covers store logic

**Backend Coverage (Rust):**

```bash
# Local (macOS) - uses cargo-llvm-cov
cd src-tauri
cargo llvm-cov --html --output-dir coverage

# CI (Linux) - uses cargo-tarpaulin
cargo tarpaulin --out Html --output-dir coverage --fail-under 50
```

- Current coverage: ~56% line coverage (320 passing tests)
- CI threshold: 50% minimum line coverage
- Coverage reports uploaded as GitHub Actions artifacts

**Coverage Thresholds:**

| Component | Tool | Tests | Current | Threshold |
|-----------|------|-------|---------|-----------|
| Rust backend | tarpaulin/llvm-cov | 320 | ~56% | 50% |
| Vitest unit | @vitest/coverage-v8 | 210 | ~40% | 35% |
| Playwright E2E | Playwright | 413 | N/A | N/A |

Note: The 80% target is aspirational. Current thresholds are set to pass existing tests while providing infrastructure to track improvement over time.

### Task Runner Commands

The project uses Taskfile (task-runner) for orchestrating build, test, and development workflows.

**Main Taskfile Commands:**
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

**Tauri Taskfile Commands** (namespace: `tauri:`):
```bash
task tauri:dev                # Run Tauri in development mode
task tauri:build              # Build Tauri app for current architecture
task tauri:build:arm64        # Build Tauri app for Apple Silicon
task tauri:build:x64          # Build Tauri app for Intel
task tauri:info               # Show Tauri build configuration
task tauri:clean              # Clean Tauri build artifacts
```

**NPM Taskfile Commands** (namespace: `npm:`):
```bash
task npm:install              # Install npm dependencies
task npm:clean                # Clean npm cache and node_modules
```

**Build Pipeline:**

When running `task build`, the following happens automatically:

1. `npm:install` - Install frontend dependencies
2. `tauri:build` - Build Rust backend and bundle with frontend

**Development Workflow:**

```bash
# Start development server
task tauri:dev

# After making Rust backend changes, Tauri will auto-rebuild
# (hot reload is automatic in dev mode)
```

### Git Worktree Management (worktrunk)

The project uses [worktrunk](https://github.com/max-sixty/worktrunk) (`wt`) for managing git worktrees, enabling parallel development and isolated migration work.

**Checking out worktrees on another computer:**

```bash
# If repository already exists, fetch latest branches
git fetch origin

# Create and switch to a worktree for a remote branch
wt switch tauri-migration

# Or if starting fresh:
git clone https://github.com/pythoninthegrass/mt.git
cd mt
wt switch tauri-migration
```

Worktrunk automatically detects remote branches and creates worktrees at computed paths based on your configured template (typically `../repo.branch-name`).

**Basic worktree operations:**

```bash
# list existing worktrees
wt list

# Switch to existing worktree for a branch
wt switch feature

# Create new worktree and branch from current HEAD
wt switch --create feature

# Create from specific base branch
wt switch --create feature --base=main

# Create and execute command in new worktree
wt switch -c feature -x "cargo tauri dev"

# Switch to default branch's worktree
wt switch ^

# Switch to previous worktree
wt switch -
```

**Merge workflow:**
```bash
# Full merge workflow: squash, rebase, fast-forward merge, remove worktree
wt merge

# Merge to specific target branch (positional argument, not --target)
wt merge develop

# Skip squashing (keep commit history)
wt merge --no-squash

# Merge without removing worktree
wt merge --no-remove

# Skip approval prompts (auto-confirm)
wt merge -y

# Combined: merge to main, auto-confirm, keep worktree
wt merge main -y --no-remove
```

**What `wt merge` does (pipeline):**

1. **Squash** - Stages uncommitted changes, combines all commits since target into one
2. **Rebase** - Rebases onto target if behind (skipped if up-to-date)
3. **Pre-merge hooks** - Runs configured hooks (tests, lint) before merge
4. **Merge** - Fast-forward merge to target branch
5. **Cleanup** - Removes worktree and branch (unless `--no-remove`)

**Staging options** (what gets included in squash commit):
```bash
wt merge --stage=all      # Default: untracked + unstaged changes
wt merge --stage=tracked  # Only tracked file changes (like git add -u)
wt merge --stage=none     # Only what's already staged
```

**Granular operations:**
```bash
# Squash all commits into one
wt step squash

# Rebase onto target branch
wt step rebase

# Push to remote
wt step push

# Run command in all worktrees
wt step for-each -- git status
wt step for-each -- uv run pytest
```

**Cleanup:**
```bash
# Remove current worktree (prompts for branch deletion)
wt remove

# Remove specific worktree by branch name
wt remove feature

# Remove worktree but keep branch
wt remove feature --no-delete-branch

# Force delete unmerged branch
wt remove feature -D
```

**Current worktrees:**

- `main` - Legacy Python/Tkinter implementation (maintenance only)
- `tauri-migration` - Active development: Tauri + Rust + basecoat/Alpine.js frontend

## Architecture Overview

### Pure Rust + Tauri Architecture

**Current State:** The application uses a modern Tauri architecture with a pure Rust backend:

- **Frontend**: Tauri + basecoat/Alpine.js
- **Backend**: Native Rust (all 87 Tauri commands implemented)
- **Database**: SQLite via rusqlite
- **Audio**: Rodio/Symphonia for playback

```text
┌─────────────┐
│   Frontend  │
│  (Tauri +   │
│  basecoat)  │
└──────┬──────┘
       │ Tauri
       │ Commands
┌──────▼──────┐
│    Rust     │
│   Backend   │
│  (Native)   │
└─────────────┘
```

**Key Features:**

- Fast startup (no interpreter initialization)
- Low memory footprint (no Python runtime)
- Single binary distribution
- Type-safe IPC via Tauri commands

### Core Components

The application follows a modern web-based architecture with Tauri providing native desktop capabilities and system integration:

1. **Backend (Rust/Tauri)** (`src-tauri/src/`):
   - Audio playback engine using native Rust libraries
   - File system operations and music library scanning
   - System integration (media keys, notifications, window management)
   - Database operations (SQLite via Tauri)
   - Tauri commands exposed to frontend via IPC
   - Event emitters for real-time updates to frontend

2. **Frontend (basecoat + Alpine.js)** (`src/`):
   - **basecoat**: Utility-first design system built on Tailwind CSS
   - **Alpine.js**: Lightweight reactive framework for interactivity
   - **Components**: Modular UI components with scoped styles
     - Player controls (play/pause, prev/next, shuffle, loop)
     - Progress bar and volume slider
     - Library browser with search and filtering
     - Queue view with drag-and-drop reordering
     - Now playing display with track metadata
   - **Styling**: Tailwind CSS for responsive, utility-based styling
   - **State Management**: Alpine.js stores for global state

3. **Database Layer** (`src-tauri/src/db/`):
   - SQLite database for library and queue persistence
   - Database schema versioning and migrations
   - Prepared statements for performance
   - Transaction support for data integrity
   - Query builders for complex operations

4. **IPC Communication**:
   - Tauri commands for frontend→backend communication
   - Event system for backend→frontend updates
   - Type-safe message passing with serde serialization
   - Async/await patterns for non-blocking operations

5. **Testing Infrastructure**:
   - **Playwright**: E2E and integration testing
   - **Vitest/Jest**: Frontend unit tests
   - **Rust tests**: Backend unit and integration tests
   - **Test fixtures**: Reusable test data and utilities

### Key Design Patterns

- **Component-Based Architecture**: Modular, reusable UI components
- **Event-Driven IPC**: Backend emits events for real-time frontend updates
- **Command Pattern**: Tauri commands encapsulate backend operations
- **Reactive State**: Alpine.js reactive stores for UI state management
- **Repository Pattern**: Database layer abstracts data access
- **Builder Pattern**: Complex object construction (e.g., queries, commands)

### Configuration System

- Tauri configuration in `tauri.conf.json`
- Environment-based builds (dev/production)
- Frontend configuration via Vite
- Runtime settings stored in database
- Platform-specific configurations for macOS/Linux/Windows

### Platform Considerations

- Cross-platform support: macOS, Linux, Windows
- Platform-specific features detected at runtime
- Native system integration via Tauri APIs
- Responsive UI adapts to window sizes
- Platform-native styling and behaviors

### Browser Development Mode

**Audio playback only works in Tauri.** When running the frontend in a standalone browser (Firefox, Chrome) for UI development:

- `window.__TAURI__` is undefined
- Audio playback commands (`audio_load`, `audio_play`, etc.) silently fail
- Use browser mode **only for UI/styling work**, not playback testing
- For playback testing, always use `task tauri:dev`

See [task-159](backlog/tasks/task-159%20-%20Implement-browser-WebAudio-fallback-for-playback.md) for future WebAudio fallback implementation.

### Queue and Shuffle Behavior

The queue store (`app/frontend/js/stores/queue.js`) maintains tracks in **play order** - the `items` array always reflects the order tracks will be played.

**Key behaviors:**

- **Without shuffle**: Tracks play sequentially in the order they were added
- **With shuffle enabled**: The `items` array is physically reordered using the [Fisher-Yates shuffle algorithm](https://en.wikipedia.org/wiki/Fisher%E2%80%93Yates_shuffle)
  - Current track moves to index 0
  - Remaining tracks are randomly shuffled
  - Playback proceeds sequentially through the shuffled array
- **When shuffle is disabled**: Original order is restored from `_originalOrder`
- **Loop + Shuffle**: When queue ends with loop=all, items are re-shuffled for a new random order

**Now Playing view**: Always displays tracks in the order they will play (current track first, then upcoming). This means the UI never "jumps around" - tracks are always adjacent and sequential.

### Frontend Testing with Playwright

**IMMEDIATELY after implementing any frontend change:**

1. **Identify what changed** - Review the modified components/pages
2. **Write or update Playwright tests** - Ensure test coverage for the changed functionality
3. **Run tests locally** - Execute `npm run test:e2e` to verify changes
4. **Visual validation** - Use Playwright's screenshot capabilities:
   ```javascript
   await page.screenshot({ path: 'screenshots/feature-name.png' });
   ```
5. **Validate feature implementation** - Ensure the change fulfills the user's specific request
6. **Check acceptance criteria** - Review any provided context files or requirements
7. **Interactive debugging** - Use `npm run test:e2e:ui` for step-by-step test debugging
8. **Check for errors** - Review test output and browser console logs

**Playwright Best Practices for this Project:**

```javascript
// Set desktop viewport size (minimum 1624x1057)
await page.setViewportSize({ width: 1624, height: 1057 });

// Use data-testid attributes for reliable selectors
await page.click('[data-testid="play-button"]');

// Wait for Tauri IPC calls to complete
await page.waitForResponse(response =>
  response.url().includes('tauri://') && response.status() === 200
);

// Verify real-time updates from backend events
await expect(page.locator('[data-testid="now-playing"]')).toContainText('Track Name');

// Test drag-and-drop functionality
await page.dragAndDrop('[data-testid="track-1"]', '[data-testid="drop-zone"]');

// Capture screenshots for visual regression testing
await expect(page).toHaveScreenshot('player-controls.png');
```

### Dependencies

**Frontend:**

- **Tauri**: Desktop application framework
- **basecoat**: Design system built on Tailwind CSS
- **Alpine.js**: Lightweight reactive JavaScript framework
- **Tailwind CSS**: Utility-first CSS framework
- **Playwright**: E2E testing framework
- **Vite**: Frontend build tool and dev server

**Backend:**

- **Rust/Cargo**: Backend language and package manager
- **Tauri**: Native system integration
- **Rodio/Symphonia**: Audio playback libraries
- **SQLite/rusqlite**: Database operations
- **Serde**: Serialization/deserialization
- **Tokio**: Async runtime

### Dependency Management

**Frontend (npm):**

```bash
# Install dependencies
npm install

# Add new dependencies
npm install package-name

# Add development dependencies
npm install --save-dev package-name

# Update dependencies
npm update
```

**Backend (Cargo):**

```bash
# Install/update dependencies
cargo build

# Add new dependencies
cargo add crate-name

# Add development dependencies
cargo add --dev crate-name

# Update dependencies
cargo update
```

## Important Implementation Notes

1. **Component-Based Architecture**:
   - Frontend components are modular and reusable
   - Keep components focused on single responsibilities
   - Use Alpine.js components for interactive elements
   - Apply basecoat/Tailwind utilities for consistent styling

2. **Tauri IPC Communication**:
   - All backend operations must be exposed via Tauri commands
   - Use async/await for all Tauri command invocations
   - Handle errors gracefully with proper error types
   - Emit events for real-time updates (playback progress, track changes)

3. **Type Safety**:
   - Use TypeScript for frontend code when possible
   - Rust backend provides compile-time type safety
   - Define shared types for IPC message structures
   - Validate data at system boundaries

4. **File Organization**:
   - Frontend: Organize by feature/component in `src/`
   - Backend: Organize by module in `src-tauri/src/`
   - Keep files focused and under 500 LOC when practical
   - Use barrel exports for clean imports

5. **Testing Strategy**:
   - **Unit tests**: Test individual functions and components
   - **Integration tests**: Test Tauri commands and IPC
   - **E2E tests**: Use Playwright for full user flows
   - All E2E/integration tests MUST use Playwright
   - Aim for high coverage of critical paths

6. **Code Style**:
   - **Frontend**: ESLint + Prettier for JavaScript/TypeScript
   - **Backend**: `cargo fmt` and `cargo clippy` for Rust
   - **CSS**: Follow Tailwind CSS conventions and basecoat patterns
   - Run formatters before committing

## Development Tools

### Hot Reload (Vite + Tauri)

- Vite provides instant HMR (Hot Module Replacement) for frontend changes
- Tauri dev mode automatically rebuilds Rust backend on changes
- Frontend changes reflect immediately without full app restart
- Backend changes trigger incremental rebuild and app restart
- Usage: `npm run tauri:dev` or `task tauri:dev`

### Logging System

**Frontend Logging:**

- Console logging for development (`console.log`, `console.error`)
- Browser DevTools for debugging and network inspection
- Structured logging for user actions and events
- Error boundaries for graceful error handling

**Backend Logging:**

- Rust `log` crate for structured logging
- `env_logger` or `tracing` for log output
- Log levels: trace, debug, info, warn, error
- Logs visible in terminal during `cargo tauri dev`

**Logging Best Practices:**

1. **Frontend**:
   ```javascript
   // Log user actions
   console.log('[Action]', 'play_track', { trackId, trackName });

   // Log errors with context
   console.error('[Error]', 'Failed to load track', { error, trackId });

   // Log IPC calls
   console.debug('[IPC]', 'invoke', { command: 'play_track', args });
   ```

2. **Backend (Rust)**:
   ```rust
   use log::{info, warn, error, debug};

   #[tauri::command]
   fn play_track(track_id: String) -> Result<(), String> {
       info!("Playing track: {}", track_id);
       // ... implementation
       Ok(())
   }
   ```

### Playwright Test Tools

- **Test Generator**: `npx playwright codegen` to generate test code interactively
- **UI Mode**: `npm run test:e2e:ui` for interactive test debugging
- **Trace Viewer**: `npx playwright show-trace trace.zip` for detailed test execution analysis
- **Inspector**: `npx playwright test --debug` to step through tests
- **Screenshots**: Automatic failure screenshots in `test-results/`
- **Video Recording**: Enable in Playwright config for test videos

### Rust Development Tools

- **cargo-watch**: Auto-rebuild on file changes: `cargo watch -x build`
- **rust-analyzer**: LSP for IDE integration (VS Code, IntelliJ, etc.)
- **clippy**: Linting tool: `cargo clippy`
- **rustfmt**: Code formatter: `cargo fmt`
- **cargo-expand**: View macro expansions: `cargo expand`

### Linux Remote Debugging

**Running via SSH (headless):**

```bash
# Launch with debug logging on a remote Linux host
ssh <HOST> "DISPLAY=:0 RUST_LOG=debug /usr/bin/mt-tauri"

# For Wayland sessions, set WAYLAND_DISPLAY instead
ssh <HOST> "WAYLAND_DISPLAY=wayland-0 RUST_LOG=debug /usr/bin/mt-tauri"
```

**Tauri MCP Bridge (DOM/JS/CSS inspection via AI agent tools):**

The release .deb is built with the `mcp` Cargo feature by default, which enables the Tauri MCP Bridge plugin. This provides full webview inspection (JS execution, screenshots, IPC monitoring) over WebSocket — no browser DevTools needed.

> **Note:** `WEBKIT_INSPECTOR_SERVER` does NOT work on release builds. WebKitGTK requires `enable-developer-extras` on the WebView, which Tauri only sets when the `devtools` Cargo feature is enabled. The `devtools` feature (CrabNebula DevTools) adds always-on instrumentation overhead and only provides Rust backend logs — no DOM/CSS inspection. The MCP bridge is idle until a client connects and provides full webview access.

```bash
# On the Linux host, launch normally (MCP bridge listens on port 9223)
ssh <HOST> "DISPLAY=:0 /usr/bin/mt-tauri"

# From your development machine, create an SSH tunnel
ssh -L 9223:localhost:9223 <HOST>
```

Then connect via Tauri MCP tools:

```javascript
// Connect to the app
driver_session({ action: "start", port: 9223 })

// Execute JS with access to Alpine stores
webview_execute_js({ script: "Alpine.store('library').tracks.length" })

// Take screenshots
webview_screenshot({ format: "png", filePath: "/tmp/debug.png" })

// Monitor IPC traffic
ipc_monitor({ action: "start" })
ipc_get_captured({ filter: "queue" })

// Read console logs
read_logs({ source: "console", lines: 50 })
```

This provides:

- **JS execution**: Full access to Alpine stores, DOM queries, computed styles
- **Screenshots**: Capture webview viewport as PNG/JPEG
- **IPC monitoring**: Inspect Tauri command invocations and responses
- **Console logs**: Read JS console output (errors, warnings, debug)
- **UI interaction**: Click, type, scroll, focus elements by CSS selector

See the [Tauri MCP Tool Reference](#tauri-mcp-tool-reference) section for the complete tool list.

**Crash debugging workflow:**

1. **Check systemd journal** for crash notifications:
   ```bash
   ssh <HOST> "journalctl --user --since '10 minutes ago' --no-pager | grep mt-tauri"
   ```

2. **Check `/var/crash/`** for Ubuntu apport crash reports:
   ```bash
   ssh <HOST> "ls -lt /var/crash/ | grep mt"
   # Example: _usr_bin_mt-tauri.1000.crash
   ```

3. **Unpack and inspect** the crash report:
   ```bash
   ssh <HOST> "apport-unpack /var/crash/_usr_bin_mt-tauri.1000.crash /tmp/mt-crash"
   ssh <HOST> "cat /tmp/mt-crash/Signal"       # Signal number (4=SIGILL, 11=SIGSEGV)
   ssh <HOST> "cat /tmp/mt-crash/SignalName"    # Human-readable signal name
   ssh <HOST> "cat /tmp/mt-crash/ProcStatus"    # Process state at crash
   ```

4. **Get a backtrace** from the coredump via gdb:
   ```bash
   ssh <HOST> "gdb /usr/bin/mt-tauri /tmp/mt-crash/CoreDump -batch \
     -ex 'bt' -ex 'info registers' -ex 'x/5i \$rip'"
   ```

5. **For SIGILL crashes**, check CPU feature compatibility:
   ```bash
   # Check what the CPU supports
   ssh <HOST> "grep -oP 'flags\s+:\s+\K.*' /proc/cpuinfo | head -1"

   # Scan binary for instructions the CPU may not support
   ssh <HOST> "objdump -d /usr/bin/mt-tauri | grep -c 'ymm'"      # AVX (256-bit)
   ssh <HOST> "objdump -d /usr/bin/mt-tauri | grep -c 'shlx\|shrx\|sarx'"  # BMI2
   ```

**Common SIGILL causes:**

- Binary compiled with AVX/BMI2 instructions on CI, deployed to older CPUs without those features
- Zig libraries default to native CPU in release mode; fix with `-Dcpu=baseline`
- C/C++ static libraries (TagLib) auto-vectorize for the build machine; fix with `-march=x86-64`

## Video Demo

Convert screen recording (mp4) to AVIF for README using SVT-AV1 (fast, good quality):

```bash
ffmpeg -i input.mp4 -c:v libsvtav1 -vf scale=-1:720 -crf 30 demo.avif
```

- `libsvtav1` is 10-50x faster than `libaom-av1`
- `-crf 30` balances quality/size (lower = better quality, larger file)
- Scale to 720p height for reasonable file size

### Video Frame Extraction for Debugging

Extract frames from screen recordings (MP4/MOV) for debugging UI issues:

```bash
# High-quality PNG frames at source resolution
ffmpeg -i video.mp4 -vf "fps=15" /tmp/frames/frame_%03d.png

# With downscaling for large videos (720p height, maintain aspect)
ffmpeg -i video.mp4 -vf "fps=15,scale=-1:720" /tmp/frames/frame_%03d.png

# Extract specific time range (2s to 5s)
ffmpeg -i video.mp4 -ss 2 -to 5 -vf "fps=15" /tmp/frames/frame_%03d.png

# Maximum quality (lossless PNG, no frame skip)
ffmpeg -i video.mp4 -vf "fps=30" -compression_level 0 /tmp/frames/frame_%03d.png

# JPEG for smaller files (quality 2 = high, 31 = low)
ffmpeg -i video.mp4 -vf "fps=15" -qscale:v 2 /tmp/frames/frame_%03d.jpg
```

**Parameters:**

- `fps=15` - Extract 15 frames per second (adjust based on video framerate)
- `scale=-1:720` - Scale to 720p height, auto-calculate width
- `-compression_level 0` - Fastest PNG encoding (larger files)
- `-qscale:v 2` - JPEG quality (2=best, 31=worst)

**Use cases:**

- Debugging spinner/loading issues
- Capturing exact UI state during animations
- Documenting visual bugs for reports

<!-- BACKLOG.MD MCP GUIDELINES START -->

<CRITICAL_INSTRUCTION>

## BACKLOG WORKFLOW INSTRUCTIONS

This project uses Backlog.md MCP for all task and project management.

**CRITICAL RESOURCE**: Read `backlog://workflow/overview` to understand when and how to use Backlog for this project.

- **First time working here?** Read the overview resource IMMEDIATELY to learn the workflow
- **Already familiar?** You should have the overview cached ("## Backlog.md Overview (MCP)")
- **When to read it**: BEFORE creating tasks, or when you're unsure whether to track work

The overview resource contains:

- Decision framework for when to create tasks
- Search-first workflow to avoid duplicates
- Links to detailed guides for task creation, execution, and completion
- MCP tools reference

You MUST read the overview resource to understand the complete workflow. The information is NOT summarized here.

</CRITICAL_INSTRUCTION>

<!-- BACKLOG.MD MCP GUIDELINES END -->
