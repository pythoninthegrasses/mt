---
id: TASK-387
title: Fix property-based test for path normalization with double slashes
status: Done
assignee:
  - '@claude'
created_date: '2025-10-20 13:29'
updated_date: '2025-10-20 20:05'
labels: []
dependencies: []
ordinal: 500
---

## Description

The test test_normalize_path_strips_leading_trailing_braces in tests/test_props_files.py fails with Hypothesis-generated input '0//0' because Python's Path normalizes double slashes to single slashes (e.g., '0//0' becomes '0/0'), but the test assertion expects exact string preservation. This is not a bug in normalize_path - it's correct Path behavior - but the test needs to account for this normalization.

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Update test assertion to compare normalized paths instead of raw strings
- [x] #2 Verify test passes with Hypothesis falsifying example: inner_path='0//0'
- [x] #3 Run full property-based test suite to ensure no regressions
<!-- AC:END -->
