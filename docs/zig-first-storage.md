# Zig-first ownership inventory: storage and direct callers

Baseline `205a968`, 2026-11-15. [ADR](adr/0001-zig-first-engine.md) fixes the
single-migrator arrangement. Task suffixes mean TASK-393.

## Database domains

All final owners below are **Zig**. Consumers must stop opening Rust connections
as each operation transfers; the adapter boundary cannot pass a Connection.
Storage migration includes preservation of IDs, constraints, nulls, timestamps,
transaction boundaries and current data—not just retyping SQL.

| Table / domain | Current module / consumers | Transfer task / deletion target |
|----------------|----------------------------|---------------------------------|
| `library` read/filter/count/duration | core db/library + library/queries; UI, queue, agent, services | .4/.5 delete Rust read SQL/wrappers |
| `library` upsert/delete/path/missing/fingerprints/source IDs | core db/library + library/mutations; scan/watch/Plex/edit | .10 storage, .16/.17/.21/.30 workflows; delete Rust writes |
| `library` play_count/last_played and `play_history` | core db/library + db/stats; audio thread, session, stats/agent | .11 storage, TASK-329 eligibility; delete Rust writes/aggregates |
| `favorites`, `library.lastfm_loved`, `lastfm_loved_tracks` | core db/favorites, db/lastfm_loved; UI and Last.fm/scan matching | .8 storage, .20 sync; delete SQL and local matching rules |
| `playlists`, `playlist_items` | core db/playlists; sidebar, contexts, agent | .9; delete CRUD/order/naming SQL |
| `queue`, `queue_state` including original order/history/pins | core db/queue; queue/navigation/player | .14; delete Rust queue SQL/state machine |
| `settings` | core db/settings; Last.fm, library ignore words, service config | .7; delete Rust SQL/defaults |
| `watched_folders` | core db/watched; watcher/settings/scan timestamps | .7 configuration, .16/.18 scan scheduling; delete Rust SQL |
| `lyrics_cache` | core db/lyrics; lyrics commands/worker | .12 storage, .23 orchestration; delete Rust cache SQL |
| `scrobble_queue` | core db/scrobble; audio eligibility/retry/status | .12 storage, .20 submission, TASK-329 eligibility; delete Rust SQL |
| `removed_tracks` | core db/removed; scan/reconcile/Plex/library deletes | .10 storage, .17/.21 interpretation; delete Rust suppression SQL |
| `deduplicated_tracks` | core db/dedup; scan/reconcile | .10 storage, .17 selection/reinstatement; delete Rust SQL/policy |
| `library_revision` | core db/revision; all library mutations and UI | .10; increment atomically with corresponding changes, delete Rust revision writer |
| schema, indexes, triggers, PRAGMAs and sort UDF | core db/schema, db/mod, db/models; every opener | TASK-354 temporary Rust migrator; .6 checked Zig writes; .26 sole Zig migrator/openers; delete Rust schema/pool |

Multi-domain operations must not be split into HTTP calls that lose their old
transactional invariant (delete + removal suppression + revision, dedup merges,
queue installation, playlists with membership). The operation owner supplies a
bounded atomic engine operation; do not let separate processes write half each.

### Persistent state outside SQLite

| Store / state | Current consumers | Final owner / task and removal |
|---------------|-------------------|--------------------------------|
| `settings.json`: app/UI preferences, cache limits, Plex config, audio device, dedup options, view caches | commands/settings, lib.rs, audio, Plex, downloader, reconcile, frontend settings service | Zig .7; .19/.21/329 consume typed settings. Import existing values before retiring Rust store writes; define precedence with DB settings and preserve unknown keys until classified |
| `agent.json` / `agent_onboarding` | agent/setup and Genius | Zig .7/.25; migrate current state/default model, delete Rust onboarding store |
| Legacy localStorage/Alpine persist settings | sidebar/ui/column settings and bootstrap | Zig durable app preferences .7; frontend may cache display state, never silently overwrite imported engine preferences |
| Network/download disk files and index | core cache/network_cache, Plex downloader, startup/exit | Zig .19/.22 owns complete/partial identity, bounds and cleanup; Rust byte I/O scoped to explicit cache destinations |
| Artwork positive/negative cache | scanner/artwork_cache, library/player/charts plus UI URLs | Zig .29; invalidate on metadata/source recovery, delete competing cache policies |
| Runtime port/token file | sidecar/runtime bootstrap | Rust-supervised launch-local state .2, not application persistence; private permissions/ACL and stale-generation protection |

