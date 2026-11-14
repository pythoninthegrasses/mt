---
id: TASK-369.5
title: 'Record architecture decision: lean-split Rust vs Zig engine (ADR)'
status: To Do
assignee: []
created_date: '2026-11-14T04:24:00Z'
updated_date: '2026-11-14T04:24:00Z'
labels: []
dependencies:
  - TASK-369.1
  - TASK-353
  - TASK-355
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
<!-- AC:END -->
