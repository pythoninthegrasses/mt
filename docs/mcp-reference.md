# Tauri MCP Tool Reference

Tools available when connected via `task tauri:dev:mcp` (WebSocket on port 9223).

## Session Management

```javascript
// Start a session (required before other tools)
driver_session({ action: "start", port: 9223 })

// Check connection status
driver_session({ action: "status" })

// End session when done
driver_session({ action: "stop" })
```

## View Navigation

```javascript
// Navigate to a view (library, settings, etc.)
// IMPORTANT: Use $store.ui.view, NOT showSettings
webview_execute_js({ script: "Alpine.store('ui').view = 'settings'" })

// Navigate to a specific settings section
webview_execute_js({ script: "(() => { Alpine.store('ui').view = 'settings'; Alpine.store('ui').settingsSection = 'lastfm'; return 'done'; })()" })
```

## Screenshots

```javascript
// Capture current viewport
webview_screenshot({ format: "png" })

// Save to specific file
webview_screenshot({ format: "png", filePath: "/tmp/debug.png" })

// Limit size for large viewports
webview_screenshot({ format: "jpeg", quality: 80, maxWidth: 1200 })
```

## Console & Log Reading

```javascript
// Read JS console logs (errors, warnings, debug)
read_logs({ source: "console", lines: 50 })

// Filter by keyword
read_logs({ source: "console", filter: "queue", lines: 100 })

// Read since timestamp
read_logs({ source: "console", since: "2026-02-03T10:00:00Z" })
```

## IPC Monitoring

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

## UI Interaction

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

## Keyboard Input

```javascript
// Type into focused/selected element
webview_keyboard({ action: "type", selector: "input", text: "search query" })

// Press key
webview_keyboard({ action: "press", key: "Enter" })

// Key with modifiers
webview_keyboard({ action: "press", key: "a", modifiers: ["Control"] })
```

## JavaScript Execution

```javascript
// Execute JS in webview context (has access to Alpine stores)
webview_execute_js({ script: "Alpine.store('queue').items.length" })

// IIFE for return values (must be JSON-serializable)
webview_execute_js({ script: "(() => { return Alpine.store('player').currentTrack; })()" })
```

## Window Management

```javascript
// List all windows
manage_window({ action: "list" })

// Get window info
manage_window({ action: "info", windowId: "main" })

// Resize window
manage_window({ action: "resize", width: 1624, height: 1057 })
```

## Wait Conditions

```javascript
// Wait for element
webview_wait_for({ type: "selector", value: "[data-testid='loaded']", timeout: 5000 })

// Wait for text
webview_wait_for({ type: "text", value: "Library loaded", timeout: 5000 })

// Wait for IPC event
webview_wait_for({ type: "ipc-event", value: "queue:updated", timeout: 5000 })
```

## Tools to AVOID

| Tool | Why |
|------|-----|
| `webview_dom_snapshot` | Triggers accessibility tree traversal; DOM is 12k+ lines |
| `webview_find_element` | Reads DOM directly; prefer `webview_execute_js` with selectors |
| `list_devices` | Mobile only, not needed for desktop development |
