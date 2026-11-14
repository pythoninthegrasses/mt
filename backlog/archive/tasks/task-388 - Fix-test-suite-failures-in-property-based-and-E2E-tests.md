---
id: TASK-388
title: Fix test suite failures in property-based and E2E tests
status: Done
assignee: []
created_date: '2025-10-28 05:11'
updated_date: '2025-11-03 04:41'
labels: []
dependencies:
  - task-003
priority: high
ordinal: 1250
---

## Description

Multiple test failures discovered in the test suite that need to be investigated and fixed. These failures may be related to recent repeat functionality changes.

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 All property-based tests in test_props_player_core.py pass
- [ ] #2 test_next_previous_navigation E2E test passes
- [ ] #3 Seek position tests correctly handle VLC media state
- [ ] #4 Loop toggle tests properly verify state changes
- [ ] #5 Time-related tests handle uninitialized media gracefully
<!-- AC:END -->

## Implementation Notes

Duplicate of task-087. All work consolidated into task-087.
