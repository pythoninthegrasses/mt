---
id: TASK-369.9
title: >-
  Measure decode CPU cost of release-profile candidates as the runtime gate on
  TASK-369.4
status: In Progress
assignee:
  - lance
created_date: '2026-11-14T17:10:00Z'
labels: []
dependencies:
  - TASK-369.4
references:
  - benchmarks/release-profile/README.md
  - crates/mt-tauri/examples/decode_bench.rs
parent_task_id: TASK-369
priority: medium
ordinal: 76500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-369.4 benchmarks cold release build time and artifact size across lto x codegen-units, but neither number says what a profile BUYS at runtime. Fat LTO is slow to link precisely because it can inline across crates, and the decode hot path (rodio over symphonia, used by AudioEngine::load and the waveform path) is the obvious place that payoff should show up. Without this measurement the profile decision rests on build time and bytes alone, and a 35-44% faster cold build could be paid for with a decode regression a listener hears.

This is the runtime half of the same spike: it measures CPU seconds to decode a fixed audio corpus per candidate, so the keep-vs-switch decision in TASK-369.4 can weigh runtime cost.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A decode-only measurement binary exists that uses the same decode primitive as the player (rodio Decoder::try_from over a File) and reports CPU seconds from getrusage(2), not wall time, so CoreAudio and the wall clock cannot enter the result
- [ ] #2 A deterministic, uncommitted audio corpus covers every format mt's rodio features enable (mp3, flac, m4a, ogg, wav), is reproducible from a pinned seed and fixed encoder flags, and is verified by sha256 before use
- [ ] #3 Baseline (lto=true cgus=1) and both leading candidates (lto=thin cgus=4, lto=false cgus=1) are measured on the host with the median of >=5 process runs, recorded under benchmarks/release-profile/results-<date>/ and surfaced by ./sweep.sh summary
- [ ] #4 The result states, per candidate, CPU seconds vs baseline and decode throughput vs baseline, and says explicitly whether the AC#4 bounds still fail once runtime cost is included
- [ ] #5 docs/builds.md#release-profile records the accepted trade-off including the runtime column
<!-- AC:END -->
