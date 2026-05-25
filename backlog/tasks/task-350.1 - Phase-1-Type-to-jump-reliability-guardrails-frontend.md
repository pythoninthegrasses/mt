---
id: TASK-350.1
title: 'Phase 1: Type-to-jump reliability guardrails (frontend)'
status: To Do
assignee: []
created_date: '2026-05-25 20:00'
labels:
  - performance
  - library
  - type-to-jump
  - frontend
dependencies: []
parent_task_id: TASK-350
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Make type-to-jump resilient on the frontend before any backend changes. Ships behind feature flag `jump_reliability_guard`.

Scope:
- Debounce/coalesce key presses (150-200ms window) in `app/frontend/js/mixins/type-to-jump.js`.
- Strict generation cancellation: every jump request has a monotonically increasing token; stale responses are discarded.
- Never blank the viewport while a jump fetch is pending. Keep stale overlapping rows visible; only shimmer rows that are truly unknown.
- Single authoritative jump-finalization path using `_isJumping` / `_jumpingPrefix` to remove racey clears between jump and section reload.
- Non-blocking timeout fallback for slow backend responses (cancel jump, restore previous scroll/state).

Files:
- `app/frontend/js/mixins/type-to-jump.js`
- `app/frontend/js/components/library-browser.js` (placeholder/shimmer behavior around lines 362-410)
- `app/frontend/js/mixins/virtual-scroll.js` (`_scrollToRowIndex`, `scrollToTrack`)

Out of scope (deferred to Phase 2/3):
- Changing the backend `find_sort_offset` query.
- Pagination model changes.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Failing Vitest first: rapid key supersession test where only the latest generation finalizes
- [ ] #2 Failing Playwright stress test first: rapid typing of j/i/n/End shows no fully-blank viewport > 250ms
- [ ] #3 Debounce + generation token implemented in type-to-jump.js
- [ ] #4 Stale jump responses are discarded without mutating scroll state
- [ ] #5 library-browser.js retains last-known visible rows during pending jump; shimmer only for truly unknown rows
- [ ] #6 Feature flag jump_reliability_guard can disable all new behavior at runtime
- [ ] #7 All previously-green Vitest + Playwright tests still pass
<!-- AC:END -->
