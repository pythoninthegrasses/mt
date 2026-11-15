# Engine protocol v1

TASK-393.1 implements structural codecs and shared wire fixtures for the
[approved boundary](adr/0001-zig-first-engine.md). This is an **internal,
coordinated-release** contract, not a stable public API.

## Activation and ownership

- TASK-393.2 activates compatible private handshakes, verified readiness, runtime
  endpoint security, failure handling and startup/exit deadlines.
- TASK-393.3 activates bounded private dispatch/capabilities, cancellation and
  observations, plus **one** `engine:event` Tauri domain-event bridge.
- TASK-393.4 transfers the existing library read and consumers to v1. Later
  capability ports register their exact operation DTOs, limits and callers.
- TASK-369.12 separates engine/adapter/shell test infrastructure.
- Rust remains the sole DB migrator until TASK-393.26; this protocol does not
  change schema authority.

**The current `GET /api/library`, `getTracks`, bare paged responses, numeric POC
track IDs and `{detail}` errors are unchanged. They are not v1.** Do not pass
legacy results to the v1 decoder or claim that their IDs are precision-safe.
Transfer IDs and consumers together in .4/.5. The hardcoded bootstrap fallback,
stdout logger and existing readiness probe are also transitional, not secure
implementations of this specification. There is no new live business route,
handshake, adapter or event subscription in .1.

## Transport and envelopes

Frontend → engine: authenticated HTTP on an OS-assigned **127.0.0.1** port.
Use versioned resource routes (`/api/v1/...`), not a generic operation proxy.
Method/path and envelope `operation` must agree with the registered handler.
Requests carry `Authorization: Bearer ...`; never put credentials in a URL.
JSON bodies/responses use `application/json; charset=utf-8`.

Read requests use GET without a body. Required query metadata are `version=1`,
`generation`, `id`, `operation`, `deadline_ms`; the route maps its remaining typed
query parameters into `payload` and validates the resulting request envelope.
Mutation requests use POST/PATCH/DELETE as registered, with the JSON request
envelope as body and no duplicate query metadata. A resource's method/path/query
schema is supplied by its capability port; .1 enables none.

Rust ↔ engine: private child stdin/stdout, one UTF-8 JSON object plus **one LF**.
Embedded CR/LF must be JSON escaped. No BOM, empty lines, CRLF framing, unterminated
final frame or other stdout text. Stderr is diagnostic-only. A read can contain
part of a multibyte character, multiple frames or both. Decode JSON only after
framing. A malformed/oversized frame invalidates the channel; do not attempt
delimiter-based recovery after a framing failure. Process supervision decides
how to stop safely, not the codec.

Every envelope has `version: 1`, `kind`, `generation`, `operation`. Unknown
envelope/error fields are rejected. `generation`, correlation `id`, operation,
load/job/grant identities are case-sensitive ASCII strings matching
`[A-Za-z0-9._:-]{1,64}`. IDs are opaque, never parsed as JS numbers.
Domain entity IDs use decimal strings instead.

| Kind | Additional required fields | Meaning |
|------|----------------------------|---------|
| `request` | `id`, `deadline_ms`, object `payload` | HTTP domain call or private capability/control request |
| `response` | `id`, exactly one of `result` / object `error` | Echo generation, operation and ID unchanged |
| `event` | decimal-string `sequence`, `revision`, object `payload` | Committed Zig domain change/snapshot invalidation |
| `observation` | decimal-string `sequence`, object `payload` | Native measurement or user intent to Zig, not a committed mutation |

`result` can be null, an object, array or scalar **only if its registered DTO
allows it**. An absent result is not null. `error` can never be null. Both result
and error, or neither, are invalid. Requests always contain an object payload,
including `{}` for no arguments.

Example (fixture operation only, not a newly enabled route):

```json
{"version":1,"kind":"request","generation":"g1","id":"ui:1","operation":"library.getTracks","deadline_ms":5000,"payload":{"search":"Björk 東京"}}
{"version":1,"kind":"response","generation":"g1","id":"ui:1","operation":"library.getTracks","result":{"tracks":[],"count":"0","revision":"0"}}
```

The schema is [engine-envelope.schema.json](../protocol/engine-envelope.schema.json).
It defines structural shapes, shared scalar types and cancellation. Codecs add
byte/depth limits, Unicode checks and per-direction operation allowlists.
They **do not** authorize an operation or validate arbitrary domain DTOs.
After envelope validation and before dispatch, the handler must apply its own
strict typed payload schema, path/destination grants and per-operation limits.
Registration alone never permits execution. Unregistered operations fail closed.
The operation names in shared tests are fixtures, not a production registry.

