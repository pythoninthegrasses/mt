---
id: TASK-350.3
title: 'Phase 3: Bidirectional keyset pagination + anchor-based jump'
status: To Do
assignee: []
created_date: '2026-05-25 20:00'
updated_date: '2026-11-15T05:40:00Z'
labels:
  - performance
  - library
  - type-to-jump
  - backend
  - frontend
  - pagination
  - feature-freeze
dependencies:
  - TASK-350.2
  - TASK-393.28
parent_task_id: TASK-350
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Replace deep offset scans with bidirectional keyset browsing and prefix jump anchors, behind keyset_pagination_bidirectional. Use a stable ordering tuple with an ID tiebreaker for each supported sort. Zig owns forward/reverse queries and anchors; frontend pages become anchor-linked while retaining a bounded LRU and independent feature rollback. Preserve the offset API as the flag-off behavior within the Zig engine, not a resurrected Rust fallback. Scope participating sorts explicitly; this task is a post-migration pagination feature, not required for the existing read-path port TASK-393.5. Scheduling: feature work is frozen until TASK-393.28 verifies Zig-first completion; TASK-393 is the initiative. Do not start this task during the freeze or implement it as a side effect of a migration task. Bugfixes require their own explicit scope. When released, read TASK-369.5's ownership ADR and then-current APIs, research the current system and record a bounded plan. Zig owns domain policy and persistence; Rust is only the Tauri/native or named-library adapter. Existing behavior remains the migration baseline until this feature is scheduled.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A regression test in Zig proves forward and reverse keyset boundary rows under tied keys, and fails before the implementation change
- [ ] #2 Failing Playwright test first: long-session random jump/scroll on 40k library never blanks viewport
- [ ] #3 Keyset API supports both forward (after_key, after_id) and reverse (before_key, before_id)
- [ ] #4 Jump-anchor endpoint returns a stable anchor tuple for a prefix and integrates with Phase 2 indexed seek
- [ ] #5 Frontend stores switch to anchor-linked pages when keyset_pagination_bidirectional is enabled
- [ ] #6 LibraryPageCache continues to honor its LRU cap with the new key format
- [ ] #7 All previously-green relevant Zig, frontend and retained Rust adapter tests pass; actual UI interactions cover jump/scroll wiring
- [ ] #8 Feature flag keyset_pagination_bidirectional can revert to offset-based browsing at runtime
- [ ] #9 Phase 2 (TASK-350.2) is complete
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-11-14 maintainer approved a feature freeze until the Zig refactor is complete. TASK-393.28 is now an explicit scheduling dependency. Any earlier Rust-domain implementation guidance is superseded by Zig-first ownership; preserved native/Tauri/library integration remains Rust where justified.
<!-- SECTION:NOTES:END -->
