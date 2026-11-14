---
id: TASK-375
title: Ignore common artist prefixes in type-to-jump
status: Done
assignee: []
created_date: '2025-10-12 02:32'
updated_date: '2025-10-12 02:38'
labels: []
dependencies: []
---

## Description

When using type-to-jump in the library, common artist prefixes like 'The', 'A', 'Le', 'La' should be ignored for matching. For example, typing 'B' should match 'The Beatles'.

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Type-to-jump ignores 'The' prefix
- [x] #2 Type-to-jump ignores 'A' prefix
- [x] #3 Type-to-jump ignores 'Le' prefix
- [x] #4 Matching is case-insensitive
- [x] #5 Original display names remain unchanged
<!-- AC:END -->

## Implementation Notes

Implemented prefix-stripping function that removes 'The', 'A', 'Le', and 'La' prefixes for type-to-jump matching. Special handling ensures 'La's' (with apostrophe) is not treated as a prefix. Case-insensitive matching was already implemented. Original display names remain unchanged - only matching logic is affected.
