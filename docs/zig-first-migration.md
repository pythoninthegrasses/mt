# Zig-first migration: execution and handoff guide

[ADR-0001](adr/0001-zig-first-engine.md) is accepted. This guide and the linked
inventories describe the target, **not implemented migration results**.
Baseline: `205a968`, 2026-11-15; TASK-369.5 reviewed all 30 TASK-393 children
plus TASK-354, TASK-329 and TASK-369.12.

## Freeze and scope

No new product features until TASK-393.28 verifies completion and TASK-393 closes.
Bugfixes, reliability repairs and migration-required refactors remain allowed.
Preserve TASK-391 artwork recovery and TASK-392 native audio fixes. A port must
not implement deferred keyset pagination, mobile/iOS features, new chart ranking,
lyrics-based agent validation or a preview/refine/approve agent workflow.

Existing DB/music data is not disposable. Preserve behavior and report partial
failures; do not solve migration by deleting `mt.db` or unlinking source files.
No arm-B experiment, destructive cache wipe, CI timing matrix or new benchmark
campaign is part of this migration.

## Approved sequence

Follow **dependency edges**, not numeric suffix order. The table is an inventory
cross-check; Backlog remains the scheduling authority. Every row's output is used
by later tasks and must name changed callers, replacement tests and deletions.

| Task | Bounded output / prerequisite relationship |
|------|------------------------------------------|
| TASK-369.5 | Accepted decision and complete ownership baseline |
| TASK-393.1 | Executable HTTP/NDJSON envelopes, limits, errors, IDs, cancellation and shared fixtures, after this ADR |
| TASK-354 | Version-0/fresh/current schema safety, Rust sole migrator until .26 |
| TASK-369.12 | Isolated engine/adapter/shell tests, **populated** deterministic fixture generation; follows .1 |
| TASK-393.2 | Verified endpoint/readiness, bounded startup/exit/failure, signing/runtime-file security; follows .1 |
| TASK-393.3 | Private capabilities, native observations and single frontend event bridge; follows .1/.2 |
| TASK-393.4 | Library list/count/aggregate reads + every consumer; follows .1/.2/369.12 |
| TASK-393.5 | Sections, track/missing lookup, prefix/track offsets and existing artist/album read-model consumers; follows .4; see scope risk below |
| TASK-393.6 | Writable transactions with version checks, **no migrations**; follows TASK-354/.1/.2 |
| TASK-393.7 | Settings, watched-folder configuration and non-SQL persisted app preferences; follows .6/.3 |
| TASK-393.8 | Local favorites/loved storage, no network scheduler; follows .6/.3/.5 |
| TASK-393.9 | Playlist storage/order/naming and actual existing callers; follows .6/.3/.5; no invented import/export feature |
| TASK-393.10 | Atomic track/removal/dedup/revision storage, not scan/dedup algorithm; follows .6/.3/.5 |
| TASK-393.11 | History/play counts/statistics storage and queries; follows .6/.3/.5 |
| TASK-393.12 | Scrobble outbox and lyrics-cache storage; follows .6/.3 |
| TASK-393.13 | Private Rodio/CPAL/audio-device primitives and observations, no queue/SQL; follows .3 |
| TASK-393.14 | Queue/context/shuffle/repeat/navigation authority; follows .13/.9/.10/.5 |
| TASK-393.15 | Private Lofty tag/artwork primitives; follows .3 |
| TASK-393.16 | Bounded scan traversal, metadata batching and ingestion jobs; follows .15/.10/.7/.3 |
| TASK-393.17 | Reconciliation/dedup/missing/restored selection policy; follows .16/.10 |
| TASK-393.18 | Zig watch interpretation/cadence plus retained raw native watcher; follows .17/.7/.3 |
| TASK-393.19 | Media cache/source policy, not Plex-specific workflow; follows .7/.13/.3 |
| TASK-393.20 | Last.fm auth/submission/retry/loved orchestration; follows .12/.8/.7/.3 |
| TASK-393.21 | Plex config/catalog/paging/merge policy; follows .10/.7/.3 |
| TASK-393.22 | Plex download-on-play and prefetch through queue/cache; follows .21/.19/.14 |
| TASK-393.23 | Lyrics cache/fetch/normalization orchestration; follows .12/.3/.5 |
| TASK-393.29 | **Shared** artwork resolver/cache, before session/chart/edit; follows .15/.7/.5 |
| TASK-329 | Zig session snapshot/eligible listening/scrobble timing; follows .14/.29/.20/.11 |
| TASK-393.24 | Chart candidate/composition policy plus narrow Rust renderer; follows .11/.15/.29 |
| TASK-393.25 | Optional agent tool/prompt/workflow/playlist policy; follows .5/.9/.20/.23/.3 |
| TASK-393.30 | Metadata edit validation, file-write results, DB reconciliation/invalidation; follows .15/.10/.29/.3 |
| TASK-393.26 | Sole Zig DB/migrator handoff after every DB domain/caller; retire Rust SQLite stack, fixtures/evals included |
| TASK-393.27 | Delete already-transferred domain code/proxies/tests, enforce boundary, repurpose/remove mt-core; follows .26/.19/.22/.24/.25/369.12 |
| TASK-393.28 | Real shell/behavior/package/failure verification; follows .27/.2/.3/TASK-329/369.12; only then release freeze |

