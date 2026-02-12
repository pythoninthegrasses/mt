---
id: task-264
title: Use GTK HeaderBar for native CSD titlebar on Linux
status: Done
assignee: []
created_date: '2026-02-11 07:07'
updated_date: '2026-02-11 16:43'
labels:
  - enhancement
  - frontend
  - linux
  - titlebar
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Goal

On Linux (GNOME), replace the standard window manager titlebar with a GTK HeaderBar using Client-Side Decorations (CSD), so the app's theme colors extend seamlessly to the top of the window — matching the style of native GNOME apps like Ptyxis.

The HeaderBar must adapt to whatever theme is currently selected (dark, light, metro teal, etc.), just like the macOS Overlay titlebar already does. The background should match `bg-background` from the active theme, not be hardcoded to a single color.

## Current Behavior

- `titleBarStyle: \"Overlay\"` and `hiddenTitle: true` in `tauri.conf.json` are macOS-only and have no effect on Linux
- On Linux, mt gets a standard GNOME window decoration bar with \"mt\" title text, visually disconnected from the app's theme
- Screenshot reference: `~/Desktop/Screenshot from 2026-02-11 01-02-25.png` on 1up (RPi CM5, Debian Trixie, GNOME/X11)

## Approach

Use Tauri's `window.gtk_window()` API to access the underlying `gtk::ApplicationWindow` and set a custom `GtkHeaderBar` as the titlebar.

```rust
#[cfg(target_os = \"linux\")]
{
    let gtk_window = window.gtk_window()?;
    let header_bar = gtk::HeaderBar::new();
    gtk_window.set_titlebar(Some(&header_bar));
}
```

### Key considerations

- Must be done at window creation time (before `window.show()`) — `set_decorations()` is a no-op at runtime on Linux
- The HeaderBar should be styled via GTK CSS to match the active theme's `bg-background` color — must respond to theme changes dynamically (not hardcoded to a single color like `rgb(30, 30, 30)`)
- Window controls (close/minimize/maximize) are automatically provided by `GtkHeaderBar`
- The existing `data-tauri-drag-region` div in the frontend should still work alongside this (or can be conditionally hidden on Linux)
- May need to add `gtk` crate as a dependency if not already available
- 1up runs webkit2gtk 4.1 on Debian Trixie (GNOME, X11)

## Reference

- Ptyxis terminal on the same machine demonstrates the desired CSD style
- macOS Overlay titlebar already adapts to theme changes — Linux implementation should match this behavior
- Tauri API: `window.gtk_window()` returns `gtk::ApplicationWindow` (Linux only)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 On Linux/GNOME, the window uses a GTK HeaderBar instead of the standard window manager titlebar
- [x] #2 The HeaderBar background color matches the active theme (dark, light, metro teal, etc.) — not hardcoded to a single color
- [x] #3 HeaderBar updates dynamically when the user switches themes
- [x] #4 Native window controls (close/minimize/maximize) are present and functional

- [x] #5 macOS titlebar behavior (Overlay + hiddenTitle) is unaffected
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented GTK HeaderBar for Linux with dynamic theme color synchronization. Tested on RPi CM5 (Debian Trixie, GNOME/X11) via Tauri MCP. Commit: bae124c
<!-- SECTION:NOTES:END -->
