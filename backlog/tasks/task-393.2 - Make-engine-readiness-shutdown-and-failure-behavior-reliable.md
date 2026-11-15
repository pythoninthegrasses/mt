---
id: TASK-393.2
title: 'Make engine readiness, shutdown and failure behavior reliable'
status: In Progress
assignee:
  - Assistant
created_date: '2026-11-15T05:32:00Z'
updated_date: '2026-11-15T08:26:00Z'
labels:
  - zig-first
  - migration
dependencies:
  - TASK-393.1
references:
  - crates/mt-tauri/src/sidecar.rs
  - app/frontend/main.js
  - app/frontend/js/api/shared.js
  - zig-core/README.md
documentation:
  - docs/tauri-architecture.md
  - docs/testing.md
  - zig-core/README.md
parent_task_id: TASK-393
priority: high
type: task
ordinal: 83500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The frontend already depends on Zig getTracks without a Rust fallback, while the POC has known startup/lifecycle limitations. Make the existing engine process a trustworthy application dependency using the agreed contract. Rust remains temporary schema initializer until the final database handoff. Excludes new domain endpoints and automatic recovery that replays mutations. TASK-393 policy: feature freeze until Zig-first completion; preserve current behavior and data, permit bugfixes, add no product features. Zig owns domain policy; retained Rust/C libraries expose narrow capabilities. This task owns only the named capability. Read the approved ownership ADR from TASK-369.5 and dependency outputs before starting; record a current implementation plan then. Transfer callers and behavioral coverage with the capability; delete its replaced Rust policy/queries when no caller remains, rather than leave an authoritative duplicate. Do not expand into a benchmark matrix or unrelated subsystem.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Fresh and existing database startup follows the documented temporary migrator order; frontend initialization waits for a verified compatible engine endpoint rather than racing DB creation or using a hardcoded port.
- [ ] #2 Missing binary, timeout, incompatible protocol, malformed runtime file and early child exit yield a bounded visible unavailable state, not an empty successful library or silent Rust fallback.
- [ ] #3 Shutdown releases the child and runtime endpoint; stale endpoint/token files cannot attach a new launch to an unrelated old process, and credentials never appear in logs.
- [ ] #4 Engine death during a request produces a structured unavailable result; any restart policy is bounded and cannot blindly replay non-idempotent mutations.
- [ ] #5 Tests exercise supervision failures and restart/shutdown paths; at least one actual Tauri-webview startup-to-fetch flow is recorded separately from mocked browser evidence.
- [ ] #6 Existing staging/signing behavior is preserved; docs explain readiness, failure recovery and how to diagnose the engine without a new CI benchmark workflow.
- [ ] #7 Runtime endpoint credentials are protected by platform-appropriate permissions, including Windows ACLs or a documented equivalent approved design; local/browser-origin access tests reject unauthorized clients without claiming loopback alone is a security boundary.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Current bounded plan (2026-11-15; prerequisite TASK-393.1 is complete): 1. Establish an OS-released exclusive application-instance lock on the canonical app-data location before Rust Database::new or sidecar runtime-file cleanup; keep the lock for the shell lifetime, test simultaneous opens, directory aliases, normal release and process death, and document recovery. This is the first implementation milestone. 2. Replace optional POC supervision with explicit starting/ready/unavailable/stopping state, a 10s startup budget, fresh generation/nonce/token over private control.hello, schema/protocol and endpoint verification, bounded runtime-file reads and credential-redacted diagnostics. 3. Gate frontend domain startup on verified shell bootstrap with no default port or Rust fallback; expose bounded visible unavailable errors and structured request-loss failures without automatic mutation replay. 4. Implement bounded graceful shutdown (5s), child reaping, endpoint invalidation and stale-file cleanup; hold the instance lock through cleanup and prevent late readiness from resurrecting a dead child. 5. Protect runtime credentials with Unix owner permissions and Windows owner ACLs; enforce exact Host and configured Tauri Origin and test unauthorized local/browser requests. 6. Run focused Rust/Zig/Vitest supervision and request tests, preserve staging/signing, record actual Tauri-webview startup-to-fetch separately from mocks, and update lifecycle/diagnostic docs. No domain endpoint port, native dispatcher/event bridge (.3), schema handoff or new benchmark workflow. Leave acceptance criteria unchecked until complete behavioral evidence exists.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Initial research: working tree clean; lib.rs already orders Database::new before sidecar::spawn. sidecar.rs currently deletes the shared runtime file without any application lifetime lock, registers state only after successful spawn, probes without a total request deadline, logs stdout verbatim, and retains an endpoint after child exit. main.js requests the endpoint once and silently falls back to port 8765. First milestone is the missing pre-migration lifetime lock; the rest remains explicitly outstanding.

Milestone 1 implemented: new shell-only instance.rs acquires File::try_lock on a persistent engine.lock in the canonical app-data directory; lib.rs retains the guard in Tauri managed state before Database::new and sidecar::spawn. No PID-file deletion/expiry and no dependency added. instance_tests.rs covers contention without DB/endpoint mutation, fresh-directory acquisition, anchor preservation/reacquisition, invalid paths, Unix directory symlinks, independent locations and real subprocess exit/kill/relaunch. Docs/ownership inventory updated. task zig:stage TARGET=aarch64-apple-darwin, task format and task lint passed. First workspace test run exposed a test-helper BrokenPipe (reader dropped stdout at readiness before libtest printed its exit summary); changed helper to keep draining stdout, and rerunning the full workspace suite. No AC is yet complete; private handshake, frontend failure state, child supervision/EOF cleanup, Windows credential ACLs, origin/Host enforcement and actual Tauri evidence are still outstanding.

Milestone 1 verification on macOS/aarch64: task cargo:test completed successfully (1049 passed; 4 skipped, including the explicitly invoked lock-holder helper). All 7 new instance tests passed, including normal subprocess exit and forced kill followed by reacquisition. task lint, task format, git diff --check and task zig:stage TARGET=aarch64-apple-darwin passed. Windows lock execution, credential ACLs, real Tauri startup-to-fetch and signed bundle checks were not performed; do not treat cross-platform std API use or mocked evidence as those results. Next implementation step is the private control.hello handshake and explicit supervisor states/deadlines; replace the one-shot frontend/default-port bootstrap as part of that coordinated change. Parent death must also close/stop any engine child before stale-runtime relaunch can be considered safe. TASK-393.2 remains In Progress with all AC unchecked.
<!-- SECTION:NOTES:END -->
