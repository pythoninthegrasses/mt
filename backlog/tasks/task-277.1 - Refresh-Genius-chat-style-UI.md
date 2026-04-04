---
id: TASK-277.1
title: Refresh Genius chat-style UI
status: In Progress
assignee: []
created_date: '2026-04-04 03:38'
updated_date: '2026-04-04 03:43'
labels:
  - feature
  - frontend
  - ui
  - genius
dependencies: []
documentation:
  - docs/genius.md
parent_task_id: TASK-277
priority: medium
ordinal: 2500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Update the Genius playlist creator interface so it feels like a modern chat-first surface instead of a utility panel. Simplify the layout, move the composer to the bottom of the screen, add the requested branded background treatment, introduce large animated example prompt copy, and update the keyboard shortcut so the interaction model matches the intended UX.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Genius view includes a large transparent glasses graphic in the background, angled at roughly 45 degrees, without obscuring primary controls or text.
- [ ] #2 The existing top-left descriptive block is removed from the Genius UI.
- [ ] #3 The Genius composer/chat input is positioned at the bottom of the view and remains usable on desktop and narrow layouts.
- [ ] #4 The UI displays slow animated large-format prompt copy with the text "make me a chill playlist from my library".
- [ ] #5 The generate keyboard shortcut uses Shift+Enter, any visible shortcut hint reflects Shift+Enter, and Cmd+Enter no longer triggers generation.
- [ ] #6 Frontend test coverage and any affected Genius documentation or user-facing copy are updated for the new layout and shortcut behavior.
<!-- AC:END -->
