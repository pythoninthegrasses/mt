---
id: TASK-393.1
title: Define executable engine and native-adapter wire contracts
status: Done
assignee:
  - OpenCode
created_date: '2026-11-15T05:32:00Z'
updated_date: '2026-11-15T08:16:00Z'
labels:
  - zig-first
  - migration
dependencies:
  - TASK-369.5
references:
  - app/frontend/js/api/shared.js
  - crates/mt-tauri/src/sidecar.rs
  - TASK-355.6
documentation:
  - docs/tauri-architecture.md
  - docs/testing.md
  - zig-core/README.md
  - docs/engine-protocol.md
  - protocol/engine-envelope.schema.json
parent_task_id: TASK-393
priority: high
type: task
ordinal: 82500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The working POC exposes only one HTTP read. Independent subsystem workers need a single documented request, response, error and event contract, including Rust capability calls, before adding routes. This task defines and validates the boundary chosen by the ADR, not a new transport research project. Excludes implementing process supervision or porting domain operations. TASK-393 policy: feature freeze until Zig-first completion; preserve current behavior and data, permit bugfixes, add no product features. Zig owns domain policy; retained Rust/C libraries expose narrow capabilities. This task owns only the named capability. Read the approved ownership ADR from TASK-369.5 and dependency outputs before starting; record a current implementation plan then. Transfer callers and behavioral coverage with the capability; delete its replaced Rust policy/queries when no caller remains, rather than leave an authoritative duplicate. Do not expand into a benchmark matrix or unrelated subsystem.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A versioned contract covers frontend engine requests and engine-to-Rust capability calls using the transport fixed by the ADR; schemas/examples define envelope, correlation, errors, cancellation and event revision semantics.
- [x] #2 Contracts explicitly define null versus absent fields, booleans, paths, query encoding, ID/timestamp precision across JavaScript, and structured failure responses; no silent i64 precision loss.
- [x] #3 Shared fixtures cover valid and malformed messages, unknown operations/versions, empty lists, non-ASCII text, large IDs and error responses; Zig and Rust boundary codecs plus frontend decoding validate their relevant fixtures.
- [x] #4 Runtime credentials are local-only, redacted and never accepted via an unauthenticated adapter operation; limits and timeout ownership are documented without exposing a LAN server.
- [x] #5 The protocol document and ownership ADR name which later task supplies supervision and adapter/event plumbing; existing getTracks remains functional with no new business routes.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Completed the maintainer-approved staged contract-only implementation. Added protocol v1 specification and executable JSON Schema; storage/Tauri-independent Rust and Zig structural codecs, frontend codec and response correlation/status checks; 58 shared wire fixtures and native bounded NDJSON framing tests. Cancellation DTO validation, canonical precision-safe scalar checks, safe typed codec errors and direction-specific operation allowlists are executable. Registered domain DTO validation/authorization, live HTTP activation, handshake, pending maps, timeout execution and event hydration remain the explicitly documented responsibilities of .2/.3 and per-capability ports (.4 for getTracks); no live routes/domain policy were transferred. Updated ADR, architecture/testing guides, ownership inventories, Zig README/Taskfile and test-only dependency locks. Verification completed with full workspace Rust tests, frontend suite, Zig suite and lint/format; dependency refresh limitations documented in notes.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Prerequisite TASK-369.5 is completed and task is eligible. Clean working tree at start. Current POC has GET /api/library, bare paged results, {detail} errors and numeric track IDs; shared.js parses raw JSON. Rust sidecar stdout is currently logged rather than dispatched and readiness is a runtime-file/HTTP probe. Therefore changing production envelopes or event routing here would spill into .2/.3/.4. Proposed wire design for review: versioned resource HTTP routes (not a generic RPC endpoint); a shared {version, kind, generation, id, operation, payload} request envelope, exclusive result/error responses and generation/sequence/revision event fields; NDJSON retains the same envelope family. Credentials belong only to the private handshake/bootstrap, never generic operation payloads or fixtures. Exact operation payloads are registered by later capability ports; fixture-only samples must not become enabled business routes.

AC1/2: docs/engine-protocol.md plus protocol/engine-envelope.schema.json fix HTTP/NDJSON envelopes, generation-scoped correlation, cancellation/uncertain results, status mapping, event revision/hydration semantics, query/path/null/boolean rules and ID/timestamp precision. Rust/Zig/JS codecs reject unsafe numbers, numeric/overflowing IDs, malformed envelopes, Unicode and wrong correlations/statuses. Unsupported versions and unknown operations have distinct safe codes. Operation payload validation beyond shared control.cancel remains mandatory at owning port registration.

AC3: 58 shared JSONL fixtures pass Rust, Zig, frontend and Ajv 2020-12 schema validation. Native tests cover split/coalesced reads and split UTF-8, malformed UTF-8, escaped LF, CRLF/empty frames, EOF truncation, size limits and decoder poisoning. Frontend tests cover pre-serialization undefined/NaN/Infinity/bigint/cycles and redact native JSON syntax errors. task cargo:test: 1042 passed, 3 skipped; frontend npx vitest run --reporter=default: 36 files/736 passed; Zig build test --summary all: 41 passed (37 existing plus 4 shared-protocol tests). Focused final frontend protocol/error regressions: 79 passed.

AC4/5: Specification restricts credentials to private handshake/bootstrap, loopback/Host/Origin/grants, redacted errors, finite frames/blobs/queues/in-flight and per-operation budgets. Codec diagnostics never echo input; no credential fixture or unauthenticated adapter handler exists. ADR and protocol explicitly assign activation/supervision to .2, adapter/event plumbing to .3 and library activation to .4. Existing shared.js/library.js/server.zig/sidecar.rs are unchanged. Existing getTracks concurrent regression and actual sidecar parity tests pass; no business route/policy/query/test deletion occurred.

Hygiene: task lint and task format passed, including Rust clippy and Zig fixture-root formatting; explicit Deno formatting checks and git diff --check passed. Added test-only Ajv 8.20.0; npm install succeeded. Full pinned-Deno refresh failed on existing @tailwindcss/oxide-wasm32-wasi registry metadata (duplicate bundleDependencies). Generated Ajv entries in an isolated Deno lock, copied only those entries and workspace declaration; verified exact equality to generated entries and that every pre-existing Deno dependency entry is unchanged. No broad dependency refresh attempted after that. npm audit reports 13 existing advisories in unrelated dependencies (Ajv not listed); no unrelated upgrades made. Existing block 0.1.6 future-Rust warning remains. No new real-shell supervision/security result claimed.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented protocol v1 specification, machine-readable schema, precision-safe Rust/Zig/frontend boundary codecs and bounded NDJSON framing with 58 shared fixtures. Documented cancellation, errors, credential/limit rules and staged activation in .2/.3/.4; live getTracks remains unchanged. Verified 1042 Rust, 736 frontend and 41 Zig tests; lint/format passed. Full Deno refresh is blocked by unrelated Tailwind registry metadata; isolated generated Ajv lock entries verified without changing existing resolutions.
<!-- SECTION:FINAL_SUMMARY:END -->
