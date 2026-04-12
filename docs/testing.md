# Testing Guide

This document covers the testing strategy and workflows for the MT music player.

## Testing Layers

MT uses a three-tier testing strategy:

| Layer | Framework | Tests | Purpose |
|-------|-----------|-------|---------|
| **Rust Backend** | `cargo test` | ~596 | Unit tests for audio, database, and IPC logic |
| **Vitest Unit** | Vitest | ~391 | Frontend store logic, property-based tests |
| **Playwright E2E** | Playwright | ~650 | Integration and end-to-end user flows |

## Running Tests

```bash
# Run all tests (Rust + Vitest)
task test

# Run Playwright E2E tests
task test:e2e

# Run E2E in interactive UI mode
task npm:test:e2e:ui
```

See the [Development Guide](development.md) for the complete test command reference.

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

```text
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
| `fast` (default) | WebKit only | Skipped | ~650 | ~1m |
| `full` | All 3 | Skipped | ~1950 | ~3m |
| `tauri` | All 3 | Included | ~2000+ | ~4m |

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

## Where to Write New Tests

Each layer has a clear boundary. Putting a test in the wrong layer wastes CI time and creates redundancy.

| What you're testing | Write it in | NOT in |
|---|---|---|
| Store logic (queue add/remove, shuffle, loop, player state) | Vitest `__tests__/` | Playwright |
| Pure functions (sorting, filtering, formatting) | Vitest `__tests__/` | Playwright |
| Property-based invariants (queue identity, order preservation) | Vitest `__tests__/` with fast-check | Playwright |
| CSS values (padding, computed styles, user-select) | Nowhere — verify in design review | Playwright |
| User interaction flows (click to play, drag to reorder, context menu) | Playwright `tests/` | Vitest |
| Cross-component wiring (play track -> queue populates -> Now Playing renders) | Playwright `tests/` | Vitest |
| Backend logic (audio engine, DB queries, concurrency) | Rust `#[test]` / proptest | Frontend tests |

### Decision checklist for new Playwright tests

Before adding a Playwright E2E test, ask:

1. **Does this test call `page.evaluate()` to manipulate Alpine stores?** If the test primarily sets store state and checks store state, it belongs in Vitest.
2. **Does this test click buttons, type text, or drag elements?** Real user interactions justify Playwright.
3. **Is there already a Vitest test for this logic?** Check `__tests__/` first. Do not duplicate coverage.
4. **Does this test check CSS computed values?** CSS assertion tests are brittle and low-value — skip them.

### Tauri-tagged tests

Tests requiring the Tauri runtime (IPC commands, native dialogs) use the `@tauri` tag in their `test.describe` block. CI runs in `fast` mode (WebKit only, `@tauri` skipped). Use `E2E_MODE=tauri` locally to include them.

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

## Playwright Test Tools

- **Test Generator**: `npx playwright codegen` — generate test code interactively
- **UI Mode**: `task npm:test:e2e:ui` — interactive debugging
- **Trace Viewer**: `npx playwright show-trace trace.zip` — detailed execution analysis
- **Inspector**: `npx playwright test --debug` — step through tests
- **Screenshots**: Automatic failure screenshots in `test-results/`
- **Video Recording**: Enable in Playwright config for test videos

## After Any Frontend Change

1. Identify what changed
2. Write or update Playwright tests for the changed functionality
3. Run `task test:e2e` to verify
4. Use `task npm:test:e2e:ui` for interactive debugging if needed
5. Check browser console logs for errors

## References

- [MCP Tool Reference](mcp-reference.md) — Full tool list for test authoring
- [MCP Bridge Architecture](tauri-architecture.md#mcp-bridge-ai-agent-debugging) — Bridge design docs
- [hypothesi/mcp-server-tauri](https://github.com/hypothesi/mcp-server-tauri) — MCP server documentation
