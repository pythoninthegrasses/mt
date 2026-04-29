---
id: TASK-338
title: 'fix: remove spurious async from playContextQuery in queue.js'
status: To Do
assignee: []
created_date: '2026-04-29 19:53'
labels:
  - bug
  - lint
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`app/frontend/js/api/queue.js:153` declares `async playContextQuery` but the body contains no `await` — it just returns the `tauriInvoke(...)` Promise directly. Deno lint flags this as `require-await` and fails `task lint` / `deno lint`. Fix: remove the `async` keyword. The return type stays `Promise<...>` because `tauriInvoke` already returns a Promise.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 deno lint passes with no require-await error in queue.js
- [ ] #2 task lint passes
<!-- AC:END -->
