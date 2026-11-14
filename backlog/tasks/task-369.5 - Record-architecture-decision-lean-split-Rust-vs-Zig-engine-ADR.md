---
id: TASK-369.5
title: 'Record architecture decision: lean-split Rust vs Zig engine (ADR)'
status: To Do
assignee: []
created_date: '2026-11-14T04:24:00Z'
updated_date: '2026-11-14T18:46:00Z'
labels: []
dependencies:
  - TASK-369.1
  - TASK-353
  - TASK-355
  - TASK-355.6
references:
  - 'https://doc.rust-lang.org/cargo/reference/profiles.html'
documentation:
  - zig-core/README.md
  - docs/tauri-architecture.md
parent_task_id: TASK-369
type: spike
ordinal: 6000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-355 proves the mechanics of a Zig sidecar but deliberately answers only the narrow POC question; TASK-352 ruled out CI wall-clock as justification and redirected any migration case to dev-loop and code-ownership grounds; TASK-353 will move db/scanner/lastfm/plex/cache/metadata into a tauri-free mt-core crate. What no task yet does is compare, on equal functionality and safety, the two end-states this initiative makes concrete: (A) lean split Rust -- mt-core extracted, unused/over-scoped deps removed, tuned profile, working CI caches -- versus (B) a Zig engine owning a complete subsystem (database/library read path first, per the existing zig-core spike), which must also delete its Rust counterpart to count as a win. Today the migration pays twice: rusqlite's bundled SQLite and zig-core's vendored sqlite3.c both compile. Benchmarks should cover edit-to-run latency for engine-only and shell-only changes, engine-test turnaround, cold/warm builds, and total disk including worktree fan-out; release wall-clock is one column, not the verdict. Produce an ADR-style recommendation (adopt-lean-Rust, adopt-Zig-engine, or hybrid with a named subsystem list) with the measured numbers, and record it on this task and in docs/. Cross-check against the TASK-355.6 POC report when it lands.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Both end-states A and B benchmarked on identical measurements: engine-edit-to-run, shell-edit-to-run, engine-test turnaround, cold/warm build, total disk across worktrees
- [ ] #2 The double-SQLite cost during migration is quantified (Rust bundle + vendored amalgamation) and the delta from actually deleting the Rust side is shown
- [ ] #3 ADR document added under docs/ with decision, measured evidence, rejected alternatives, and consequences
- [ ] #4 Recommendation names concrete next actions (e.g. which subsystem ports, which crates still split) and creates follow-up tasks for them via Backlog
- [ ] #5 TASK-355.6 POC report and TASK-353 results cited as inputs, with divergences explained
- [ ] #6 Complete the measurement gaps handed off by TASK-355.6: completed-sidecar cold/warm build timings and controlled CI wall-clock and Rust dependency-count deltas against TASK-352, distinguishing host/revision/cache differences and unrelated Rust optimizations from migration effects.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-11-14 (backlog tidy): TASK-355's AC#2 (written recommendation with measured numbers: build times, CI delta, dependency-count delta) was handed here when the POC was closed, so treat it as part of this ADR's scope. Measured inputs already recorded: TASK-369.1 baseline in benchmarks/edit-to-run/results-2026-11-13/ (2.2s build / 1.0s check warm, 0.6s main.rs, 6.9s with incremental wiped, 35.2s cold; target/ 12.3 GiB with 10.03 GiB in target/debug/build; crate-type = ["rlib"] what-if: -17s debug, -81s release, -1.75 GiB per worktree; 1270 cargo-tree lines / 421 unique crates normal-deps) and TASK-355's Zig POC results (read-only /api/library endpoint with bearer-token auth and a shadow-diff parity harness against the Rust path).

2026-11-14 (POC report reconciliation): TASK-355.6 now contains the factual six-subtask POC report and is an explicit dependency. Its original broader recommendation requirement is handed here, consistent with TASK-355's existing closeout. Remaining evidence includes completed-sidecar cold/warm build timings and controlled CI/dependency-count deltas: 355.1's 44s/23s numbers are whole-job timings for the initial Zig 0.15.2 placeholder, 355.2 only records an approximately 3s cold local build, and TASK-352's 9m34s run already contains the sidecar jobs. Do not claim a measured zero CI delta or use 1443-to-1270 tree-line counts from different revisions/hosts as Zig-attributable savings. Complete TASK-353 first, then compare equal functionality with explicit Rust deletion, quantify duplicate SQLite cost, and make the sole broader migration decision here.
<!-- SECTION:NOTES:END -->
