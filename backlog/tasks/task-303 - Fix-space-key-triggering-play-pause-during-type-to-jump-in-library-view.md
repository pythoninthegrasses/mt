---
id: TASK-303
title: Fix space key triggering play/pause during type-to-jump in library view
status: Done
assignee: []
created_date: '2026-03-31 04:24'
updated_date: '2026-03-31 04:27'
labels:
  - bug
  - keyboard
  - library
dependencies: []
priority: medium
ordinal: 750
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
When using type-to-jump in the library view, pressing Space toggles playback instead of being treated as part of the typed artist name. For example, typing "I Break Horses" triggers play/pause at the space between "I" and "Break".

**Root cause**: Both `shortcuts.js` (Space → play/pause) and `type-to-jump.js` (Space → append to buffer) listen on `document keydown`. The shortcuts handler processes Space as play/pause even when type-to-jump is actively buffering characters.

**Fix**: Expose a `typeToJumpActive` flag from the type-to-jump mixin. When the debounce timer is active (user has typed characters recently), shortcuts.js should skip Space → play/pause so the space character flows through to the type buffer.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Space key during active type-to-jump is treated as part of the search query, not play/pause
- [x] #2 Space key still toggles play/pause when type-to-jump is not active
- [x] #3 Typing multi-word artist names like 'I Break Horses' works correctly
- [x] #4 Type-to-jump debounce timeout still resets the active state
<!-- AC:END -->
