---
id: task-251
title: Disable column width animation - instant sizing at startup and view switch
status: To Do
assignee: []
created_date: '2026-02-03 07:16'
labels:
  - frontend
  - ux
  - polish
  - columns
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

Column widths in table views (Library, Now Playing, etc.) animate when resizing. This animation occurs:
1. At app startup when columns are sized
2. When switching between views

This animation is undesirable - columns should snap to their correct widths immediately.

## Expected Behavior

- Column widths should be applied instantly without CSS transitions/animations
- Persisted column width preferences should still be retained and applied
- No visible column "sliding" or "growing" effect
- Applies to both:
  - Initial load/startup
  - View navigation (e.g., switching from Music to Now Playing)

## Technical Considerations

- Check for CSS transitions on column width properties (e.g., `transition: width`, `transition: all`)
- May need to conditionally disable transitions during initialization
- Ensure column width persistence still works (just without animation)
- Consider if any transitions are intentionally added for resize drag handles (those may be acceptable)

## Related

- This is separate from the startup flash issue but may share similar timing/initialization concerns
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Column widths are applied instantly at startup without animation
- [ ] #2 Column widths are applied instantly when switching views without animation
- [ ] #3 Column width preferences are still persisted and restored correctly
- [ ] #4 Manual column resize drag interaction remains smooth (if applicable)
- [ ] #5 No CSS transition artifacts visible during column sizing
<!-- AC:END -->
