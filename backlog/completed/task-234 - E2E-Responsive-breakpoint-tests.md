---
id: task-234
title: 'E2E: Responsive breakpoint tests'
status: Done
assignee: []
created_date: '2026-01-28 05:40'
updated_date: '2026-01-29 22:22'
labels:
  - e2e
  - ui
  - responsive
  - P2
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add Playwright E2E tests for responsive layout behavior at different viewport sizes.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Sidebar auto-collapses at narrow widths
- [x] #2 Player controls adapt to small screens
- [x] #3 Library columns hide appropriately at breakpoints
- [x] #4 Touch-friendly targets at mobile sizes
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementation Notes

### Tests Added
- `app/frontend/tests/responsive-breakpoints.spec.js` (22 passing tests)

### Coverage
- **Sidebar Behavior**: Tests collapse/expand at various viewport sizes
- **Player Controls Layout**: Tests visibility and click target sizes
- **Library Columns**: Tests column visibility toggling via Alpine state
- **Touch Targets**: Tests minimum button/slider sizes
- **Layout Integrity**: Tests no horizontal overflow, flex proportions

### Viewport Sizes Tested
- 4K UHD (3840x2160)
- QHD (2560x1440)
- Desktop large (1920x1080)
- Desktop (1624x1057 - app minimum)
- Desktop small (1366x768)
<!-- SECTION:NOTES:END -->
