# Testing Guide

This document covers the testing strategy and workflows for the MT music player.

## Testing Layers

MT uses a three-tier testing strategy:

| Layer | Framework | Tests | Purpose |
|-------|-----------|-------|---------|
| **Rust Backend** | `cargo test` | ~320 | Unit tests for audio, database, and IPC logic |
| **Vitest Unit** | Vitest | ~210 | Frontend store logic (queue, player state) |
| **Playwright E2E** | Playwright | ~413 | Integration and end-to-end user flows |

## Running Tests

```bash
# Run all tests (Rust + Vitest)
task test

# Run Playwright E2E tests
task test:e2e

# Run E2E in interactive UI mode
task npm:test:e2e:ui
```

See [AGENTS.md](../AGENTS.md#running-tests-task-commands) for the complete test command reference.

---

## E2E Test Authoring with MCP

When **drafting or debugging** Playwright E2E tests, you MUST use the Tauri MCP bridge. This provides faster iteration and richer diagnostics than browser-only mode.

### Why MCP for Test Authoring?

- **Faster debugging**: Real-time IPC inspection, console log capture, and screenshots
- **Better diagnostics**: Verify backend commands, payloads, and responses
- **Accurate testing**: Tests interact with the real Tauri runtime, not mocks

### Workflow

#### 1. Start the App with MCP

```bash
task tauri:dev:mcp
```

This launches the Tauri app with the MCP bridge enabled (WebSocket on port 9223).

#### 2. Draft Tests with MCP Diagnostics

While developing tests, capture diagnostics to understand and verify app behavior:

| Artifact | MCP Tool | Purpose |
|----------|----------|---------|
| Screenshots | `webview_screenshot` | Visual proof of UI state |
| Console logs | `read_logs` (source: console) | Capture JS errors/warnings |
| Network traces | `ipc_get_captured` | Verify IPC command payloads |
| IPC logs | `ipc_monitor` | Monitor backend communication |

#### 3. Store Evidence

Save diagnostic artifacts during test development:

```
/tmp/mt-e2e-evidence/<test-name>-<timestamp>/
```

**Platform-specific paths:**
- **macOS/Linux**: `/tmp/mt-e2e-evidence/`
- **Windows**: `%TEMP%\mt-e2e-evidence\`

Evidence is for debugging purposes; no cleanup is required.

#### 4. Validate Before Committing

Before committing new tests:

1. **Verify mocks work**: Run the test in browser-only mode (`task test:e2e`)
2. **Check diagnostics**: Confirm expected IPC calls and UI states were captured
3. **Review evidence**: Screenshots and logs should match expected behavior

### When MCP is NOT Required

- **Running tests in CI**: CI uses mocks, not MCP
- **Running existing tests locally**: `task test:e2e` runs without MCP
- **UI/styling-only changes**: Browser-only mode is sufficient

---

## E2E Test Modes

Tests are controlled by the `E2E_MODE` environment variable:

| Mode | Browsers | @tauri tests | Tests | Duration |
|------|----------|--------------|-------|----------|
| `fast` (default) | WebKit only | Skipped | ~413 | ~1m |
| `full` | All 3 | Skipped | ~1239 | ~3m |
| `tauri` | All 3 | Included | ~1300+ | ~4m |

```bash
# Fast mode (default)
task test:e2e

# Full browser coverage
E2E_MODE=full task test:e2e

# Include @tauri tests (requires Tauri runtime)
E2E_MODE=tauri task test:e2e
```

---

## API Mocking for Browser-Only Tests

When running Playwright tests without the Tauri backend, use mock fixtures:

```javascript
import { test } from '@playwright/test';
import { createLibraryState, setupLibraryMocks } from './fixtures/mock-library.js';
import { createPlaylistState, setupPlaylistMocks } from './fixtures/mock-playlists.js';

test.describe('My Test Suite', () => {
  test.beforeEach(async ({ page }) => {
    const libraryState = createLibraryState();
    await setupLibraryMocks(page, libraryState);

    const playlistState = createPlaylistState();
    await setupPlaylistMocks(page, playlistState);

    await page.goto('/');
  });
});
```

Available fixtures:
- `mock-library.js`: Library API (`/api/library`, track CRUD)
- `mock-playlists.js`: Playlist API (`/api/playlists`, playlist CRUD)

---

## Best Practices

### Viewport Size
Always set the desktop viewport:
```javascript
await page.setViewportSize({ width: 1624, height: 1057 });
```

### Selectors
Use `data-testid` attributes for stable selectors:
```javascript
await page.click('[data-testid="play-button"]');
```

### Waiting for IPC
When testing Tauri-specific behavior:
```javascript
await page.waitForResponse(r => 
  r.url().includes('tauri://') && r.status() === 200
);
```

### Screenshots
Capture screenshots for visual verification:
```javascript
await page.screenshot({ path: '/tmp/mt-e2e-evidence/test-state.png' });
```

---

## Coverage

| Component | Tool | Threshold |
|-----------|------|-----------|
| Rust backend | tarpaulin/llvm-cov | 50% |
| Vitest unit | @vitest/coverage-v8 | 35% |
| Playwright E2E | N/A | N/A |

---

## References

- [MCP Bridge Documentation](tauri-architecture.md#mcp-bridge-ai-agent-debugging) - Full MCP tool reference
- [AGENTS.md Playwright Section](../AGENTS.md#playwright-e2e-testing) - Detailed test commands and patterns
- [hypothesi/mcp-server-tauri](https://github.com/hypothesi/mcp-server-tauri) - MCP server documentation
