---
id: TASK-369.4
title: Benchmark release profile LTO and codegen-units settings
status: To Do
assignee: []
created_date: '2026-11-14T04:24:00Z'
labels: []
dependencies: []
documentation:
  - docs/builds.md
parent_task_id: TASK-369
type: spike
ordinal: 4000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The release profile is the most aggressive setting in the repo: opt-level=s, panic=abort, strip, codegen-units=1 and lto=true (fat). Cargo's own docs note fat LTO costs substantially more link/compile time than thin LTO for similar gains, and codegen-units=1 serializes codegen. Since the release matrix is dominated by exactly these builds (Windows 399-464 s, Linux up to 598 s in the Feb-May 2026 release runs), and every cold local release build a developer runs pays this too, the profile deserves a benchmark sweep before any migration decision assumes it is irreducible. Baseline the current profile on one target (aarch64-apple-darwin plus one CI-parity run per platform if feasible), sweep lto in {fat, thin, false} x codegen-units in {1, 4, 16}, and keep the winner only if binary size and playback-related runtime regressions stay within agreed bounds. Document the accepted trade explicitly so future contributors do not re-tune blindly.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Hyperfine table of release build wall-clock for the lto x codegen-units matrix recorded in task notes, per platform where runners allow
- [ ] #2 Binary size and DMG/NSIS artifact size recorded for each profile candidate
- [ ] #3 A playback/perf smoke check (launch, load library, play a track) run on the candidate that wins
- [ ] #4 Chosen profile committed to Cargo.toml with a comment stating why, or an explicit decision to keep the current profile recorded in task notes
- [ ] #5 docs/builds.md performance section updated with the matrix results and the accepted trade-off
<!-- AC:END -->
