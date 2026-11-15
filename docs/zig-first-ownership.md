# Zig-first ownership inventory: Rust modules and native capabilities

Baseline: `205a968`, audited 2026-11-15 for TASK-369.5. This is **target ownership**,
not completed ports. [ADR](adr/0001-zig-first-engine.md) fixes the boundary.
[Commands](zig-first-commands.md), [frontend](zig-first-frontend.md) and
[storage/callers](zig-first-storage.md) complete this inventory.

Each path below is relative to the stated crate's `src/`. A grouped row assigns
every named file, not an unspecified directory exemption. `393.n` means
`TASK-393.n`; `329`, `354`, `369.12` are existing linked tasks. “Delete” means
after callers and replacement tests transfer, never before.

## mt-core production modules

| Module(s) | Final owner / consumers | Migration task | Deletion target or retained boundary |
|-----------|-------------------------|----------------|--------------------------------------|
| `lib.rs` | Adapter crate only / desktop | 393.27 | Remove domain exports; remove or deliberately repurpose/rename crate |
| `cache/mod.rs` | Zig cache / playback | 393.19 | Delete Rust policy re-exports |
| `cache/network_cache.rs` | Zig / audio and remote source resolver | 393.19 | Delete cache identity/index, eligibility, eviction and persistence; only scoped byte I/O may remain |
| `cache/mount_detect.rs` | Rust OS primitive / Zig source availability | 393.19, 393.17 | Retain platform query only; no missing-track/cache decisions |
| `db/mod.rs` | Zig / all storage consumers | 354, 393.6, 393.26 | Delete Rust pool, open/init, transactions and UDF registration after final migrator handoff |
| `db/schema.rs` | Zig / startup and fixtures | 354, 393.26 | Temporary Rust sole migrator, then delete schema/migrations |
| `db/models.rs` | Zig / library, queue and protocol DTO consumers | 393.4, 393.5, 393.10 | Delete SQL sort/query policy; wire-only Rust adapter types allowed |
| `db/library.rs` | Zig / browse, scan, reconcile, Plex, agent, playback | 393.4, 393.5, 393.10, 393.11 | Split reads, mutations and play-count/history by operation; delete all production Rust SQL |
| `db/favorites.rs` | Zig / favorites UI, sections, Last.fm | 393.8; read sections 393.5 | Delete favorite SQL and section aggregates after callers switch |
| `db/lastfm_loved.rs` | Zig / Last.fm matcher, favorites | 393.8 | Delete loved-state SQL, not merely UI commands |
| `db/playlists.rs` | Zig / playlists, queue context, agent | 393.9; section reads 393.5 | Delete CRUD, order, naming and membership SQL |
| `db/queue.rs` | Zig / queue and session | 393.14 | Delete SQL **and** shuffle/history/repeat/play-next navigation rules |
| `db/settings.rs` | Zig / service configuration and library query rules | 393.7 | Delete defaults/validation/SQL; also account for non-SQL stores |
| `db/watched.rs` | Zig / watcher and settings UI | 393.7 | Delete folder configuration SQL; scheduling goes to 393.18 |
| `db/lyrics.rs` | Zig / lyrics worker | 393.12 | Delete cache SQL |
| `db/scrobble.rs` | Zig / Last.fm and session | 393.12 | Delete outbox SQL |
| `db/stats.rs` | Zig / stats, agent and chart selection | 393.11 | Delete history/statistics/ranking SQL |
| `db/dedup.rs` | Zig / scanner and reconciliation | 393.10 storage, 393.17 rules | Delete suppression/reinstatement SQL and policy |
| `db/removed.rs` | Zig / library, scan and Plex | 393.10 | Delete removal-identity/suppression SQL |
| `db/revision.rs` | Zig / mutation events and frontend snapshots | 393.10 | Delete revision SQL; revision changes stay in mutation transactions |
| `library/mod.rs` | Zig / command, queue, agent consumers | 393.4, 393.5, 393.10, 393.17 | Delete domain facade/DTO assembly; no permanent Rust forwarding layer |
| `library/queries.rs` | Zig / browse, background and agent queries | 393.4, 393.5 | Delete list/count/stats and track/offset wrappers |
| `library/section.rs` | Zig / section UI, queue contexts | 393.5 | Delete all/liked/top25/recent/added/playlist section assembly |
| `library/mutations.rs` | Zig / library commands, metadata and scan | 393.10, 393.11, 393.30 | Delete delete/locate/status/rescan/reconcile transaction policy; tag primitive retained separately |
| `library/reconcile.rs` | Zig / explicit scan and watchers | 393.17 | Delete backfill, duplicate selection, missing/restored rules |
| `queue/mod.rs` | Zig / queue UI and session | 393.14 | Delete reporter ordering and domain query facade |
| `queue/mutations.rs` | Zig / queue actions | 393.14 | Delete queue changes, shuffle and state/event ordering |
| `queue/navigation.rs` | Zig / session, media intents, end-of-track | 393.14 | Delete navigation/context/install policy; Rust playback sink becomes primitive |
| `queue/types.rs` | Zig domain; wire types only in Rust / queue UI | 393.14, 393.1 | Delete domain response assembly; codecs may retain generated/validated wire DTOs |
| `scanner/mod.rs` | Zig / scan jobs | 393.16 | Delete audio-file eligibility, scan DTO orchestration |
| `scanner/inventory.rs` | Zig / scan/reconcile | 393.16 | Delete traversal and inventory policy |
| `scanner/scan.rs` | Zig / scan/watch jobs | 393.16 | Delete two-phase scheduling/batching |
| `scanner/fingerprint.rs` | Zig / scan and reconciliation | 393.16, 393.17 | Move identity/hash-selection rules; no blanket scanner exception for sha2 |
| `scanner/metadata.rs` | Rust Lofty primitive + Zig normalization / scan jobs | 393.15, 393.16 | Retain parser calls only; delete defaulting/batch scheduling as application policy |
| `metadata/mod.rs` | Rust Lofty primitive + Zig edit workflow / metadata UI | 393.15, 393.30 | Retain tag reads/writes; move validation, track lookup, reconciliation/invalidation |
| `lastfm/mod.rs` | Zig service / Last.fm consumers | 393.20 | Delete domain exports; expose only named retained primitives |
| `lastfm/client.rs` | Zig service; Rust HTTPS primitive / Last.fm worker | 393.20 | Delete auth/discovery/request orchestration; retain request execution only |
| `lastfm/config.rs` | Zig config with Rust credential capability / service | 393.7, 393.20 | No Rust settings policy or browser secret exposure |
| `lastfm/rate_limiter.rs` | Zig / Last.fm worker | 393.20 | Delete application rate/retry scheduler |
| `lastfm/signature.rs` | Zig Last.fm protocol / worker | 393.20 | Move canonical parameter/signature policy; mature digest primitive may be reused, no full-client exemption |
| `lastfm/types.rs` | Zig service + wire DTOs / Last.fm and agent | 393.20, 393.25 | Delete Rust application DTO interpretation, keep only codec needs |
| `plex/mod.rs` | Zig / Plex consumers | 393.21 | Delete domain facade |
| `plex/client.rs` | Zig catalog orchestration; Rust HTTPS execution / Plex | 393.21, 393.22 | Move paging, source/URL selection and response interpretation; no whole-client exemption |
| `plex/merge.rs` | Zig / catalog and library | 393.21 | Delete normalization, matching, identity and transactional merge SQL |
| `plex/types.rs` | Zig domain + wire DTOs / catalog | 393.21 | Delete application interpretation; JSON codecs are not a policy exception |

