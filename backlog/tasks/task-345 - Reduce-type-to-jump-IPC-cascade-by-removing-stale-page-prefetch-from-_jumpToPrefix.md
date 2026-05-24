---
id: TASK-345
title: >-
  Reduce type-to-jump IPC cascade by removing stale page prefetch from
  _jumpToPrefix
status: Done
assignee: []
created_date: '2026-05-24 18:46'
labels:
  - library
  - performance
dependencies: []
references:
  - app/frontend/js/stores/library.js
  - app/frontend/js/mixins/type-to-jump.js
  - app/frontend/__tests__/type-to-jump.test.js
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Type-to-jump was triggering 5-7 `library_get_all` IPC calls per typing session instead of ≤2. Root causes:\n\n1. `_jumpToPrefix` in library.js called `_ensurePage(pageIndex)` unconditionally before returning the offset. Since `_jumpViaBackend` checks `myGen !== this._jumpGen` and returns early for stale jumps, the visual path (scroll/select) was correctly cancelled — but `_ensurePage` had already fired, leaving an in-flight page fetch with no consumer.\n\n2. With `_pageSize: 500`, successive keystrokes ("m" → "me" → "men") resolved to different pages (16, 21, 20), each triggering its own IPC. Raising to 1500 collapses nearby prefixes into fewer distinct pages.\n\nFix:\n- Remove `_ensurePage(pageIndex)` from `_jumpToPrefix`. The only `_fetchPage` call is now the explicit one in `_jumpViaBackend` after the `myGen` gen check.\n- Raise `_pageSize` from 500 to 1500. DB cost is dominated by `strip_sort_prefix` UDF + filesort (invariant in LIMIT); per-page time grows ~25-50% for 3x more rows. RAM impact is transient spike only; steady-state unchanged.\n\nExpected result: ≤2 IPC calls per jump (target page + `+1` neighbor from visibleTracks prefetch), down from 5-7.
<!-- SECTION:DESCRIPTION:END -->
