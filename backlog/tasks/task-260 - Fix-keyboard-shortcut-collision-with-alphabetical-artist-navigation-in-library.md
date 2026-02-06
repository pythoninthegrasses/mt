---
id: task-260
title: Fix keyboard shortcut collision with alphabetical artist navigation in library
status: To Do
assignee: []
created_date: '2026-02-06 23:13'
labels:
  - frontend
  - ux
  - keyboard
  - library
dependencies:
  - task-107
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Plain letter key shortcuts (e.g., S for shuffle, M for mute, L for loop) conflict with a common music library UX pattern: pressing a letter key to jump to artists starting with that letter in the library browser.

Currently, pressing "S" always toggles shuffle regardless of context. If a user is browsing the library and presses "S" expecting to jump to artists starting with "S", the app toggles shuffle instead. This makes alphabetical navigation impossible and creates a confusing experience for users with large music collections who rely on quick letter-key jumping.

This task should resolve the ambiguity so that plain letter keys can be used for alphabetical artist navigation in the library while keyboard shortcuts remain accessible.

Two viable approaches to evaluate:

**Approach A -- Modifier keys for shortcuts:** Require a modifier key (Cmd on macOS, Ctrl on Linux/Windows) for all single-letter shortcuts. For example, Cmd+S for shuffle, Cmd+M for mute, Cmd+L for loop. Plain letter keys (A-Z) would then always perform alphabetical navigation in the library. This is the simpler approach but uses more modifier combinations and may conflict with OS-level shortcuts.

**Approach B -- Focus-based context switching:** Plain letter keys only perform alphabetical navigation when the library browser has focus (user clicked into it or tabbed to it). When focus is elsewhere (e.g., player controls, queue, or no specific focus), letter keys trigger shortcuts as they do today. This preserves the current shortcut behavior for users who are not actively browsing the library but requires clear focus indicators so users know which mode they are in.

Both approaches should be evaluated during implementation planning. The chosen solution must not break existing shortcut functionality from task-107.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Users can press letter keys (A-Z) to jump to artists starting with that letter in the library browser
- [ ] #2 Keyboard shortcuts (shuffle, mute, loop, etc.) remain fully functional and accessible
- [ ] #3 No ambiguity exists between alphabetical navigation and shortcut activation -- the system deterministically picks one behavior based on clear rules
- [ ] #4 Existing shortcut behavior from task-107 is not broken (Space, arrow keys, Cmd+F, Cmd+D, Cmd+S, Escape, Delete)
- [ ] #5 Focus state or modifier key requirement is clearly communicated to the user (e.g., visual focus ring on library, shortcut hints in settings)
- [ ] #6 Alphabetical jump scrolls the library list to the first artist matching the pressed letter
- [ ] #7 Pressing the same letter again cycles to the next artist starting with that letter
<!-- AC:END -->
