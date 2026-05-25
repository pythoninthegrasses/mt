---
id: TASK-350.3
title: 'Phase 3: Bidirectional keyset pagination + anchor-based jump'
status: To Do
assignee: []
created_date: '2026-05-25 20:00'
labels:
  - performance
  - library
  - type-to-jump
  - backend
  - frontend
  - pagination
dependencies:
  - TASK-350.2
parent_task_id: TASK-350
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Eliminate offset-based deep scans from browse/jump paths entirely. Ships behind feature flag `keyset_pagination_bidirectional`.

Locked decision: bidirectional keyset (forward + reverse) in v1.

Scope:
- New keyset API in `crates/mt-tauri/src/library/commands.rs`:
  - forward: `after_key`, `after_id`, `limit`
  - reverse: `before_key`, `before_id`, `limit`
- Use stable ordering tuple `(sort_key, id)` consistently across all sort modes that participate in keyset browsing.
- New jump-anchor endpoint that returns an anchor tuple for a typed prefix (uses Phase 2's indexed seek).
- Frontend page model becomes anchor-linked pages instead of global-offset pages:
  - `app/frontend/js/stores/library.js` (`_trackPages`, page key derivation, restore/snapshot)
  - `app/frontend/js/utils/library-operations.js` (`loadOp` fetches via anchor cursors)
  - `app/frontend/js/mixins/type-to-jump.js` (jump = fetch anchor -> load page around anchor)
- Maintain the existing bounded LRU page cache (`LibraryPageCache`) with the same cap discipline.
- Old offset-based path remains available behind the flag.

Files:
- `crates/mt-tauri/src/db/library.rs`
- `crates/mt-tauri/src/library/commands.rs`
- `app/frontend/js/stores/library.js`
- `app/frontend/js/utils/library-operations.js`
- `app/frontend/js/utils/library-page-cache.js` (key format adjustments if needed)
- `app/frontend/js/mixins/type-to-jump.js`
- `app/frontend/js/api/library.js`

Out of scope:
- Sort modes that do not participate in keyset browsing this round (document explicitly).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Failing Rust test first: forward and reverse keyset queries return correct boundary rows under tie conditions
- [ ] #2 Failing Playwright test first: long-session random jump/scroll on 40k library never blanks viewport
- [ ] #3 Keyset API supports both forward (after_key, after_id) and reverse (before_key, before_id)
- [ ] #4 Jump-anchor endpoint returns a stable anchor tuple for a prefix and integrates with Phase 2 indexed seek
- [ ] #5 Frontend stores switch to anchor-linked pages when keyset_pagination_bidirectional is enabled
- [ ] #6 LibraryPageCache continues to honor its LRU cap with the new key format
- [ ] #7 All previously-green Vitest + Playwright + Rust tests still pass
- [ ] #8 Feature flag keyset_pagination_bidirectional can revert to offset-based browsing at runtime
- [ ] #9 Phase 2 (TASK-350.2) is complete
<!-- AC:END -->