No currently documented generic “Tauri Store” exemption permits app preferences
to stay in Rust. Any future retained window-only state must be enumerated and
kept separate from domain/application settings. Preserve stored secrets without
exposing them to browser snapshots or printing store contents in diagnostics.

## Direct desktop DB callers

Paths below are relative to `crates/mt-tauri/src/`. Line references identify every
direct `with_conn`, `.conn()`, `.transaction()` or explicit `rusqlite::Connection`
site at the baseline, including helpers that bypass Tauri commands. References
are snapshot anchors, not stable API names. Final owner for all production rows:
Zig; replace with the transferred operation, then delete Rust access.

| Caller / exact baseline sites | Consumers and ownership transfer | Task / deletion gate |
|------------------------------|----------------------------------|----------------------|
| `lib.rs:738,774` | Startup scrobble retry and loved-match loops | .12/.8 storage then .20 scheduling; delete timers/SQL, not just their commands |
| `commands/audio.rs:423,449` | Detached play-count and scrobble threshold writers | .11/.12 storage, TASK-329 eligibility; no DB in final .13 adapter |
| `commands/favorites.rs:49,61,108,127,145,191,230,248,266` | should_sync_lastfm, detached sync, favorite reads/toggles/sections | .8 local storage, .20 sync; .5 section reads |
| `commands/lastfm.rs:39,68,141,170` | Settings/auth/disconnect | .7 then .20 |
| `commands/lastfm.rs:224,238,281,298,310,385,411` | Now-playing/scrobble/queue helper, explicit Connection | .12 storage, .20 service, TASK-329 eligibility |
| `commands/lastfm.rs:473,494,506,527,545,563,574` | Outbox status/retry/update/delete | .12 then .20 |
| `commands/lastfm.rs:623,678,723,731,790,807,879` | Loved import/cache and local matching | .7/.8/.5 then .20 |
| `commands/lastfm.rs:917,932,938,968,975,981,1050,1054,1076,1118` | Match/stat/reset and scan match helper | .8/.5 storage, .20 rules; scanner consumes worker not SQL |
| `commands/lyrics.rs:31,62,82,95,115,134` | Lookup hit/miss/cache write/clear | .12 then .23 |
| `commands/playlists.rs:47,66,83,96,115,139,159,181,201,221` | All playlist handlers, naming and order | .9; include queue/agent consumers |
| `commands/stats.rs:174,187,200,211,229` | Overview/top artists/genres/plays/chart candidates | .11 reads, .24 composition; renderer gets explicit inputs |
| `commands/plex.rs:140,195,519,539` | Clear remote rows, sync/merge and download lookup | .10/.5 storage, .21 catalog, .22 playback |
| `plex/downloader.rs:41,55,80,94` | Source lookup, local path update, mark missing | .5/.10 storage, .19/.22 policy; transfer primitive never opens DB |
| `library/commands.rs:475`, `library/reconcile.rs:66` | Explicit reconcile Connection/backfill | .10 then .17 |
| `scanner/commands.rs:71,127,219,264,275,290,295,343,363` | Fingerprint scope, ingestion transactions, removed/dedup, loved matching and backfill | .5/.8/.10 storage then .16/.17/.20 workflows |
| `watcher.rs:143,328,363,445,562,628,652,680,714` | Enabled watches, rescans, missing/reconcile/upsert and folder timestamps | .7/.10 storage, .16/.17/.18 interpretation |
| `watcher.rs:812,825,861,893,927,951` | Watched-folder UI commands | .7 configuration then .18 scan/watch lifecycle |
| `agent/mod.rs:36,325,360,364,378` | Unique playlist name, track validation and playlist writes | .5/.9 operations then .25 tool/workflow ownership |
| `agent/tools.rs:124,208,322,406,519,718,827` | Recently played, top artists, library search, tag/similar/artist matching tools | .5/.8/.11 reads then .25 tool policy |

