---
id: TASK-305
title: Fix 6 pre-existing E2E test failures in statistics and lastfm specs
status: To Do
assignee: []
created_date: '2026-03-31 05:38'
labels:
  - testing
  - e2e
  - bug
dependencies: []
references:
  - app/frontend/tests/statistics.spec.js
  - app/frontend/tests/lastfm.spec.js
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
6 E2E tests are failing that predate the lyrics layout fix (commit introducing now-playing overflow fix). These need to be updated to match current UI implementation.

**Statistics Dashboard (5 failures in `tests/statistics.spec.js`):**
- `overview cards render with data` (line 126) - statistics view navigation/rendering issue
- `top artists list renders` (line 137) - statistics view navigation/rendering issue
- `plays-over-time chart renders` (line 150) - statistics view navigation/rendering issue
- `genre breakdown renders` (line 161) - statistics view navigation/rendering issue
- `date range filter invokes with correct range` (line 174) - test uses `selectOption()` on a `<button>` element (date range filter was changed from `<select>` to custom dropdown button), needs rewrite to click button + select from dropdown

**Last.fm (1 failure in `tests/lastfm.spec.js`):**
- `should require authentication for import` (line 1196) - strict mode violation: locator `[data-testid="toast-container"] div` filtered by `/failed/i` resolves to 2 elements (both "Failed to load statistics" and "Failed to import loved tracks" toasts). Fix: use more specific text filter like `hasText: 'Failed to import loved tracks'`
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 All 5 statistics.spec.js tests pass
- [ ] #2 lastfm.spec.js 'should require authentication for import' test passes
- [ ] #3 No other tests regress (full suite green minus any unrelated pre-existing failures)
<!-- AC:END -->