## mt-tauri production modules

| Module(s) | Final owner / consumers | Migration task | Deletion target or retained boundary |
|-----------|-------------------------|----------------|--------------------------------------|
| `main.rs` | Rust shell / application process | 393.2, 393.27 | Retain entry/device-helper dispatch, not domain initialization |
| `lib.rs` | Rust shell + Zig jobs / startup, media, diagnostics, agent | 393.2, 393.3, 393.7, 393.20, 393.21, 393.25, 393.26, 329 | Retain builder, plugin/lifetime wiring and shell commands; delete DB setup, domain timers, cache decisions and agent wrappers |
| `db.rs` | No production Rust DB / legacy tests | 393.26, 393.27 | Delete re-export facade; fixture replacement under 369.12/.26 |
| `commands/mod.rs` | Rust shell/capability registration only / dispatch | 393.27 | Remove every transferred domain command export |
| `commands/audio.rs` | Rust audio primitive + Zig policy / player and session | 393.13, 393.19, 393.22, 329 | Retain audio worker/control; delete source/cache selection, thresholds, SQL and direct browser session events |
| `audio/mod.rs` | Rust capability / audio worker | 393.13 | Retain decoder/output types only |
| `audio/engine.rs` | Rust Rodio/CPAL / Zig audio requests | 393.13 | Retain load/play/pause/seek/device mechanics and observations; no queue/session policy |
| `audio/audio_error.rs` | Rust capability / audio bridge | 393.13 | Retain typed device/decoder errors, encode safe wire failures |
| `audio/device_isolation.rs` | Rust OS/audio capability / device selection | 393.13 | Retain subprocess crash isolation/enumeration; preserve TASK-392 |
| `commands/favorites.rs` | Zig / favorites UI and Last.fm worker | 393.8, 393.20 | Delete SQL and detached love/unlove policy |
| `commands/lastfm.rs` | Zig / session, settings and background jobs | 393.20, 393.8, 393.12, 329 | Delete auth, loved matching, retry and eligibility rules; no adapter-local SQL |
| `lastfm/mod.rs` | Rust credential boundary + Zig client config / Last.fm | 393.20 | Replace client factory with narrow credential/request capability |
| `lastfm/config.rs` | Rust credential loading / private Last.fm capability | 393.20 | Retain runtime/embedded credential lookup, not defaults/retry/store policy |
| `commands/lyrics.rs` | Zig / lyrics UI | 393.12, 393.23 | Delete cache/fetch/normalization orchestration |
| `lyrics.rs` | Zig lookup policy + Rust HTTPS primitive / lyrics worker | 393.23 | Delete whole service client policy, retain approved transport only |
| `commands/playlists.rs` | Zig / playlist UI, queue and agent | 393.9 | Delete naming, CRUD/order policy and commands |
| `commands/plex.rs` | Zig / settings, catalog, playback | 393.21, 393.22 | Delete configuration, source selection, sync state/scheduling and SQL |
| `plex/mod.rs` | Zig / remote-track callers | 393.21, 393.22 | Delete temporary exports |
| `plex/downloader.rs` | Zig source/cache policy + Rust byte-transfer primitive / playback | 393.19, 393.22 | Delete DB/path naming, caps/settings, cache and playback orchestration |
| `commands/queue.rs` | Zig / queue UI and session | 393.14 | Delete domain command proxies, event ordering and navigation adapter policy |
| `commands/settings.rs` | Zig / all settings clients | 393.7 | Delete generic app `settings.json` defaults/persistence and commands; no blanket Tauri Store exception |
| `commands/stats.rs` | Zig selection + Rust renderer / stats UI | 393.11, 393.24 | Delete SQL/candidate/artwork selection; retain explicit image/text rendering |
| `library/mod.rs` | Zig / library callers | 393.4, 393.5, 393.10, 393.17 | Delete domain re-exports/assembly |
| `library/commands.rs` | Zig / browse, mutations, artwork | 393.4, 393.5, 393.10, 393.11, 393.17, 393.29, 393.30 | Delete wrappers/SQL/shadow fork as operations transfer |
| `library/reconcile.rs` | Zig / explicit reconcile and scan | 393.17 | Delete settings lookup, progress-policy bridge and Connection entry point |
| `metadata.rs` | Zig workflow + Rust tag capability / metadata UI | 393.15, 393.30 | Delete UI command wrappers after workflow transfers; retain private tag primitives |
| `scanner/mod.rs` | Zig + named Rust artwork capability / scan | 393.15, 393.16, 393.29 | Delete core domain re-exports |
| `scanner/commands.rs` | Zig / scan UI, drop and watchers | 393.16, 393.17, 393.29 | Delete job IDs/scheduling, SQL ingestion and DTO policy; primitive calls stay private |
| `scanner/artwork.rs` | Zig resolver + Rust Lofty extraction / all artwork callers | 393.15, 393.29 | Delete folder/embedded preference, fallback and URL policy |
| `scanner/artwork_cache.rs` | Zig / library, playback and charts | 393.29 | Delete Rust LRU including negative-result policy; preserve TASK-391 behavior |
| `watcher.rs` | Zig configuration/scheduling/reconcile + Rust notify primitive / folders | 393.7, 393.16, 393.17, 393.18 | Retain bounded watch registration/raw events; delete SQL, cadence and scan interpretation |
| `agent/mod.rs` | Zig tool/workflow policy + Rust optional SDK / Genius | 393.25 | Delete prompt orchestration, response validation, spread/shuffle and playlist SQL |
| `agent/prompt.rs` | Zig / agent worker | 393.25 | Delete Rust prompt/tool-policy authority |
| `agent/setup.rs` | Zig / onboarding/model management UI | 393.7, 393.25 | Move agent.json, model selection/pull state; Rust only bounded SDK/HTTP execution |
| `agent/tools.rs` | Zig / provider tool requests | 393.25 | Delete SQL and tool authorization/dispatch/selection policy |
| `agent/types.rs` | Zig domain + Rust wire DTOs / agent | 393.25 | Remove Rust domain response builders |
| `sidecar.rs` | Rust shell transport/supervisor / engine and WebView bootstrap | 393.1, 393.2, 393.3 | Retain private bridge/lifetime, replace optional POC readiness/stdout logging |
| `events.rs` | Zig domain events + Rust serialization/forwarding / WebView | 393.1, 393.3, per-domain task | Delete Rust event-policy builders as domains move; one frontend stream |
| `media_keys.rs` | Rust souvlaki/OS capability / Zig media intents and metadata | 393.13, 329 | Retain OS mapping, send intents to Zig not browser navigation |
| `dialog.rs` | Rust native shell / user pickers and approved file grants | 393.3, 393.27 | Retain Tauri/NSOpenPanel primitives; selection is not scan policy |
| `logging.rs` | Rust shell / diagnostics and all adapters | 393.27 | Retain tracing/rotation/slow-call diagnostics with redaction; no domain store |
| `shadow_diff.rs` | Temporary parity harness / migration tests | 393.4, 393.5, 393.27 | Delete production shadow execution after behavior tests transfer |

