---
id: task-235
title: 'E2E: Accessibility (a11y) tests'
status: Done
assignee: []
created_date: '2026-01-28 05:40'
updated_date: '2026-01-29 22:36'
labels:
  - e2e
  - accessibility
  - P2
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add dedicated Playwright E2E tests for accessibility compliance including ARIA labels and keyboard navigation.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 All interactive elements have ARIA labels
- [x] #2 Keyboard-only navigation through main views works
- [x] #3 Focus management in modals is correct
- [x] #4 Screen reader announcements for state changes
- [x] #5 Tab order is logical
- [x] #6 Focus visible indicators present
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Implementation

Created `app/frontend/tests/accessibility.spec.js` with 41 Playwright E2E tests covering:

### ARIA Labels (14 tests)
- Player control buttons (play/pause, prev, next, shuffle, loop, mute)
- Volume slider and progress bar
- Sidebar navigation sections
- Create playlist and settings buttons
- Search input label
- Interactive element focusability

### Keyboard Navigation (6 tests)
- Tab navigation to player controls
- Tab navigation to sidebar sections
- Enter key activates focused elements
- Escape key clears selection
- Space key activates buttons
- Playlist list keyboard support

### Focus Management in Modals (4 tests)
- Settings modal focus handling
- Escape closes settings
- Context menu focus management
- Modal focus trapping verification

### Tab Order (3 tests)
- Logical reading order
- Sidebar before main content
- No focus traps

### Focus Visible Indicators (3 tests)
- Buttons have visible focus
- Input fields have visible focus
- Sidebar items have visible focus

### Screen Reader Announcements (5 tests)
- Toggle button state changes (shuffle, loop)
- Player time display accessibility
- Queue count updates
- Track selection state changes

### Color Contrast and Visual (2 tests)
- Text contrast verification
- Active state visual distinction

### Semantic Structure (4 tests)
- Landmark regions
- Heading structure
- List markup
- Button elements
<!-- SECTION:PLAN:END -->
