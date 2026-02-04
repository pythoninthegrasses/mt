---
id: task-251
title: Disable column width animation - instant sizing at startup and view switch
status: Done
assignee: []
created_date: '2026-02-03 07:16'
updated_date: '2026-02-04 05:10'
labels:
  - frontend
  - ux
  - polish
  - columns
dependencies: []
priority: low
ordinal: 17000
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
- [x] #1 Column widths are applied instantly at startup without animation
- [x] #2 Column widths are applied instantly when switching views without animation
- [x] #3 Column width preferences are still persisted and restored correctly
- [x] #4 Manual column resize drag interaction remains smooth (if applicable)
- [x] #5 No CSS transition artifacts visible during column sizing
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Implementation Approach

The issue was addressed by adding explicit CSS `transition-property` rules that exclude grid layout properties from being transitioned. This ensures that when `grid-template-columns` changes (at startup, view switch, or column resize), the widths are applied instantly rather than animating.

### CSS Changes Made (styles.css)

Added within `@layer components`:

```css
/* Disable grid layout animations - instant column sizing at startup and view switch */
[data-testid="library-header"] {
  transition-property: background-color, border-color, color, fill, stroke, opacity, box-shadow;
  transition-duration: 0.15s;
  transition-timing-function: ease;
}

.track-list > .grid {
  transition-property: background-color, border-color, color, fill, stroke, opacity, box-shadow, transform;
  transition-duration: 0.15s;
  transition-timing-function: ease-out;
}
```

### Key Design Decisions

1. **Header container**: Only allows visual property transitions (no transform needed)
2. **Track rows**: Allows `transform` transitions to preserve drag-and-drop row shifting animations
3. **Excludes**: `width`, `grid-template-columns`, and other layout properties that could cause column width animation

### Verified Behavior

- Column resize by dragging works correctly
- Column auto-fit on double-click works correctly  
- Column visibility toggle works correctly
- Column reorder by dragging works correctly
- Track row drag-and-drop shift animations preserved
- All 67+ related Playwright E2E tests pass
<!-- SECTION:PLAN:END -->
