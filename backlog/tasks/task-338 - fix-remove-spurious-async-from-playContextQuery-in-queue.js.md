---
id: TASK-338
title: 'fix: remove spurious async from playContextQuery in queue.js'
status: Done
assignee: []
created_date: '2026-04-29 19:53'
updated_date: '2026-04-29 19:55'
labels:
  - bug
  - lint
dependencies: []
priority: low
ordinal: 6500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`app/frontend/js/api/queue.js:153` declares `async playContextQuery` but the body contains no `await` — it just returns the `tauriInvoke(...)` Promise directly. Deno lint flags this as `require-await` and fails `task lint` / `deno lint`. Fix: remove the `async` keyword. The return type stays `Promise<...>` because `tauriInvoke` already returns a Promise.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 deno lint passes with no require-await error in queue.js
- [x] #2 task lint passes
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Removed spurious `async` keyword from `playContextQuery` in `app/frontend/js/api/queue.js:153`. The function body had no `await` — it directly returns the Promise from `tauriInvoke`. Deno lint `require-await` error is resolved.
<!-- SECTION:FINAL_SUMMARY:END -->