### Core direct callers

All paths here are relative to `crates/mt-core/src/`. Every Connection-accepting
SQL helper in a `db/` row is assigned in the domain table above; there is no
retained SQL helper exemption.

| Caller module / symbols | Consumers | Task / removal |
|-------------------------|-----------|----------------|
| `db/mod.rs`: new/init/conn/with_conn/transaction, register_custom_functions, indexed_prefix_lookup_enabled | All core/desktop DB users | TASK-354, .6, .26: delete pool/openers/UDFs after consumers |
| `db/schema.rs`, `db/models.rs` and all SQL helpers in `db/library.rs`, `db/favorites.rs`, `db/lastfm_loved.rs`, `db/playlists.rs`, `db/queue.rs`, `db/settings.rs`, `db/watched.rs`, `db/stats.rs`, `db/lyrics.rs`, `db/scrobble.rs`, `db/removed.rs`, `db/dedup.rs`, `db/revision.rs` | Storage domain consumers in preceding table | Corresponding domain transfer, final .26 audit removes every Connection signature/query |
| `library/queries.rs`: get_all/get_count/get_stats | Browse and internal query consumers | .4 |
| `library/queries.rs`: find_offset/find_track_offset/get_track/get_missing | UI navigation, agent and queue contexts | .5 |
| `library/section.rs`: get_section and all six section helpers | Section/playlist views | .5; later .8/.9 storage cannot reintroduce Rust reads |
| `library/mutations.rs`: get_reconcile_stats/reconcile_stats/delete_track/delete_tracks/delete_all/purge_missing/locate_track/check_status/mark_missing/mark_present | UI, scan and reconciliation | .10 storage, .17 workflow |
| `library/mutations.rs`: rescan_track/update_play_count | Metadata refresh and session/history | .10/.30, .11/TASK-329 respectively |
| `library/reconcile.rs`: run_backfill_and_dedup | Explicit reconcile/scan/watch | .17 |
| `plex/merge.rs`: load_local_rows/load_existing_remote_ids/insert_plex_track/link_local_track/merge_plex_library | Catalog sync | .10 storage then .21 |
| `queue/mod.rs`: get/get_playback_state/check_integrity | Queue UI and navigation | .14 |
| `queue/mutations.rs`: add_tracks/add_files/remove_track/clear/reorder/shuffle/set_current_index/set_shuffle/set_loop/add_play_next | Queue controls | .14 |
| `queue/navigation.rs`: play_next/play_previous/skip_next/skip_previous/play_context/play_context_from_query/install/navigate | Player, queue, media intents | .14; no Connection in final audio sink |
| `library/mod.rs`: Connection-related facade documentation | Core/desktop imports | .27 removes stale facade/docs after domain ports |

## Test-only direct access

These are explicit non-production callers, not hidden retention targets:

- Desktop `agent/evals.rs:39,59`; `agent/tools.rs:878,898,1318`;
  `agent/mod.rs:691,701,707,712,718`: .25 fake-provider/engine fixture replacements.
- Desktop `commands/favorites.rs:277,278`;
  `commands/lastfm.rs:1337,1339,1346`: .8/.20 engine/service tests.
- Desktop `db_fixture_gen.rs:80`: 369.12 fixes invocation/populated checks;
  .26 replaces the Rust schema generator.
- Desktop `shadow_diff_parity_test.rs:331`: .4/.5 transfer parity coverage;
  .27 deletes comparison implementation.
- Desktop `concurrency_test.rs:307,327,353`: .6/domain engine concurrency tests.
- Core standalone/inline tests: follow their enclosing domain and the explicit
  [test-module map](zig-first-ownership.md#test-modules-and-replacement-ownership).
  .26 must remove or explicitly justify any test-only SQLite dependency.

TASK-393.26's final audit includes typed aliases/imports of `Connection`,
`Database::new`, `.conn`, SQL strings and `tauri_plugin_store`, not just a grep
for `with_conn`. No application operation is “done” while a background caller
continues using its old SQL implementation.