## Scalars, absence and encoding

- Domain `track_id` is canonical positive decimal `1..9223372036854775807`.
  Revisions, sequences and potentially 64-bit counters are canonical unsigned
  decimal `0..18446744073709551615`; sequence begins at **1**. No leading `+`,
  leading zero except `"0"`, exponent, decimal point, negative or whitespace.
- Shared reserved names `revision`, `sequence`, `count`, `timestamp_ms`,
  `position_ms`, `size_bytes` require unsigned decimal strings, even nested.
  Domain DTOs must explicitly type **all other** entity IDs, counters, nanosecond
  file times/inodes/sizes as strings too; renaming a field is not a precision fix.
  No integer/float magnitude above `9007199254740991` is accepted anywhere.
- Only bounded, explicitly typed small values (version, page size, deadline) use
  integer JSON numbers. Finite duration/volume/rate floats may use numbers.
  JSON `1.0` and `1e0` are numerically identical to `1`; do not depend on lexical
  numeric formatting. Never coerce strings, truthy integers or null to booleans.
- `timestamp_ms` is nonnegative Unix epoch **milliseconds UTC** as a decimal
  string. `position_ms` is nonnegative media-relative milliseconds. Future DTOs
  name units explicitly; legacy date strings require explicit conversion at the
  owning port, not opportunistic JS `Date` coercion.
- Required nullable metadata uses explicit null for “known unavailable”.
  An absent optional field means “not supplied / do not change” in patch DTOs;
  null means “clear” only when the specific DTO permits it. Empty strings/lists,
  false and zero are values, never absence. No `undefined` on the wire.
- UTF-8 Unicode scalar text only; no lone surrogates. Preserve text/case and
  Unicode normalization. Object member names must also be valid scalar text.
  Senders use unique keys; all three standard parsers resolve duplicate keys
  **last wins**, before validation. Authorization and dispatch must use that
  same decoded value, never inspect the raw spelling differently.
- A `path` is UTF-8 platform-native text, no NUL. It is not a file URL; preserve
  Windows separators/drive prefixes and macOS normalization. Unsupported
  non-UTF-8 OS filenames return `invalid_request`, never lossy conversion.
  A string passing the codec is **not** a grant. Rust checks canonical roots,
  symlinks/reparse points and explicit picker-grant identity at use time.
- Query values use URLSearchParams-compatible UTF-8 percent encoding: space
  may be `+` or `%20`; literal `+` must be `%2B`. Decode once, reject malformed
  escapes/UTF-8, duplicates and unknown names. Omit absent optional filters;
  empty `search=` is empty text, not null. Query booleans are exactly `true`
  and `false`. Query decimal fields use canonical decimal text; schema typing
  occurs after decoding. No comma-joined arrays or implicit `"null"`.

## Correlation, errors and outcomes

Outstanding requests are keyed by `(generation, id)` with operation identity
also checked on response. Use disjoint per-origin ID prefixes (`ui:`, `zig:`,
`rust:`), never reuse an ID within a generation. A new launch uses new generation,
credentials and IDs. Wrong-generation, unknown/late/duplicate or wrong-operation
responses cannot complete a newer request. Codecs provide response checks;
.2/.3 own pending-map lifecycle and duplicate rejection. HTTP status must agree
with error code; successful protocol responses are 200 with a result envelope.

Errors contain `code`, safe UTF-8 `message` (≤1024 bytes), strict boolean
`retryable`, and optionally safe object `details` (omit, do not send null).
No raw SQL, subprocess/provider bodies, token, full URL query or unapproved path
in errors or diagnostic formatting. Codec diagnostics contain no input bytes.
Dispatch maps redacted codec failures to the following structured errors;
transport failure is never an empty successful collection.

| Code | HTTP status | Meaning |
|------|-------------|---------|
| `invalid_request`, `unsupported_version` | 400 | Shape/type/encoding or incompatible artifact |
| `unauthenticated` | 401 | Missing/invalid runtime bearer credential |
| `forbidden` | 403 | Operation/path/destination not granted |
| `unknown_operation`, `not_found` | 404 | Unknown operation versus missing entity |
| `conflict`, `busy` | 409 | Stale revision/state versus bounded transient contention |
| `cancelled` | 409 | Work stopped before committed/irreversible effect |
| `too_large` | 413 | Body/frame/blob/collection exceeds registered limit |
| `deadline_exceeded` | 504 | Deadline reached with known no effect |
| `outcome_uncertain` | 504 | Mutation may have taken effect; always `retryable: false` |
| `unavailable` | 503 | Engine/required native capability unavailable |
| `internal` | 500 | Redacted unexpected failure |

