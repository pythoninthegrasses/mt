---
id: TASK-355.5
title: Shadow-diff harness proving Rust/Zig parity
status: To Do
assignee: []
created_date: '2026-09-11 00:39'
labels: []
dependencies:
  - TASK-355.3
parent_task_id: TASK-355
type: task
ordinal: 62500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Porting roughly 7,500 lines of hand-written SQL from Rust to Zig by hand carries a real risk of silent wrong-result bugs, and there is no Zig-side test suite to serve as a ground truth. The mechanism that makes this porting defensible is a differential (shadow-mode) harness: for the ported endpoint, run both the existing Rust implementation and the new Zig implementation against the same input and compare their serialized JSON output, logging any divergence rather than trusting either implementation blindly. A hard rule for whoever does any future SQL porting under this mechanism: SQL query strings must be copied verbatim from the Rust source, never rewritten or "improved" during the port, since that reintroduces the exact risk this harness exists to catch.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A runtime flag causes the relevant Rust command to execute both the existing Rust implementation and a call to the new Zig sidecar endpoint, and compare their canonical JSON output
- [ ] #2 Any divergence between the two is logged with enough detail to diagnose it
- [ ] #3 The full existing Playwright suite passes with the shadow-diff flag enabled, with zero divergences logged
- [ ] #4 The repo-root mt.db and mt_20260127.sql are used as realistic test fixtures
- [ ] #5 A deliberately introduced divergence between the two implementations is demonstrated to be caught by the harness
- [ ] #6 The shadow-diff harness is excluded from the main rust CI job's critical path (e.g. it runs in a separate, non-blocking job or is opt-in)
<!-- AC:END -->
