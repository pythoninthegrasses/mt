---
id: TASK-305
title: Fix 6 pre-existing E2E test failures in statistics and lastfm specs
status: Done
assignee: []
created_date: '2026-03-31 05:38'
updated_date: '2026-03-31 05:49'
labels:
  - testing
  - e2e
  - bug
dependencies: []
references:
  - app/frontend/tests/statistics.spec.js
  - app/frontend/tests/lastfm.spec.js
priority: medium
ordinal: 750
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
- [x] #1 All 5 statistics.spec.js tests pass
- [x] #2 lastfm.spec.js 'should require authentication for import' test passes
- [x] #3 No other tests regress (full suite green minus any unrelated pre-existing failures)
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Summary

Fixed all 6 pre-existing E2E test failures across `statistics.spec.js` (5 tests) and `lastfm.spec.js` (1 test). Root causes were stale CSS selectors, locale formatting mismatch, a `<select>` changed to custom dropdown, and an overly broad toast text filter.

### Changes

**`statistics.spec.js`** (5 fixes):
1. `overview cards render with data`: Changed expected text from `'1234'` to `'1,234'` (UI uses `toLocaleString()`)
2. `top artists list renders`: Changed selector `.text-sm.truncate` → `.truncate` (HTML uses `text-[13px]` not `text-sm`)
3. `plays-over-time chart renders`: Changed selector `.tabular-nums.w-20` → `.tabular-nums.w-14` (HTML uses `w-14`)
4. `genre breakdown renders`: Changed selector `.text-sm.truncate` → `.truncate` (same as #2)
5. `date range filter invokes with correct range`: Rewrote from `selectOption('Last7Days')` (native select) to click-based interaction (custom dropdown button)

**`lastfm.spec.js`** (1 fix):
6. `should require authentication for import`: Changed toast filter from `/failed/i` to `/Failed to import loved tracks/i` to avoid strict mode violation when multiple failure toasts are present

### Verification
- Full E2E suite: **728 passed, 2 skipped, 0 failures**
<!-- SECTION:FINAL_SUMMARY:END -->