HTTP syntax failures before an envelope can be parsed have no safe correlation:
return the HTTP status and close without a v1 body.
Once version/generation/id/operation are recoverable and safe, reply with the
normal response envelope. Do not invent a successful envelope for malformed
input. Before authentication return 401 without reflecting client input.
Private malformed messages fail the channel without reflecting their bytes.

`retryable` describes whether a future caller decision may retry known-safe work;
it is not permission for transport replay. Never replay a timed-out mutation.
An explicit unavailable/cancelled result must not conceal a partial effect.

### Cancellation and deadlines

`control.cancel` is a correlated request with `payload: {"target_id":"ui:1"}`.
Target generation is the envelope generation; cross-generation cancellation is
invalid. Its response is `result: {"state":"accepted"}`, `already_finished` or
`not_found`. This acknowledgement says nothing about rollback. The original
request still has exactly one terminal response (result, cancelled or uncertain).
Cancel success cannot change already committed SQL or partially written tags.

HTTP uses POST `/api/v1/control/cancel`; it is authenticated like every route,
never a browser-to-adapter operation. Native cancellation uses the same envelope
on the private pipe. .3 supplies this routing; .1 only validates its shape.
Client disconnect/AbortSignal does not prove engine cancellation.

`deadline_ms` is an integer relative budget `1..300000`, measured on receipt
with a monotonic clock, not a cross-process absolute timestamp. No clock skew
math. Engine owns request/domain-job budgets; Rust owns native execution budgets
and must clamp the incoming budget to its registered ceiling. Waiting for an
adapter must not hold a DB transaction or global bridge lock. A native
uncancellable call may finish after timeout; report uncertain effects, reject
stale observations and preserve its resources until safe cleanup.

Long jobs return a decimal-free opaque `job_id` promptly. The owning port must
specify `queued/running/succeeded/failed/cancelled/uncertain` state DTOs,
progress and job cancellation operations using this envelope; do not invent a
second job transport or execute an unbounded synchronous call.

## Event revisions and hydration

Zig is the only committed domain-event authority. `sequence` is a monotonically
increasing global stream counter per generation; `revision` identifies committed
domain state and may repeat for several events or jobs without a DB change.
Emit mutation success/events only after commit. Snapshot DTOs include generation,
committed revision and the event sequence watermark captured consistently with
the state. Counters may not wrap: a new generation/snapshot is required.

Subscribe to the one `engine:event` Tauri bridge **before** requesting a snapshot.
Buffer events while fetching; on the matching-generation snapshot discard buffered
events at/below its sequence watermark, then apply contiguous subsequent events.
Ignore duplicate/older sequences and revisions already represented by the state.
A sequence gap, revision regression on a newer event, generation mismatch,
overflow, reconnect or buffer exhaustion invalidates hydration: clear UI domain
state's authority, obtain a fresh snapshot, never blindly replay mutations.
No durable replay log, SSE or parallel WebSocket subscription is provided.
.3 implements bridge delivery; per-domain ports implement snapshot application.

Native observations use their own per-direction monotonic sequence and **no
committed revision**. Audio observations must include `load_id`, `track_id` and
unit-tagged position/status; Zig rejects stale load/generation identities before
queue/session decisions. Raw watcher/media/SDK observations go to Zig, not
directly to domain listeners. Pure shell window/log events remain shell-owned.

## Private handshake, credentials and limits

.2 must bind one child to the parent-created pipes before accepting work:
parent sends private `control.hello` with fresh generation, random nonce,
per-launch bearer credential and expected schema/protocol version. Child checks
the approved schema and responds `control.hello` echoing the correlation and
nonce with supported version/schema. Only then activate the endpoint/adapters.
The nonce and bearer use separate cryptographically random 256-bit values
(64 lowercase hex characters), never generic configurable adapter parameters.
The credential never travels in an argv, generic operation, service snapshot or
browser event. Bootstrap is a shell-only authenticated Tauri invocation.
The private handshake payload and credential handling are implemented in .2,
not accepted through the generic operation registry or HTTP routing in .3.