### Cross-check findings raised before capability implementation

1. **TASK-393.5 size risk:** artist/album grouping currently lives in frontend
   `utils/artist-utils.js`, browser components and library-store getters.
   Canonical artist voting/casing, compilation rules, dominant-disc ordering and
   local source visibility must not survive as hidden domain policy. They are
   assigned to .5/.21 in the inventory, but are larger than merely adding a track
   lookup route. Before .5 implementation, explicitly review its bounded plan;
   split artist/album read models if this exceeds one reviewable capability.
   This ADR does not silently add a new task or defer the policy to cleanup.
2. **TASK-393.9 mismatch:** no M3U/import/export implementation was found in
   current `app/frontend` JS/HTML or Rust source. Its “existing M3U” premise is
   unverified. Recheck the starting revision and raise any task-criteria
   correction with the maintainer; preserve actual existing behavior, do not
   implement new playlist import/export just to satisfy that wording.
3. **TASK-393.7/.25 persistence:** `settings.json` and `agent.json` are real
   storage owners outside SQL. Their import/precedence and removal are explicit
   work, not Tauri-only exemptions. .7 owns settings import and .25 consumes
   migrated onboarding/model state.
4. **TASK-393.13 / TASK-329 staging:** audio-thread 75% play counts and configurable
   scrobble threshold state are policy, not decoder mechanics. .11/.12 transfer
   their storage first; TASK-329 transfers eligibility. .13 must isolate the
   old authority until then, not copy it into the permanent adapter. Native
   media/end observations reach the one live queue authority at each stage.
5. **TASK-393.25 SDK boundary:** rig-core is not an exemption for executing
   registered Rust tools. Provider output is a proposal; Zig owns dispatch,
   validation, postprocessing and writes. Extraction may require reviewable
   substeps, but unported agent policy blocks .26/.27 rather than becoming a
   “temporary” permanent adapter.
6. Shared artwork (.29) and edit workflow (.30) **already have separate tasks**.
   Do not fold them into the renderer, session or scan implementation.

These findings are raised risks/questions, not approval of new features or
silent changes to the task graph. Create/split tasks only after the project's
plan-review and ID-collision checks.

## Background jobs and callback ownership

All paths are current source anchors, not proposed new APIs. Transport/native
mechanics can retain Rust workers, but application timers/jobs end in Zig.

| Current job / entry point | Consumers / final owner | Task / delete or retain |
|---------------------------|-------------------------|-------------------------|
| `lib.rs` delayed watcher start (2s), watcher cadence loops | Watched folders / Zig lifecycle policy | .7/.18 delete Rust delay/cadence; Rust retains notify callback registration only |
| `lib.rs` delayed startup Plex sync (1s) | Remote library / Zig catalog job | .21 delete Rust startup scheduler |
| `lib.rs` scrobble retry (30s initial, 300s loop) | Last.fm outbox / Zig | .12/.20 delete Rust timer and SQL |
| `lib.rs` loved matcher (60s initial, 1800s loop) | Loved/favorites matching / Zig | .8/.20 delete Rust timer and SQL |
| `lib.rs` network-cache init/settings and exit purge | Playback cache / Zig | .7/.19: engine controls policy/cleanup; shell only shutdown deadline |
| `commands/audio.rs` audio worker/control loop | Device/decoder / Rust capability | .13 retain worker/stall observation mechanics, send identity-tagged observations to Zig |
| `commands/audio.rs` detached play-count/scrobble writers | History/session / Zig | .11/.12/TASK-329 delete SQL threads and threshold state |
| `audio/device_isolation.rs` enumeration helper, pipe reader threads and timeout | Device query / Rust OS capability | .13 retain bounded crash-isolated mechanics, no domain scheduling |
| `commands/favorites.rs` detached love/unlove task | Favorite UI and remote sync / Zig | .8/.20 delete Rust service orchestration |
| `commands/lastfm.rs` matching task and rate-limited service loops | Last.fm and scan results / Zig | .20 delete worker policy; SDK/HTTPS primitive cannot schedule retries |
| core `lastfm/rate_limiter.rs` waits | Last.fm requests / Zig | .20 move service rate policy |
| `scanner/commands.rs` scan/metadata/backfill blocking work; core `scanner/scan.rs`/Rayon parsing | Scan UI / Zig job and bounded Rust parse requests | .15/.16/.17 delete Rust scan scheduling; keep parser worker implementation only |
| `watcher.rs` periodic task, notify callback, rescan blocking work | Folder changes / Zig interpretation | .18 raw events to Zig, reuse .16/.17, delete callback SQL/scan decisions |
| `library/commands.rs` shadow diff spawn | Migration diagnostics / temporary tests | .4/.5/.27 delete production comparison |
| `library/commands.rs` reconcile blocking work | Settings reconcile / Zig | .17 delete Rust scheduling/Connection |
| `plex/downloader.rs` download execution and progress | Remote playback / Zig job + Rust scoped transfer | .19/.22 move identity/path/cap/partial-state decisions; retain bounded byte I/O |
| `agent/setup.rs` model-pull stream; agent provider/tool calls | Genius/onboarding / Zig jobs + Rust SDK | .25 remove Rust pull/onboarding/tool policy; progress enters engine event stream |
| `sidecar.rs` stdout/stderr receiver and health probe | Engine lifecycle / Rust shell | .2/.3 retain supervisor, replace stdout logging with framed dispatcher and verified readiness |
| `dialog.rs` native picker blocking invocation | User selection / Rust shell | .3 retain OS UI work only |
| `media_keys.rs`/`lib.rs` OS shortcut callbacks | Playback intents / Rust mapping → Zig policy | .13/TASK-329 remove browser-driven navigation |
| Frontend queue prefetch worker and startup reset | Queue/remote playback / Zig | .14/.22 move domain lifecycle, retain UI pending state |
| Frontend player track-end/media listeners and now-playing calls | Playback/session / Zig | .14/.20/TASK-329 remove session authority, apply snapshots |
| Frontend library refresh/Plex progress, lyrics lookup and settings/model status timers | Views / Zig jobs + UI cache refresh | .3/.21/.22/.23/.25 move domain work, keep bounded UI fetch/debounce only |

