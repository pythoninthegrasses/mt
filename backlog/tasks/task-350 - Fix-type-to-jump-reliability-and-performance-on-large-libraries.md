---
id: TASK-350
title: Fix type-to-jump reliability and performance on large libraries
status: To Do
assignee: []
created_date: '2026-05-25 19:59'
updated_date: '2026-05-25 20:00'
labels:
  - performance
  - library
  - type-to-jump
  - reliability
dependencies:
  - TASK-350.1
  - TASK-350.2
  - TASK-350.3
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Umbrella task for restoring reliable type-to-jump behavior on libraries of 10k+ tracks. On a 39,697-track library, pressing letter keys (j, i, n, End, etc.) currently either fails to jump or leaves a blank light-grey viewport for 5-10 seconds. Root causes:

1. `find_sort_offset` in `crates/mt-tauri/src/db/library.rs:236` uses `ROW_NUMBER() OVER (ORDER BY ...)` across the filtered set and `LIKE prefix%`, effectively ranking the whole library on every keystroke.
2. Frontend jump flow in `app/frontend/js/mixins/type-to-jump.js:142` scrolls before the target page is guaranteed loaded, and can race with concurrent reload state.
3. `visibleTracks` shimmer/placeholder fallback in `app/frontend/js/components/library-browser.js:362-410` can outlive the fetch and leaves a blank viewport.

Locked decisions:
- Persisted normalized sort key in DB (not computed per query).
- Bidirectional keyset pagination in v1 (forward + reverse).

Split into three phases (separate child tasks):
- Phase 1: Reliability guardrails on the frontend (debounce, generation cancellation, never blank).
- Phase 2: Persisted artist_sort_key column + indexed prefix lookup replacing ROW_NUMBER scan.
- Phase 3: Bidirectional keyset pagination and anchor-based jump replacing offset-based browsing.

Each phase ships behind a feature flag and is independently rollbackable. Success criteria for the umbrella task:
- No 5-10s blank viewport during rapid jump stress (Playwright stress test passes).
- Prefix resolution p95 < 100ms on 40k library.
- No unbounded growth in page cache or CPU spikes under rapid key input.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 All three child tasks are complete (Phase 1, 2, 3)
- [ ] #2 Stress test: rapid typing of j/i/n/End on 40k library never produces a blank viewport > 250ms
- [ ] #3 Prefix lookup p95 < 100ms on 40k library
- [ ] #4 Library memory + CPU profile stays within bounds under sustained jump/scroll input
- [ ] #5 Feature flags (jump_reliability_guard, indexed_prefix_lookup, keyset_pagination_bidirectional) can each be disabled independently at runtime
<!-- AC:END -->