Pipe possession plus this per-launch handshake binds peers; no credential
enumeration/override operation is permitted. A stale runtime file or arbitrary
process answering HTTP cannot satisfy readiness. The runtime file is owner-only
on Unix and has an equivalent owner ACL on Windows. Do not derive generation
from credentials or serialize/debug-log the handshake/bootstrap.

Bind exclusively to 127.0.0.1, never `0.0.0.0`, LAN interfaces or configurable
remote hosts. Check exact Host/port and configured Tauri Origin before dispatch;
no wildcard/null-origin CORS or cookies. The allowlisted Origin's CORS preflight
may be answered without bearer credentials but performs no operation and
publishes no credentials. Originless private health probes still require bearer
authentication and expected Host. Validate URL destinations/redirects and explicit
file grants per adapter, not just loopback HTTP auth.

Finite v1 ceilings (lower operation-specific limits are allowed; no implicit
unbounded defaults):

| Surface / owner | Ceiling |
|-----------------|---------|
| JSON body or private frame / decoder | 1 MiB UTF-8 excluding LF; tree depth 32 (root depth 0) |
| HTTP header / .2 | 8 KiB total; query/target 8 KiB |
| Error message / codec | 1024 UTF-8 bytes |
| Request budget / codec + engine | 1–300000 ms |
| Read/count, audio/device/mount primitive / engine or Rust | 5000 ms |
| Tag read/write, render, HTTPS request / Rust | 30000 ms per call |
| HTTPS download/SDK streaming job / Rust | 300000 ms per bounded segment, cancellation observed between chunks |
| Startup / shutdown / supervisor | 10000 ms / 5000 ms; no indefinite readiness or drain |
| Requests / .3 dispatcher | 64 in-flight and 128 queued **per direction**, reject excess as busy |
| Events/observations / .3 bridge | 256 queued, ≤8 MiB total; overflow invalidates hydration or stops observation stream, never silent drop |
| UI hydration buffer / .3 | 256 events and ≤8 MiB total, then resnapshot |
| Ordinary list / owning port | 500 rows; explicit pagination required, no implicit music-library-sized frame |
| Inline binary / adapter DTO | ≤64 KiB **decoded**, canonical base64; smaller total frame limit still applies |
| Large binary / adapter | Opaque granted handle, ≤256 KiB chunks; ≤64 MiB artwork/render/HTTPS body; ≤2 GiB scoped media download |

Music files must never appear as inline JSON/base64. Larger permitted downloads
write to an engine-selected, explicitly granted sink with bounded chunk I/O;
responses carry handles/status, not file contents. Zig owns naming/cache/eviction.
No arbitrary file/URL/SQL/executable adapter proxy. Handle owner, generation,
length and lifetime must be checked; release on cancellation/exit. These byte
limits are contract ceilings; actual adapters enforce them in .3 and their
owning ports, not this structural codec. A port must record any lower caps and
its operation DTO before enabling it.

## Executable evidence and handoff

- Rust: `crates/mt-core/src/protocol.rs` (wire-only; no Tauri/SQL imports).
- Zig: `zig-core/src/protocol.zig`.
- Frontend: `app/frontend/js/api/engine-protocol.js` (not legacy `shared.js`).
- All consume `tests/fixtures/engine-protocol/messages.jsonl`; includes valid,
  malformed, unknown version/operation, Unicode, empty/null, cancellation,
  large IDs, errors and precision-loss cases. Rust/Zig also test raw invalid
  UTF-8, arbitrary frame fragmentation/coalescing, CRLF, truncated EOF and size
  poisoning. Frontend validates HTTP bodies/events, not private pipe framing.
- Response helpers check generation/correlation/operation/status without applying
domain state. Event sequencing, authentication, grant enforcement, pending maps
  and timeout execution are **specified here, not falsely proven by codecs**.
- HTTP body readers must enforce the byte ceiling while receiving, before
  buffering or decoding a complete body. The frontend codec accepts an already
  bounded text body; its size check is not a substitute for the future HTTP
  reader's streaming limit.
- No old policy/queries/tests were deleted: no domain capability transferred.
  No benchmark or real-shell readiness result is claimed.

Run `task zig:test` (includes the storage-free protocol fixture root),
`cargo nextest run -p mt-core -E 'test(protocol::)'`, and frontend
`npx vitest run __tests__/engine-protocol.test.js __tests__/api.errors.test.js`.
The JSON Schema itself is compiled by test-only Ajv 2020-12 in Vitest and checked
against the same corpus, with the fixture operation allowlist added separately.
No schema-validator dependency is added to the runtime bundle.
