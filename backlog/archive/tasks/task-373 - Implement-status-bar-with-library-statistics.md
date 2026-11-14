---
id: TASK-373
title: Implement status bar with library statistics
status: Done
assignee: []
created_date: '2025-09-29 04:55'
updated_date: '2025-09-29 05:00'
labels: []
dependencies: []
---

## Description

Create status bar showing total files, library size in GB, and aggregate playtime in format '33,580 files, 240.9 GB, 93d 18:59'. Use color #1f1f1f and span entire pane like search bar.

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Status bar spans entire bottom pane width
- [ ] #2 Shows total music files count
- [ ] #3 Shows library size in GB
- [ ] #4 Shows aggregate playtime in NNd hh:mm format
- [ ] #5 Uses #1f1f1f color following config.py nomenclature
<!-- AC:END -->

## Implementation Notes

Status bar implemented with library statistics showing file count, size in GB, and total duration in NNd hh:mm format. Uses #1f1f1f background color and spans entire bottom pane with right-justified text.
