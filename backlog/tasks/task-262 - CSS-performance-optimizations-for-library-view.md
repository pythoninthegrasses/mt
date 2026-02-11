---
id: task-262
title: CSS performance optimizations for library view
status: Done
assignee: []
created_date: '2026-02-11 03:25'
updated_date: '2026-02-11 04:33'
labels:
  - performance
  - frontend
  - css
dependencies: []
priority: medium
ordinal: 12468.75
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Secondary performance issues in the library view that compound the DOM overhead problem. These are lower-effort fixes that supplement virtual scrolling (task for that created separately).

## Issues

### 1. Excessive CSS transitions on track rows
`.track-list > .grid` in styles.css (line 339) applies transitions for `background-color, border-color, color, fill, stroke, opacity, box-shadow, transform` to every track row. Only `transform` is needed (for playlist drag-drop). The rest force the browser to maintain animation-ready state on thousands of elements.

**Fix**: Strip transition-property to just `transform`.

### 2. `animate-spin` CSS animation runs when hidden
The loading spinner at `library.html:111` uses `animate-spin` class inside an `x-show` block. CSS animations continue running at 60fps even when the element is `display: none` in WebKit. The same issue exists in `modals.html:197` and `modals.html:369`.

**Fix**: Use `x-if` instead of `x-show` for the spinner containers, or conditionally apply the `animate-spin` class.

### 3. Missing CSS containment properties
The track list and individual rows lack `contain` and `content-visibility` declarations. Adding these hints allows the browser to skip layout/paint/style computation for off-screen or contained elements.

**Fix**: Add `contain: layout style` to `.track-list` and `content-visibility: auto` + `contain-intrinsic-block-size: 34px` to track rows.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Track row CSS transitions limited to transform only
- [x] #2 Loading spinners don't consume CPU when hidden
- [x] #3 CSS containment properties added to track list elements
- [x] #4 No visual regressions in library view
- [x] #5 task test:e2e passes
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Verification on CM5 (ARM64, WebKitGTK 2.50.4)

All three fixes verified live on Compute Module 5 via Tauri MCP bridge (SSH tunnel port 9223).

### Fix 1: Transition stripping ✅
- `transition-property: transform` — confirmed, was previously 8 properties
- Eliminates animation-ready state maintenance on 301 track rows

### Fix 2: Spinner x-show → x-if ✅  
- 0 `.animate-spin` elements in DOM when not loading
- Changed in library.html, modals.html (metadata spinner + global overlay)

### Fix 3a: CSS containment ✅
- `.track-list` has `contain: layout style` — limits style recalc scope
- Functional in WebKitGTK 2.50.4

### Fix 3b: content-visibility: auto ⚠️ NOT FUNCTIONAL
- Property IS parsed and computed correctly (`content-visibility: auto`, `contain-intrinsic-block-size: auto 34px`)
- But WebKitGTK 2.50.4 does NOT implement the skip-rendering optimization
- `checkVisibility({ contentVisibilityAuto: true })` returns true for all 301 rows even when scrolled to middle (scrollTop=5000, viewport=627px, content=10233px)
- Scroll performance identical with/without the property (~3ms per step)
- **Kept as progressive enhancement** — harmless, may benefit future WebKitGTK or macOS WebKit (Safari 18+)

### CM5 Performance Baseline (301 tracks, 35,056 DOM nodes)
- Full style recalc: 225ms
- Hover toggle 50 rows: 13ms  
- DOM nodes per track row: 116
- Scroll step: ~3ms
<!-- SECTION:NOTES:END -->
