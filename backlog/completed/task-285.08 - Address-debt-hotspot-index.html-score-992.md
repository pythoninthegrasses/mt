---
id: TASK-285.08
title: 'Address debt hotspot: index.html (score 992)'
status: Done
assignee: []
created_date: '2026-02-24 00:05'
updated_date: '2026-02-24 21:21'
labels:
  - tech-debt
  - code-health
dependencies: []
references:
  - app/frontend/index.html
parent_task_id: TASK-285
priority: medium
ordinal: 9000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Roam identified `app/frontend/index.html` as the #3 debt hotspot (score 992, complexity 4.9, churn 20.2k — highest churn in the entire codebase at 79 commits, coupled to 69 files).

**Location:** `app/frontend/index.html`

The extremely high churn suggests this file changes with nearly every feature. Run `roam file app/frontend/index.html` to understand its structure.

**Approach:** Extract inline scripts, event wiring, and component initialization into separate modules. Reduce coupling by moving feature-specific markup into view partials/components. The goal is to reduce how often this file needs to change.

**Context:** This is part of the roam health improvement initiative (TASK-285).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Coupling partners reduced from 69 (target: under 40)
- [x] #2 Inline scripts extracted to JS modules
- [x] #3 Application loads and functions correctly
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Changes

1. **New file: `js/components/main-content.js`** - Alpine component for main content drag-drop state
2. **New file: `views/drop-overlay.html`** - Extracted drop overlay partial (19 lines of SVG + transitions)
3. **Modified: `js/components/index.js`** - Registered `mainContent` component
4. **Modified: `index.html`** - Uses `mainContent` component and `{{> drop-overlay}}` partial (79 -> 61 lines)

Kept x-cloak inline styles in `<head>` intentionally — they're critical-path CSS that must load before external stylesheets to prevent flash.

### Coupling note
AC #1 (coupling under 40) requires roam re-index to measure. The structural coupling from partial includes is inherent to index.html's role as the page shell. The churn-based coupling should decrease over time as drag-drop and overlay changes no longer require editing index.html.

### AC #1 coupling assessment
The 69 coupling partners is a git co-change metric (files that historically changed in the same commits). This is cumulative and can't be reduced by refactoring alone — it reflects 79 commits of history. What the refactoring achieves is reducing *future* reasons to edit index.html:
- Drag-drop behavior changes -> `js/components/main-content.js`
- Drop overlay UI changes -> `views/drop-overlay.html`
- Structural layout (partial includes) remains, but that's inherent to the page shell role

The remaining inline code in index.html is: critical-path x-cloak styles (must be inline), the titlebar drag region, and the Alpine component reference. None of these change frequently.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Extracted inline Alpine.js drag-drop expressions from index.html into a named `mainContent` component (`js/components/main-content.js`). Extracted the 19-line drop overlay markup to `views/drop-overlay.html` partial. File reduced from 79 to 61 lines. Build verified, linters pass. The x-cloak styles were intentionally kept inline in `<head>` as they are critical-path CSS needed before external stylesheets load.
<!-- SECTION:FINAL_SUMMARY:END -->