Rust files in this table are relative to `crates/mt-tauri/src/` unless labelled
core. Inline/standalone tests spawning threads are test mechanisms, mapped in
the [module inventory](zig-first-ownership.md), not production jobs.

## Worker and command conventions

1. Read the current task, this ADR/inventory and prerequisite outputs. Select
   one eligible capability, mark it In Progress and record its researched plan.
   Do not start unrelated migration children automatically.
2. Maintain one authority per transferred operation. Update HTTP consumers,
   private adapter clients, events and test fixtures in coordinated changes.
   List remaining callers by task; temporary clients do not own policy.
3. Use atomic commits and no backup files. Keep files under 500 lines.
   A contract/version change may update Zig, Rust, JS and packaged metadata
   together; no stable third-party API or long-lived version shim is required.
4. Treat absence as an error when a dependency is required. Mock-browser,
   placeholder-sidecar or zero-test fixture success is not real integration.
5. Record replacements for removed tests and code. Update the inventory at
   each capability transfer; TASK-393.27 audits rather than ports missed domains.

Use Taskfile commands; inspect current task definitions before running:

```bash
task zig:lint
task zig:test
task zig:build
task zig:cross-compile ZIG_TARGET=aarch64-macos
task zig:stage TARGET=aarch64-apple-darwin
task lint
task format
task test
task test:e2e
```

`ZIG_TARGET` is a Zig triple; staging `TARGET` is a Rust triple. Existing other
targets are x86_64-macos, x86_64-linux, x86_64-windows and their explicit staging
map. No system frameworks in Zig; native SDKs stay in Rust. Do not strip the
staged Apple Silicon binary (invalidates its signature).

Focused current transitional Rust tests use `cargo nextest run -p mt-core`;
retained audio/metadata/transport tests remain Rust. Zig domain tests must
ultimately need neither a desktop link nor a staged placeholder.
TASK-369.12 owns fixture invocation repair: `task zig:fixture` is not trusted
until the exact generator actually runs and a nonempty schema/data fixture is
verified. All tests use disposable databases, never the user's `mt.db`.

Vitest owns frontend state/snapshot logic, Zig owns transferred domain rules,
Rust owns native primitives, and real-interaction Playwright covers UI wiring.
Actual Tauri-webview, audio, process lifecycle, migration and package/signing
checks have separate evidence and platform limits. Never claim a mocked
browser proves them. TASK-393.28 gathers correctness evidence, not speed claims.

## Completion inventory

- [Rust modules, tests and named capability exceptions](zig-first-ownership.md)
- [All 142 registered commands and consumers](zig-first-commands.md)
- [Frontend business logic versus UI state](zig-first-frontend.md)
- [Every DB domain and direct caller, including non-SQL stores](zig-first-storage.md)
- [Historical measurements and explicit unknowns](zig-first-evidence.md)

The final gate checks fresh/upgrade/unavailable/shutdown/relaunch/offline flows,
actual frontend → Zig → Rust round trips, optional agent builds and existing
cross-platform staging/signing/ACL requirements. Unresolved required platform
evidence is a blocker, not a mock pass. No feature is unfrozen by merely landing
the ADR or deleting a Rust module.
