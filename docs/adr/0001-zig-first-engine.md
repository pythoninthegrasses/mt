# ADR-0001: Zig-first application engine with narrow Rust capabilities

**Status:** Accepted

**Decision:** Maintainer, 2026-11-14; transport approved 2026-11-15

**Tracking:** TASK-369.5 and TASK-393

## Context

The maintainer has selected Zig as mt's primary application language. This is
not a hypothesis requiring a language benchmark to approve it. TASK-353 extracted
the useful, Tauri-independent `mt-core`; TASK-355.6 demonstrated a bundled,
authenticated, read-only Zig library endpoint with a shadow-diff harness.
That POC is additive, not a completed engine migration or evidence of a speedup.

mt is greenfield software with effectively no userbase, but existing music files
and databases are valuable. Preserve current behavior, fresh installs and existing
`mt.db` data. Do not build a permanent dual-engine compatibility platform.

## Decision

Zig owns SQL, library rules, queue/session state machines, scanning/reconciliation,
artwork/media-cache policy, statistics selection and service/agent orchestration.
The WebView owns presentation and interaction state, not a fallback engine.

Retain Rust for Tauri, OS integration and **named mature-library capabilities**:
Rodio/Symphonia/CPAL, Lofty, image/imageproc/ab_glyph, filesystem notifications,
platform mount detection, HTTPS transport and the optional provider SDK.
An exception covers a primitive, not its surrounding application policy.
Adapters cannot open `mt.db`, select queue items, schedule service retries or
interpret agent tools. Mature C libraries, including SQLite, are allowed.
Do not handroll codecs, tag parsers or TLS merely to remove Rust.

### Process and transport

```text
WebView -- authenticated loopback HTTP requests --> Zig engine --> SQLite
WebView <-- Tauri event bridge <-- Rust <-- private stdout events -- Zig
                                 Rust <== private stdin/stdout ==> Zig
                                 audio / tags / HTTPS / OS / SDK capabilities
```

- Rust owns one engine child per application instance, its private pipes,
  platform paths, packaged binary selection and shutdown. No browser-owned child.
  The supervisor holds an OS-released exclusive instance lock for the canonical
  DB/runtime location. A second launch must not overwrite the live endpoint or
  start another migrator; report the existing-instance condition instead.
- Domain requests go directly from the WebView to Zig's ephemeral
  `127.0.0.1` HTTP listener, using a per-launch bearer token in a header.
  Tauri invoke remains for shell-only actions and endpoint bootstrap.
- Private bidirectional capability/control traffic uses **UTF-8 newline-delimited
  JSON (NDJSON)** over the child's stdin/stdout, not a second HTTP listener.
  One JSON object per LF-terminated frame; embedded newlines are JSON escaped.
  Stdout is protocol-only; stderr is diagnostics. Decoders must handle fragmented
  and combined reads, enforce size limits before unbounded buffering, and reject
  malformed/oversized frames. Do not assume a pipe read is one message.
- Zig requests allowlisted Rust capabilities. Rust returns correlated results;
  native observations/user intents travel back to Zig on the same private pipe.
  Parent-created pipe possession plus a per-launch handshake binds the peers;
  no operation accepts an arbitrary executable, SQL or unrestricted path.
- Zig domain events travel over stdout to a **single Tauri event bridge**.
  Native audio/media/watch observations first reach Zig; they are not also
  domain events sent directly to browser listeners. Pure window/log events
  remain shell-owned. No parallel SSE/WebSocket domain subscription.
- Transitional Rust domain callers use the same Zig HTTP operations. Such clients
  are temporary consumers, not retained domain proxies; remove them with their
  owning port. No silent Rust fallback after an operation transfers.

### Requests, events and failures

- Both boundaries use a versioned envelope with request ID, operation and typed
  payload. A response echoes the ID and has exactly one result or structured
  error (`code`, safe `message`, `retryable`, optional safe details).
  TASK-393.1 defines executable schemas/fixtures, field names and numeric limits.
- IDs, revisions and potentially 64-bit integer counters cross JavaScript as
  decimal strings. Timestamps have explicit units; no implicit floating-point
  conversion of SQLite IDs. Null and absent fields are distinct.
- HTTP status and error code agree: invalid request, unauthenticated, forbidden,
  missing entity, conflict/busy, unavailable and internal failure are distinct.
  A network/child failure is never a successful empty library.
- Correlation is scoped to an engine generation. Capability requests carry an
  operation identity; audio observations also carry load/track identity.
  Out-of-order old observations cannot advance a newer queue item.
- Events identify generation, stream sequence and committed domain revision.
  Zig emits successful mutations only after commit. The frontend ignores
  duplicates/older events; a gap, restart or reconnect requires a fresh snapshot.
  Subscribe before fetching the snapshot and buffer/reconcile concurrent events.
  No durable event log or permanent replay compatibility service is required.
- The engine owns domain-job cancellation/deadlines; Rust owns adapter execution
  deadlines and the supervisor owns startup/shutdown deadlines. Bounded queues
  and in-flight limits apply in both directions. Dispatch must not hold a DB
  transaction or global bridge lock while waiting for a callback.
