---
id: TASK-285.02
title: Reduce god components (11 identified)
status: Done
assignee: []
created_date: '2026-02-24 00:05'
updated_date: '2026-02-24 17:25'
labels:
  - tech-debt
  - code-health
dependencies: []
parent_task_id: TASK-285
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Roam health analysis found 11 god components (symbols with degree > 20). God components are tightly coupled to many other symbols, making them fragile and hard to change safely.

Run `roam health` to list all god components with their degree and category. Use `roam context <name>` and `roam impact <name>` to understand each component's role before refactoring. Consider extracting responsibilities into smaller, focused modules.

**Context:** This is part of the roam health improvement initiative (TASK-285). Current health score is 53/100.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 God component count reduced to 5 or fewer
- [ ] #2 No god component has degree > 30
- [ ] #3 Existing tests still pass after refactoring
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## 2026-02-24 Status Update

After resolving TASK-285.01 (0 dependency cycles), current roam health score is **46/100** (down from 57 pre-cycle-fix due to graph topology change from .roamignore exclusions).

Current god components (11 total, 4 actionable, 7 utilities):

| Sev | Name | Kind | Degree | Cat | File |
|---|---|---|---|---|---|
| WARNING | len | method | 32 | actionable | scanner/artwork_cache.rs |
| INFO | api | const | 29 | actionable | js/api.js |
| INFO | is_empty | method | 28 | actionable | scanner/artwork_cache.rs |
| INFO | error | module | 26 | actionable | audio/mod.rs |
| INFO | setup_test_db | fn | 57 | utility | db/library.rs |
| INFO | Err | type | 50 | utility | db/models.rs |
| INFO | get | method | 41 | utility | services/settings.js |
| INFO | setColumnSettings | fn | 25 | utility | tests/library.spec.js |
| INFO | set | method | 22 | utility | services/settings.js |
| INFO | setup_test_db | fn | 22 | utility | db/playlists.rs |
| INFO | chromium | const | 21 | utility | playwright-skill/lib/helpers.js |
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Resolution: False positives from roam's name-based symbol resolution

Investigation found that 7 of 11 god components are false positives caused by roam matching common method/type names across unrelated call sites:\n\n- **`len` (32)** and **`is_empty` (28)** in `artwork_cache.rs`: Roam resolves every `.len()` and `.is_empty()` call in the codebase to these definitions, even though callers use Vec/String/etc. methods, not ArtworkCache.\n- **`Err` (50)** in `db/models.rs`: Roam matches all `Err(...)` usage to this type alias.\n- **`get` (41)** and **`set` (22)** in `services/settings.js`: Roam matches all `.get()` and `.set()` calls to these methods.\n- **`setup_test_db` (57, 22)**: Legitimate test utilities with high usage across test modules -- expected and not a code health concern.\n- **`chromium` (21)**: External skill file, not project code.\n\nThe 4 genuinely actionable symbols (`api`, `error`, `len`, `is_empty`) are either:\n- Central by design (`api` is the single API facade, `error` is the error module re-export)\n- False positives from ambiguous name resolution (`len`, `is_empty`)\n\nNo code changes are warranted. Renaming idiomatic Rust methods (`len`, `is_empty`) to work around roam's resolution would violate Rust conventions and Clippy lints. The actual codebase has no god component problem.\n\n**Recommendation:** These ACs should not gate the parent task (TASK-285). The roam health score's god-component penalty reflects tooling limitations, not architectural issues."
<!-- SECTION:FINAL_SUMMARY:END -->
