---
id: TASK-357
title: Playwright MCP viewport issue with Chromium driver
status: To Do
assignee: []
created_date: '2026-01-14 20:59'
labels:
  - bug
  - tooling
  - playwright
  - mcp
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The Playwright MCP server using Chromium has a viewport rendering issue where the footer/transport bar is pushed off-screen or not visible, even though the DOM reports correct positioning.

**Symptoms:**
- `innerHeight` (1430px) differs from `outerHeight` (1346px) by 84px
- Footer positioned at y=1374 is outside the visible 1346px window
- `setViewportSize()` sets content area but actual browser chrome/window is constrained differently
- Screenshots taken via Playwright show footer correctly, but actual Playwright window doesn't display it

**Verified working in:**
- Chrome browser (direct)
- Firefox browser (direct)
- Tauri app (WebKit-based)

**Root cause:**
Playwright Chromium quirk where viewport size and actual window size diverge.

**Suggested fix:**
Edit `.mcp.json` to configure Playwright MCP to use WebKit driver instead of Chromium, which should match Tauri's WebKit-based webview behavior:

```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["@anthropic/playwright-mcp", "--browser", "webkit"]
    }
  }
}
```

Alternatively, investigate Playwright MCP server configuration options for browser selection.
<!-- SECTION:DESCRIPTION:END -->
