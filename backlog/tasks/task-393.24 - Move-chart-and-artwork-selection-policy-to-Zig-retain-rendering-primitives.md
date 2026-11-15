---
id: TASK-393.24
title: Move chart and artwork selection policy to Zig; retain rendering primitives
status: To Do
assignee: []
created_date: '2026-11-15T05:36:00Z'
updated_date: '2026-11-15T05:37:00Z'
labels:
  - zig-first
  - migration
dependencies:
  - TASK-393.11
  - TASK-393.15
  - TASK-393.29
references:
  - crates/mt-tauri/src/commands/stats.rs
  - crates/mt-tauri/src/scanner
  - TASK-369.2
  - TASK-390
  - TASK-391
documentation:
  - docs/tauri-architecture.md
  - docs/testing.md
parent_task_id: TASK-393
priority: high
type: task
ordinal: 105500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-393 feature freeze applies. Preserve current chart output while moving candidate selection/composition policy and artwork selection to Zig. Reuse TASK-393.29's authoritative artwork resolver/cache rather than creating a second cache or depending on session assembly. Rust may retain justified image/imageproc/font rendering primitives. Preserve current grouping/ranking; TASK-390 remains frozen unless separately approved as a bugfix. Read TASK-369.5 and dependency outputs, research current callers and record a bounded implementation plan at start. Transfer every chart caller, replace Rust policy tests with Zig tests, delete superseded Rust selection/SQL, and update ownership/API docs. No benchmark matrix, new chart mode, artwork source or feature is included.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Zig selects current chart candidates, labels, ordering and artwork via the authoritative shared artwork resolver; the Rust rendering capability receives an explicit composition request and never queries mt.db.
- [ ] #2 Current supported image MIME formats, placeholder behavior, layout and export behavior are preserved; rendering/color/font limitations are documented rather than silently changed.
- [ ] #3 Artwork lookup cache behavior is shared with playback, including TASK-391's offline-recovery fix; no duplicate negative cache survives in rendering code.
- [ ] #4 Tests cover missing artwork, invalid images, local/Plex candidates, empty statistics and representative golden output; Rust tests exercise codecs/rendering while Zig tests exercise selection policy.
- [ ] #5 Existing chart generation/export works against the engine, superseded Rust policy is deleted and the ownership inventory names the justified rendering libraries.
<!-- AC:END -->
