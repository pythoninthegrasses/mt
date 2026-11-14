---
id: TASK-355
title: 'POC: Zig core sidecar'
status: Done
assignee: []
created_date: '2026-09-11 00:38'
updated_date: '2026-11-14T05:36:00Z'
labels: []
dependencies:
  - TASK-352
type: spike
ordinal: 57500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The goal is an evidence-based go/no-go decision on migrating the core engine (database, scanner, Last.fm, Plex) from Rust to a Zig sidecar process, proving or disproving the four riskiest assumptions before committing months of porting effort: (1) Zig can cross-compile the sidecar binary, including vendored SQLite, to macOS/Linux/Windows targets from a single build runner; (2) Tauri's externalBin mechanism can package, sign, and notarize a second binary inside the app bundle; (3) a Zig implementation can reproduce a real read path against mt.db with byte-identical JSON output compared to the existing Rust implementation; (4) the frontend, which already has a dormant HTTP client, can consume the sidecar directly. Scope is deliberately narrow: one read-only endpoint end to end. No writes, no scanner porting, no Last.fm/Plex porting -- those are separate future work gated on this POC's outcome. Context for whoever picks this up: app/frontend/js/api/shared.js:8 already defines API_BASE = 'http://127.0.0.1:8765/api' with a request() helper at :27 and a tauriInvoke() wrapper at :64; every frontend API domain module already calls tauriInvoke(...) ?? request(...), a fallback pattern left over from a previously removed Python sidecar. git show af04d61 is prior art in this exact repo for wiring an externalBin sidecar into Tauri (later reverted in 9feabb0) and is a useful reference for the spawn/lifecycle shape, though not for the HTTP transport choice made here.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 All six subtasks are complete
- [ ] #2 A written recommendation with measured numbers (build times, CI delta, dependency-count delta) is recorded on this task
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-11-14 (backlog tidy): closing the POC. AC#1 met — all six subtasks are complete (355.1 toolchain/Taskfile/CI, 355.2 vendored SQLite binding with strip_sort_prefix parity, 355.3 read-only HTTP endpoint, 355.4 packaged/signed sidecar, 355.5 shadow-diff parity harness, 355.6 frontend flip with the injection verified against the live sidecar: GET /api/library with the bearer token -> 200 total=301, without -> 401). AC#2 deliberately NOT checked: the written recommendation with measured numbers (build times, CI delta, dependency-count delta) is the deliverable of TASK-369.5, and the edit-to-run / disk baseline it needs now exists in TASK-369.1 (benchmarks/edit-to-run/results-2026-11-13/): 2.2s build / 1.0s check warm, 35.2s cold, 12.3 GiB target with 10 GiB in target/debug/build, and the crate-type what-if (-17s debug, -81s release, -1.75 GiB). Marking the POC Done so the board reflects reality; the ADR in TASK-369.5 carries the decision.
<!-- SECTION:NOTES:END -->
