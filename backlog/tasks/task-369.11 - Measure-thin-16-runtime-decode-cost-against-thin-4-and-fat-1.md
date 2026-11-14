---
id: TASK-369.11
title: Measure thin/16 runtime decode cost against thin/4 and fat/1
status: To Do
assignee: []
created_date: '2026-11-14T18:31:00Z'
labels: []
dependencies: []
references:
  - benchmarks/release-profile/sweep.sh
  - benchmarks/release-profile/corpus.sh
  - crates/mt-tauri/examples/decode_bench.rs
  - docs/builds.md
parent_task_id: TASK-369
priority: medium
type: spike
ordinal: 79500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Follow-up to TASK-369.4 and TASK-369.9. The maintainer now prioritizes macOS/Linux cold release build time over installer size and Windows build time, adopting thin LTO with four codegen units. thin/16 builds in 48.8 s on macOS and 108.7 s on Linux versus thin/4 at 57.7 s and 117.6 s, but thin/16 runtime cost is unmeasured. Existing synthetic decode results: fat/1 0.970 CPU s, thin/4 1.113 CPU s, off/1 1.172 CPU s. Measure thin/16 rather than assuming its runtime trade-off, using benchmarks/release-profile/sweep.sh decode and the same verified corpus. Keep settings constant and compare interleaved repetitions to control temperature/order effects. Do not infer audible degradation or whole-app/battery cost from decode throughput alone.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Measure fat/1, thin/4 and thin/16 with at least five process runs per profile on the same verified corpus; record toolchain, hardware, corpus hashes and per-format CPU results.
- [ ] #2 Report thin/16 CPU cost and throughput relative to thin/4 and fat/1 with run spread; distinguish decoder-only results from unmeasured playback quality, latency and power.
- [ ] #3 Validate matching decoded sample counts and investigate differences before treating profiles as comparable.
- [ ] #4 Document whether thin/16 offers a preferable build/runtime compromise to thin/4; change the release profile only with maintainer approval.
<!-- AC:END -->
