---
id: TASK-265
title: 'Custom HTML titlebar with decorations:false on Windows'
status: To Do
assignee: []
created_date: '2026-02-11 07:09'
updated_date: '2026-11-15T05:39:00Z'
labels:
  - enhancement
  - frontend
  - windows
  - titlebar
  - feature-freeze
dependencies:
  - TASK-393.28
references:
  - 'https://v2.tauri.app/reference/javascript/api/namespacewindow/#titlebar'
priority: low
ordinal: 46500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
On Windows, replace the disconnected native titlebar with a theme-consistent HTML titlebar and functional close/minimize/maximize controls. Tauri window configuration and native integration remain Rust; controls/theme/drag regions remain frontend. Preserve macOS/Linux behavior and native focus/drag/double-click expectations. Investigate current Tauri support at execution time and document Windows Snap Layout/accessibility tradeoffs rather than assuming macOS Overlay works on Windows. Scheduling: feature work is frozen until TASK-393.28 verifies Zig-first completion; TASK-393 is the initiative. Do not start this task during the freeze or implement it as a side effect of a migration task. Bugfixes require their own explicit scope. When released, read TASK-369.5's ownership ADR and then-current APIs, research the current system and record a bounded plan. Zig owns domain policy and persistence; Rust is only the Tauri/native or named-library adapter. Existing behavior remains the migration baseline until this feature is scheduled.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 On Windows, the native titlebar is removed and the app's theme colors extend to the top of the window
- [ ] #2 Custom HTML window controls (close/minimize/maximize) are present and functional
- [ ] #3 The titlebar drag region supports window dragging and double-click to maximize
- [ ] #4 macOS and Linux titlebar behavior is unaffected
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-11-14 maintainer approved a feature freeze until the Zig refactor is complete. TASK-393.28 is now an explicit scheduling dependency. Any earlier Rust-domain implementation guidance is superseded by Zig-first ownership; preserved native/Tauri/library integration remains Rust where justified.
<!-- SECTION:NOTES:END -->