- Cancellation is acknowledged but cannot promise to undo committed SQL or a
  partially written tag. A timed-out mutation may have committed: return an
  explicit uncertain outcome and resynchronize, **never blindly retry it**.
  Job operations return an identity and expose completion/cancellation state.
  TASK-393.1 fixes finite per-operation limits, including blob handling; .3
  implements them. No unbounded messages containing a music file.

### Security and lifecycle

Loopback is not authentication. Validate bearer credentials, Host and browser
Origin against the actual configured Tauri origins; do not use wildcard CORS or
cookie-based auth. Restrict runtime-file access (owner permissions on Unix,
approved equivalent/ACL on Windows); never log tokens. The endpoint is published
only after an authenticated, compatible per-launch handshake. A stale file or
unrelated process cannot satisfy readiness. Adapter inputs are operation-scoped
and validated, including allowed file roots/explicit picker grants and URL
destinations. Secrets used by adapters are private credential references where
possible; service credentials do not belong in browser snapshots.

**During migration:** Rust resolves app-data paths and exclusively creates/
upgrades the DB before launching a compatible Zig engine. TASK-354 establishes
schema versions, locking and explicit version-0 handling. Until that lands, the
POC's current initialization is not a proven version-safety contract.
Zig checks compatibility; TASK-393.6 adds writes, **not a second migrator**.
Unported Rust domains may temporarily write their own operations; a transferred
operation has one authority, including multi-table transactions.

Keep the current SQLite baseline: WAL at database initialization, foreign keys
on every connection, 5000ms busy timeout, `synchronous=NORMAL` and
`cache_size=-64000`; register matching sort UDF semantics on each connection.
Use bounded writes and explicit busy/conflict results. TASK-354/.6 test and
document any required adjustment centrally; individual domains cannot choose
different migration, locking or connection semantics.

Start adapters and complete handshake/schema checks before accepting domain
requests or starting scan/watch/service jobs. UI shell/error display may open
when the engine is unavailable, but domain initialization must not race readiness
or use the POC's default port. Failure is visible and bounded.

**Final handoff (TASK-393.26):** Zig alone opens/creates/migrates `mt.db`.
Rust starts the child and awaits migration plus adapter readiness; it no longer
initializes SQLite. Test fresh, populated unversioned, current, newer unsupported
and failed/interrupted upgrades without deleting data.

On engine loss, invalidate endpoint/generation, fail pending requests, stop
accepting work and quiesce audio/watch callbacks safely. Do not keep an
uncontrolled player running with no policy owner. Restart is explicit and
bounded, with new credentials and snapshot hydration, not mutation replay.
On exit, stop new work, cancel/drain engine jobs, stop/unregister native
capabilities, close storage, then reap the child; force-kill only after a bounded
grace period. TASK-393.2/.3 implement this, not this documentation task.

## Alternatives

| Alternative | Disposition |
|-------------|-------------|
| Keep lean split Rust as the engine | Useful intermediate isolation, but not the maintainer's chosen primary language |
| Keep an additive permanent hybrid | Rejected: duplicate policy, SQLite stacks and ambiguous ownership |
| Remove all Rust | Rejected: needless replacement of mature libraries and platform integration |
| Route all domain requests through Tauri | Rejected for the target: retains a domain forwarding surface; existing HTTP POC is the chosen request boundary |
| A second loopback adapter server or browser-driven adapters | Rejected: extra exposed surface or dependence on a live browser for policy execution |

## Consequences

**Benefits:** one identifiable policy/storage authority, portable engine tests,
narrow reviewable native interfaces and removal of duplicate domain paths.

**Costs/risks:** cross-process latency/failure, serialization and ownership
discipline, bounded blob transport, two build toolchains during migration,
temporary duplicate SQLite compilation, and a substantial parity/test-transfer
effort. Native SDKs and actual shell/package checks remain platform-dependent.
Neither faster builds nor lower memory is established by this decision.

Freeze new product features until TASK-393.28 verifies the migration.
Bugfixes and migration-required refactors are permitted; preserve TASK-391/392
artwork/audio fixes. Ports must not smuggle deferred pagination, charts, mobile
sync or new agent flows into the migration.

The internal wire contract, adapters and platform packaging may change together
in one coordinated release. Version checks detect mismatched artifacts; they do
not imply a permanent multi-version public API. Database upgrades remain
data-preserving even when internal callers change atomically.

## Implementation and evidence

- [Migration sequence and worker conventions](../zig-first-migration.md)
- [Rust/module ownership](../zig-first-ownership.md)
- [Every registered command](../zig-first-commands.md)
- [Frontend ownership](../zig-first-frontend.md)
- [Storage and direct database callers](../zig-first-storage.md)
- [Historical measurements and limits](../zig-first-evidence.md)

TASK-393.1 implements schemas; .2 supervises; .3 bridges capabilities/events.
The inventory is a migration baseline, not a claim that the listed ports exist.
