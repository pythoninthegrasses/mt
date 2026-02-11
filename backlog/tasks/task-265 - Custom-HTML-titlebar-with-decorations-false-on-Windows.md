---
id: task-265
title: 'Custom HTML titlebar with decorations:false on Windows'
status: To Do
assignee: []
created_date: '2026-02-11 07:09'
labels:
  - enhancement
  - frontend
  - windows
  - titlebar
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Goal

On Windows, remove the native titlebar and use a custom HTML titlebar so the app's theme colors extend to the top of the window — matching the seamless look already achieved on macOS via `titleBarStyle: "Overlay"`.

## Current Behavior

- `titleBarStyle: "Overlay"` and `hiddenTitle: true` in `tauri.conf.json` are macOS-only and have no effect on Windows
- On Windows, mt gets a standard Win32 titlebar visually disconnected from the app's dark theme

## Approach

Use `decorations: false` (set conditionally on Windows in Rust at window creation time) combined with the existing `data-tauri-drag-region` div and custom HTML window control buttons.

### Implementation steps

1. **Rust**: Conditionally disable decorations on Windows before `window.show()`
   ```rust
   #[cfg(target_os = "windows")]
   {
       // decorations: false + shadow for Win11 rounded corners
       builder = builder.decorations(false).shadow(true);
   }
   ```

2. **Frontend**: Add HTML close/minimize/maximize buttons to the existing titlebar drag region, visible only on Windows
   - Use Tauri's window API: `appWindow.minimize()`, `appWindow.toggleMaximize()`, `appWindow.close()`
   - Style to approximate native Win11 controls (or use a consistent custom design)
   - Position on the right side of the drag region

3. **Platform detection**: Use `navigator.userAgent` or a Tauri platform API to conditionally show HTML window controls only on Windows (macOS uses native traffic lights, Linux will use GTK HeaderBar per task-264)

### Key considerations

- `shadow: true` on undecorated Win11 windows gives rounded corners + 1px border
- The existing `data-tauri-drag-region` div already handles window dragging
- `set_decorations()` at runtime is noted as a stub on some platforms — must be set at window creation time via the builder
- Double-click on titlebar drag region should toggle maximize (standard Windows behavior)
- Snap layouts (Win11 hover over maximize) may not work without native controls — this is a known trade-off

## Related

- task-264: GTK HeaderBar for native CSD titlebar on Linux (same goal, different platform approach)
- macOS already works via `titleBarStyle: "Overlay"` + `hiddenTitle: true`
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 On Windows, the native titlebar is removed and the app's theme colors extend to the top of the window
- [ ] #2 Custom HTML window controls (close/minimize/maximize) are present and functional
- [ ] #3 The titlebar drag region supports window dragging and double-click to maximize
- [ ] #4 macOS and Linux titlebar behavior is unaffected
<!-- AC:END -->
