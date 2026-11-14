---
id: TASK-382
title: Implement Queue Next functionality
status: Done
assignee: []
created_date: '2025-10-12 07:56'
updated_date: '2025-10-20 02:19'
labels: []
dependencies: []
ordinal: 1000
---

## Description

Add Cmd-D shortcut and Right click > Queue next option to add tracks to queue after current track

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Cmd-D adds selected track to queue next
- [x] #2 Right click menu has Queue next option
- [x] #3 Queued tracks play after current track finishes
<!-- AC:END -->

## Implementation Notes

Implementation complete. Added Cmd-D keyboard shortcut in core/gui.py that calls existing on_context_play_next() method. Created settings.toml for configurable keybindings with cross-platform support (Command/Control). Right-click menu and queue insertion were already implemented and working.
