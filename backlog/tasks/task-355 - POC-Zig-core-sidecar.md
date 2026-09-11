---
id: TASK-355
title: 'POC: Zig core sidecar'
status: To Do
assignee: []
created_date: '2026-09-11 00:38'
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
