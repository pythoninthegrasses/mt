---
id: TASK-285.13
title: Reduce api.js god component degree and bottleneck betweenness
status: In Progress
assignee: []
created_date: '2026-02-24 22:40'
updated_date: '2026-02-24 22:42'
labels:
  - tech-debt
  - code-health
  - architecture
dependencies:
  - TASK-285.12
references:
  - app/frontend/js/api.js
parent_task_id: TASK-285
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`api.js` is both the top god component (degree 35) and the top bottleneck (betweenness 1509) in the frontend. Every component imports it for IPC calls, making it a single point of coupling.

**Current state:** `api` is a monolithic object exporting namespaced methods (api.library.*, api.queue.*, api.playlists.*, api.favorites.*, etc.). All 35+ consumers import the entire object even when they only need one namespace.

**Approach options:**
1. **Split by domain** — Break `api.js` into `api/library.js`, `api/queue.js`, `api/playlists.js`, etc. Consumers import only what they need. This reduces degree (fewer edges per module) and betweenness (paths no longer all flow through one node).
2. **Re-export facade** — Keep `api.js` as a re-export barrel but move implementations to domain files. Consumers can import from either. Reduces betweenness while preserving the convenience import.

Option 1 is more impactful for the health score. Option 2 is lower risk.

Run `roam impact api` and `roam uses api` to see all consumers before refactoring.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 api.js god component degree reduced below 20
- [ ] #2 api.js bottleneck betweenness reduced below 500
- [ ] #3 All frontend tests pass
- [ ] #4 No behavioral changes
<!-- AC:END -->
