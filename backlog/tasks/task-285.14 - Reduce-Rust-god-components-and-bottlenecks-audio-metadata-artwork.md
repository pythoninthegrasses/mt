---
id: TASK-285.14
title: 'Reduce Rust god components and bottlenecks (audio, metadata, artwork)'
status: In Progress
assignee: []
created_date: '2026-02-24 22:41'
updated_date: '2026-02-24 22:42'
labels:
  - tech-debt
  - code-health
  - rust
dependencies: []
references:
  - crates/mt-tauri/src/audio/mod.rs
  - crates/mt-tauri/src/scanner/metadata.rs
  - crates/mt-tauri/src/scanner/artwork_cache.rs
  - crates/mt-tauri/src/scanner/fingerprint.rs
parent_task_id: TASK-285
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Roam identifies several actionable god components and bottlenecks in the Rust backend. These are lower impact than the frontend structural issues but contribute to the health score.

**God components (actionable):**
- `error` module in `crates/mt-tauri/src/audio/mod.rs` — degree 40. Likely a broad error enum used by many audio subsystems. Consider splitting into domain-specific error types.
- `len` / `is_empty` methods in `crates/mt-tauri/src/scanner/artwork_cache.rs` — degree 31/28. These are simple methods with high fan-in, likely because the artwork cache is widely referenced. May be inherent to the design.
- `track` field in `crates/mt-tauri/src/commands/audio.rs` — degree 23
- `data` field in `crates/mt-tauri/src/scanner/artwork.rs` — degree 21

**Bottlenecks (actionable):**
- `extract_metadata` (betweenness 264), `extract_metadata_or_default` (254), `non_empty` (163), `extract_metadata_batch` (109) — all in `crates/mt-tauri/src/scanner/metadata.rs`. This file is a funnel for all metadata extraction. Consider whether the helper functions (`non_empty`, `extract_metadata_or_default`) can be made module-private or inlined to reduce their graph centrality.
- `state` field in `crates/mt-tauri/src/audio/engine.rs` — betweenness 64
- `FileFingerprint` struct in `crates/mt-tauri/src/scanner/fingerprint.rs` — betweenness 54

**Triage guidance:** Some of these (len/is_empty, track/data fields) may be inherent to the architecture and not worth refactoring. Focus on the error module (degree 40) and metadata bottleneck cluster (combined betweenness 791) for the best health score impact.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 No Rust god components with degree > 30 remain in actionable category
- [ ] #2 Metadata bottleneck cluster combined betweenness reduced by at least 30%
- [ ] #3 All Rust tests pass (cargo nextest run --workspace)
<!-- AC:END -->
