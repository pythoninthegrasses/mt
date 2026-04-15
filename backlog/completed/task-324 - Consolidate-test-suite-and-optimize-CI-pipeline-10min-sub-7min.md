---
id: TASK-324
title: Consolidate test suite and optimize CI pipeline (10min -> sub-7min)
status: Done
assignee: []
created_date: '2026-04-12 09:10'
updated_date: '2026-04-13 17:48'
labels:
  - ci
  - testing
  - performance
dependencies:
  - TASK-321
  - TASK-322
  - TASK-323
references:
  - .github/workflows/test.yml
  - app/frontend/tests/
  - app/frontend/__tests__/
priority: high
ordinal: 12000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Tracking task for reducing CI pipeline wall clock from ~10 minutes to under 7 minutes by removing redundant Playwright E2E tests and optimizing CI workflow structure.

**Problem:** 38 Playwright specs have significant overlap with 18 Vitest unit/property tests. Many Playwright specs test pure JS logic or trivial CSS values rather than real E2E behavior. Tarpaulin coverage on every PR adds ~1.5 min to the critical path.

**Approach (3 phases):**
1. Remove redundant Playwright specs already covered by Vitest (~2,900 lines)
2. Convert logic-heavy Playwright specs to Vitest, reduce visual tests (~1,500 lines)
3. Optimize CI structure: nextest for PRs, tarpaulin on main only, Playwright path filtering

**Rust tests are well-justified** — concurrency, DB compat, queue props — keep all unchanged.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 CI pipeline wall clock under 7 minutes on typical PR
- [x] #2 No test coverage regression (Vitest covers what Playwright dropped)
- [x] #3 All remaining Playwright specs test real E2E behavior, not pure logic
<!-- AC:END -->
