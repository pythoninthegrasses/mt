---
id: TASK-323
title: 'Phase 3: Optimize CI pipeline structure (tarpaulin, Playwright gating)'
status: Done
assignee: []
created_date: '2026-04-12 09:10'
updated_date: '2026-04-13 17:48'
labels:
  - ci
  - performance
dependencies: []
references:
  - .github/workflows/test.yml
  - .github/actions/setup-tauri-build/action.yml
priority: medium
ordinal: 15000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Structural CI workflow changes to reduce the critical path.

**Tarpaulin optimization:**
- Replace `cargo tarpaulin` with `cargo nextest run` for PR checks (saves ~1.5 min on critical path)
- Move tarpaulin coverage to a scheduled/nightly job or run only on main push
- Remove binstall + tarpaulin install steps from PR path

**Playwright gating (optional):**
- Consider making Playwright E2E an optional job triggered only when `app/frontend/**` changes
- Or run Playwright only on macOS PRs / main push

**Current critical path:** Rust (~3 min) -> Build macOS (~2 min) = ~5 min
**Target critical path:** Rust with nextest (~1.5 min) -> Build macOS (~2 min) = ~3.5 min
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 PR checks use cargo nextest instead of tarpaulin
- [x] #2 Tarpaulin coverage runs on main push or nightly schedule only
- [x] #3 Playwright job has path filter or is optional for non-frontend changes
- [x] #4 Total pipeline wall clock under 7 minutes
<!-- AC:END -->
