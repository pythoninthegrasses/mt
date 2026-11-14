---
id: TASK-369.9
title: >-
  Measure decode CPU cost of release-profile candidates as the runtime gate on
  TASK-369.4
status: Done
assignee:
  - lance
created_date: '2026-11-14T17:10:00Z'
updated_date: '2026-11-14T17:58:00Z'
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
- [x] #1 A decode-only measurement binary exists that uses the same decode primitive as the player (rodio Decoder::try_from over a File) and reports CPU seconds from getrusage(2), not wall time, so CoreAudio and the wall clock cannot enter the result
- [x] #2 A deterministic, uncommitted audio corpus covers every format mt's rodio features enable (mp3, flac, m4a, ogg, wav), is reproducible from a pinned seed and fixed encoder flags, and is verified by sha256 before use
- [x] #3 Baseline (lto=true cgus=1) and both leading candidates (lto=thin cgus=4, lto=false cgus=1) are measured on the host with the median of >=5 process runs, recorded under benchmarks/release-profile/results-<date>/ and surfaced by ./sweep.sh summary
- [x] #4 The result states, per candidate, CPU seconds vs baseline and decode throughput vs baseline, and says explicitly whether the AC#4 bounds still fail once runtime cost is included
- [x] #5 docs/builds.md#release-profile records the accepted trade-off including the runtime column
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Harness hardening while running: corpus manifest split into manifest.sha256 (shasum -c parses it directly) and manifest.txt (ffprobe probe dump) after the mixed format failed its own verification; ffmpeg's homebrew build lacks libvorbis, so the ogg encode uses the native vorbis encoder (-strict -2) which symphonia decodes identically.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Decode CPU measured for baseline and both leading candidates (host, 5 timed decodes per file across mp3/flac/m4a/ogg/wav, median of 5 process runs, sha256-pinned synthesised corpus). Baseline lto=true cgus=1: 0.970 s CPU for the corpus, 111.7 MiB/CPU-s. lto=thin cgus=4: 1.113 s (+14.8% CPU, 0.87x throughput). lto=false cgus=1: 1.172 s (+20.8% CPU, 0.83x throughput). Run-to-run spread under 0.3%, so the sign is not in question. The bounds from TASK-369.4 fail even harder once runtime cost is included: every candidate that is 15%+ faster to build is 15-21% slower to decode. Verdict recorded in docs/builds.md (Release Profile section). Its supporting runtime table lived in `results-2026-11-14/SUMMARY.md`, removed from the repo 2026-11-14 along with the other raw harness output; regenerate with `cd benchmarks/release-profile && ./sweep.sh decode <candidate>` then `./sweep.sh summary` (gitignored `results-<date>/`).
<!-- SECTION:FINAL_SUMMARY:END -->