## Retained capabilities: positive and negative contracts

An adapter may use Rust standard-library I/O for its bounded primitive; that does
not exempt a complete cache, scanner, service client or agent subsystem.

| Capability and justification | Narrow input → output / consumer | Explicitly forbidden ownership | Task |
|------------------------------|------------------------------------------------|-------------------------------|------|
| Rodio 0.21 / Symphonia / CPAL | Validated resolved source + load identity; play/pause/stop/seek/volume/device → status, position, device/decoder error, ended observation / Zig queue/session | SQL, next-track selection, cache/Plex resolution, shuffle/repeat, scrobble/play-count eligibility | 393.13, 329 |
| Audio device isolation / OS process APIs | Enumerate/select request → bounded device results or process failure / Zig | Independent device preference persistence or session recovery policy | 393.13 |
| Lofty 0.22 | Granted file + explicit read/write fields → tags/properties/art bytes or per-file error / Zig scan/edit/resolver | Track identity, batching policy, DB writes, reconciliation, artwork fallback/cache | 393.15, 393.30 |
| image 0.25, imageproc 0.25, ab_glyph 0.2 | Explicit images/text/layout/font options → encoded chart or render error / Zig chart worker | Candidate ranking, library queries, source/artwork selection or second negative cache | 393.24 |
| notify-debouncer-full 0.5 / notify platform backend | Explicit bounded watch registration/cancel → raw/debounced filesystem observations/errors / Zig watcher | Scan cadence, track interpretation, DB mutations, duplicate selection; engine owns application coalescing | 393.18 |
| Unix libc mount APIs; Windows windows-sys GetDriveTypeW | Validated path → mount/device availability classification/error / Zig source resolver | Declare library tracks missing, evict cache, choose fallback source | 393.19, 393.17 |
| reqwest 0.12 + native-tls / platform trust and system proxy | Allowlisted destination/method, explicit bounded headers/body or scoped download sink → response/status/body chunks/error / Zig service workers | Retry/rate schedules, catalog paging/merge, cache keys/eviction, credentials in snapshots, arbitrary URL/file proxy | 393.19–393.23 |
| Optional rig-core 0.27 provider SDK, schemars codec support | Explicit provider/model/messages and tool schemas → provider tokens/tool-call proposals/usage/errors / Zig agent worker | Execute tools, choose/validate tracks, mutate playlists, own prompt loop or onboarding | 393.25 |
| Runtime/embedded Last.fm credential loading | Private credential reference → signed/request execution or private resolved credentials only where necessary / Zig service | Generic secret enumeration, browser exposure, auth/retry state; MD5 is not an excuse to retain Last.fm policy | 393.20 |
| souvlaki 0.8, tauri-plugin-global-shortcut, raw-window-handle | OS media intent → Zig; explicit metadata/playback state → OS Now Playing / Zig session | Browser-mediated queue advance, policy timers or app settings | 393.13, 329 |
| Tauri 2 / shell/dialog/opener/store plugins; objc2 AppKit/Foundation, dispatch2 | Window/process lifetime, app-data paths, user file selection/reveal/export → native result/grant/error / WebView and Zig | General app settings in a parallel store, arbitrary filesystem capability, domain SQL; store exception only for explicitly shell-only state | 393.2, 393.3, 393.7, 393.27 |
| tracing/subscriber/appender | Redacted structured diagnostic record → logs/export / shell | Service state or a second application event authority | 393.27 |

