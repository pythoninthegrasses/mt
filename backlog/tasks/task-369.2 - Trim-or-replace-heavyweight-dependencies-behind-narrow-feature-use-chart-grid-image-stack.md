---
id: TASK-369.2
title: >-
  Trim or replace heavyweight dependencies behind narrow feature use (chart-grid
  image stack)
status: To Do
assignee: []
created_date: '2026-11-14T04:24:00Z'
labels: []
dependencies: []
documentation:
  - docs/builds.md
  - docs/development.md
parent_task_id: TASK-369
type: spike
ordinal: 3000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
commands/stats.rs (stats_generate_chart_grid) is the sole consumer of image, imageproc, and ab_glyph: it resizes artwork cells with Lanczos3, overlays them onto an RgbaImage, draws text, and PNG-encodes. That is a narrow surface paying for a large dependency subtree in both compile time and target/ disk, on every platform, even though the feature is used occasionally. The audit should quantify the subtree cost first (cargo tree -i image imageproc ab_glyph plus --timings share), then evaluate, in order: (1) feature-trimming the crates, (2) replacing imageproc's draw_text_mut and shrinking image to the needed decoders/encoders, (3) removing the Rust path entirely by rendering the chart grid in the frontend with Canvas and saving via existing dialog/save plumbing. Whichever option wins gets landed; the others are documented as rejected with numbers. Also survey other heavy-but-narrow cases found along the way (reqwest/tokio feature surface, sha2+md5 duplication) and record them even if out of scope to fix here.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Dependency-subtree compile-time and artifact cost for the chart stack quantified with cargo tree -i and --timings, recorded in task notes
- [ ] #2 Options 1-3 each evaluated with a measured or argued cost/benefit and a keep/reject decision with rationale
- [ ] #3 Winning option implemented with a green full test suite; chart grid output visually verified against a current screenshot
- [ ] #4 Any additional heavy-but-narrow candidates found are recorded as notes or follow-up tasks rather than silently skipped
<!-- AC:END -->