The byte-transfer adapter exposes scoped OS/network I/O, not a reason to keep
Tokio orchestration or every reqwest caller in Rust. JSON parsing and hashing
alone are not mature-subsystem exceptions. Zig may use mature C primitives
without expanding the Rust boundary.

## Test modules and replacement ownership

Test files are part of the audit, but are not production adapter exceptions.
Inline `#[cfg(test)]` modules follow their enclosing file's task. Before deleting
a test, record its new suite/test or why its old implementation-only assertion
is obsolete; keep temporary parity only as long as useful.

| mt-core test module(s) | Replacement / consumers | Task and disposition |
|-----------------------|-------------------------|----------------------|
| `db/benchmarks.rs`, `scanner/benchmarks.rs` | Historical performance checks | 393.27: no new timing gate; preserve useful correctness separately, justify obsolete benchmark deletion |
| `db/compat_test.rs`, `db/sort_key_test.rs` | Zig schema/sort/compatibility fixtures | 354, 393.4, 393.26; replace before deletion |
| `db/dedup_scope_test.rs` | Zig reconciliation regressions | 393.17 |
| `db/queue_props_test.rs` | Zig queue properties | 393.14 |
| `lastfm/client_tests.rs`, `lastfm/types_tests.rs` | Zig service fake responses + Rust transport-only tests | 393.20 |
| `metadata/tests.rs` | Rust Lofty format tests + Zig edit workflow tests | 393.15, 393.30 |
| `library/queries_tests.rs`, `library/queries_read_tests.rs` | Zig list/count/lookup tests | 393.4, 393.5 |
| `library/section_tests.rs`, `library/section_dispatch_tests.rs` | Zig section/view-model tests | 393.5 |
| `library/mutations_tests.rs`, `library/mutations_track_tests.rs` | Zig transactional mutation tests | 393.10, 393.11, 393.30 |
| `library/reconcile_tests.rs`, `library/reconcile_cross_dir_tests.rs` | Zig fingerprint/dedup/recovery tests | 393.17 |
| `library/test_util.rs` | Isolated Zig fixture utilities | 369.12, 393.4–393.17; delete Rust helper after consumers |
| `queue/mod_tests.rs`, `queue/types_tests.rs`, `queue/mutations_tests.rs`, `queue/navigation_tests.rs`, `queue/play_context_tests.rs`, `queue/test_util.rs` | Zig queue/state/context properties and fixtures | 393.14; Rust audio sink tests remain primitive-only |

| mt-tauri test module(s) | Replacement / consumers | Task and disposition |
|------------------------|-------------------------|----------------------|
| `audio/engine_test.rs` | Rust actual decoder/output/device tests | 393.13: retain, isolate platform limits |
| `agent/evals.rs` | Zig fake-provider/tool workflow; Rust provider codec tests only | 393.25: remove hidden eval SQL |
| `concurrency_test.rs` | Zig storage/domain concurrency + Rust primitive concurrency | 369.12, 393.6, per-domain task: replace rather than retain production DB dependency |
| `db_fixture_gen.rs` | Isolated deterministic engine fixtures | 369.12 then 393.26: retire Rust schema generator |
| `shadow_diff_parity_test.rs` | Zig fixture/contract tests and actual boundary integration | 393.4, 393.5, 393.27: retire duplicate engine comparison |

Examples outside `src/`, Cargo/build scripts, shell capabilities and inline HTML
must also be checked at final deletion. In particular the audio example remains
an adapter consumer, not permission for production DB access.
