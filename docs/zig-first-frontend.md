# Zig-first ownership inventory: frontend

Baseline `205a968`, 2026-11-15. Paths in the table are relative to
`app/frontend/js/`; `../main.js` is the application bootstrap.
See [ADR](adr/0001-zig-first-engine.md) and [migration sequence](zig-first-migration.md).
Task numbers abbreviate TASK-393 unless written otherwise.

“Retain UI” means render state, selection, scrolling, drag previews, formatting
and optimistic pending indicators—not a second authoritative domain algorithm.
Mutation success and authoritative order/counts come from Zig snapshots/events.
All API clients move together with their operation; no permanent HTTP/Tauri
fallback switch.

| File | Final owner / consumers | Task | Delete/transfer business logic; justified UI retention |
|------|-------------------------|------|-------------------------------------------------------|
| `../main.js` | Frontend bootstrap + Rust shell / all stores | .2, .3, .7 | Remove default-port success path; wait for engine readiness, hydrate settings; keep Alpine registration, native titlebar/theme reveal and drag plumbing |
| `api.js` | Frontend facade / existing imports | .27 | Keep import facade only if used; remove obsolete exports |
| `api/index.js` | Frontend transport / aggregate API callers | .1–.25, .27 | Replace legacy state/updatePosition/health and watched-folder routes with actual transferred contracts; no simulated engine state |
| `api/shared.js` | Frontend HTTP/error/bootstrap codec / all domains | .1, .2, .3 | Remove hardcoded endpoint and silent null success; validate structured errors/generation; retain native shell invoke/confirm helpers |
| `api/library.js` | Frontend requests → Zig / browsers and queue contexts | .4, .5, .10, .11, .16, .17, .29 | Delete domain Tauri calls after transfer |
| `api/queue.js` | Frontend requests → Zig / player/queue | .14 | Remove legacy save/ordering policy and duplicate persistence; use snapshots |
| `api/playlists.js` | Frontend requests → Zig / sidebar/context menus | .9 | Transfer naming, CRUD and ordering; retain request encoding |
| `api/favorites.js` | Frontend requests → Zig / player and menus | .8 | Transfer favorites operations |
| `api/settings.js` | Frontend requests → Zig / settings service | .7 | No parallel Rust defaults/store |
| `api/stats.js` | Frontend requests → Zig / dashboard | .11, .24 | Transfer queries and chart composition, not rendering UI |
| `api/lastfm.js` | Frontend requests → Zig / settings/player | .20, TASK-329 | Remove browser-driven now-playing/scrobble authority |
| `api/lyrics.js` | Frontend requests → Zig / Now Playing | .23 | No frontend lookup/cache policy |
| `api/plex.js` | Frontend requests → Zig / settings/queue | .21, .22 | No browser download/prefetch orchestration |
| `api/audio.js` | Frontend domain intent → Zig / settings/player | .13, .14, TASK-329 | Device selection reaches private audio capability via Zig; no browser-owned playback lifecycle |
| `api/agent.js` | Frontend requests → Zig / Genius | .25 | Preserve optional-feature unavailable response; no tool policy |
| `events.js` | Frontend snapshot application / stores | .3, per-domain task | Remove domain cleanup decisions such as queue mutation on library removal; consume one generation/revision stream |
| `feature-flags.js` | Frontend presentation availability / UI | .25, .27 | Keep build/capability visibility, never legacy engine fallback |
| `constants.js` | UI constants + Zig domain defaults / all UI | .4, .5, .7, .14 | Move ignore-word/sort/domain defaults to engine; retain labels, sizes and column presentation |
| `shortcuts.js` | Frontend interaction / user keyboard | .14, TASK-329 | Send intents, do not navigate/shuffle locally |
| `services/settings.js` | UI cache of Zig settings / all stores | .7 | Keep reactive subscriptions/pending rollback, remove competing defaults/persistence authority |
| `stores/index.js` | Frontend registration / bootstrap | .2, .3 | Keep dependency-ordered UI initialization after readiness |
| `stores/library.js` | Zig library facts + UI cache / browsers | .4, .5, .10, .16, .21, .22 | Move artists/albums grouping, source visibility rules, totals and scan/Plex orchestration; retain page cache/render ranges and current selection |
| `stores/queue.js` | Zig queue truth + UI snapshot / queue/player | .14, .22, TASK-329 | Move startup clear/default restoration, navigation/context, integrity and Plex prefetch; retain ordered snapshot rendering/drag pending state |
| `stores/player.js` | Zig session + UI seek/volume drag / controls | .13, .14, .20, .29, TASK-329 | Move track-end advance, session assembly, now-playing/scrobble and metadata publication; retain interpolation/gesture state |
| `stores/settings.js` | Frontend settings snapshot / settings view | .7, .21 | Engine determines Plex configuration/availability; retain reactive display |
| `stores/ui.js` | Frontend interaction + Zig preferences / all views | .7, .10, TASK-329 | Retain modals/theme/layout/toasts; engine owns locate/missing actions and persisted app preference validation |
| `components/index.js` | Frontend component registration / bootstrap | .27 | Retain registration only |
| `components/library-browser.js` | UI selection/columns + Zig queries / library view | .4, .5, .9, .14 | Retain gestures/virtual viewport, send sort/filter/context intents; no local query/queue authority |
| `components/artists-browser.js` | Zig artist/album read models + UI / artist browser | .5, .29 | Transfer canonicalization/grouping, ignored-prefix and album track order; retain selection/lazy image display |
| `components/albums-browser.js` | Zig album read models + UI / album browser | .5, .14, .29 | Transfer album grouping/track selection/play-context and artwork fallback; retain card/detail navigation |
| `components/now-playing-view.js` | UI session/lyrics projection / Now Playing | .14, .23, TASK-329 | Keep scrolling/highlighting; engine chooses session, queue and lyrics identity |
| `components/queue-view.js` | UI queue snapshot / queue panel | .14 | Retain view scrolling/selection, no order/navigation policy |
| `components/player-controls.js` | UI gestures → Zig intent / player | .14, TASK-329 | No local loop-cycle/navigation authority; retain drag preview/tooltips |
| `components/settings-view.js` | UI preferences/service status / settings | .7, .17, .19, .20, .21, .25 | Remove dedup/cache/service policy and request orchestration beyond user actions; retain native export/dialogs |
| `components/metadata-modal.js` | UI edit draft + Zig edit workflow / metadata editor | .15, .30 | Retain mixed-field display/navigation; engine validates fields, writes/reconciles successful results |
| `components/genius-browser.js` | UI prompts/progress → Zig agent / Genius | .25 | Engine owns model/onboarding/pull/generation state; retain display and user input |
| `components/stats-view.js` | UI rendering + Zig queries / dashboard | .11, .24, .29 | Keep chart display/export picker; no candidate/artwork selection fallback |
| `components/sidebar.js` | UI navigation + Zig playlist/preferences / sidebar | .7, .9 | Move persisted defaults/migration to engine settings; retain selected view/drag presentation |
| `components/main-content.js` | UI drop targets / main view | .9, .14, .16 | Translate drops into domain requests, no independent scan/playlist pipeline |
| `mixins/context-menu-actions.js` | UI intents / track menus | .8, .9, .10, .14, .22, .30 | Keep menu/selection/reveal, transfer mutation/source/queue rules |
| `mixins/single-track-context-menu.js` | UI intents / single track menus | .8, .9, .14 | Same boundary, no private local playlist/queue fallback |
| `mixins/playlist-crud.js` | UI dialogs → Zig playlists / sidebar | .9 | Engine naming/validation/deletion; keep rename draft and confirmation |
| `mixins/playlist-drag.js` | UI drag preview → Zig membership/order / playlist view | .9 | Engine commits reorder; retain hit testing/animation |
| `mixins/playlist-reorder.js` | UI drag preview → Zig playlist order / sidebar | .9 | Remove authoritative local reorder persistence |
| `mixins/queue-drag-reorder.js` | UI drag preview → Zig queue / queue views | .14 | Engine commits queue order, retain autoscroll/drop targeting |
| `mixins/type-to-jump.js` | UI type buffer + Zig prefix lookup / library browser | .5 | Transfer Unicode prefix semantics/local fallback; retain debounce, timeout and scroll identity guards; no new keyset API |
| `mixins/virtual-scroll.js` | Frontend / large library viewport | .5, .27 | Retain geometry/render paging, not library filtering/domain counts |
| `mixins/column-geometry.js` | Frontend / table layout | .7, .27 | Retain measurement/resize; persist preferences through engine |
| `mixins/column-reorder.js` | Frontend / table headers | .7, .27 | Retain column drag presentation, not track order |
| `mixins/column-settings.js` | Frontend layout + Zig preference validation / table | .7 | Keep column display settings, engine owns durable migration/validation |
| `utils/artist-utils.js` | Zig / artist and album read models | .5 | Transfer canonical artist vote/casing, compilation rule, dominant disc and track/year order; remove frontend duplicate functions |
| `utils/library-stats.js` | Zig / library totals | .4, .11 | Delete frontend authoritative total/duration computation |
| `utils/queue-builder.js` | Zig context construction + UI intent / double-click play | .14 | Remove local context construction; send section/query/selection identity |
| `utils/library-operations.js` | UI snapshot helpers + Zig mutations / stores/events | .4, .5, .10, .14, .16 | Remove queue cleanup/domain reconciliation and scan orchestration; retain applying fetched view state |
| `utils/watched-folders.js` | Zig folder rules + UI prompt / add/drop flows | .7, .16 | Move parent-path candidate/dedup eligibility; retain user confirmation |
| `utils/library-cache.js` | UI bounded read cache / library store | .4, .5, .7 | Keep revision/generation-scoped display cache; not source of library truth or independent settings |
| `utils/library-page-cache.js` | Frontend / viewport | .4, .5 | Retain memory budget/page cache; invalidate on engine revision, no domain query fallback |
| `utils/library-visible-rows.js` | UI row-index projection + Zig visibility rules / viewport | .5, .21 | Keep raw/visible index mapping only; engine owns source/filter eligibility |
| `utils/tauri-drag-drop.js` | UI/native drop translation / bootstrap | .9, .14, .16 | Retain pixel/target mapping, delegate file/track interpretation |
| `utils/formatting.js` | Frontend / labels | .27 | Retain display-only time/bytes/date formatting |
| `utils/dom.js` | Frontend / typing and measurement | .27 | Retain DOM helpers |
| `utils/error-reporter.js` | Frontend + Rust diagnostics / all UI | .27 | Retain reporting with redaction, not success fallback |
| `utils/web-vitals.js` | Frontend + Rust diagnostics / bootstrap | .27 | Retain diagnostic measurements, no new benchmark gate |

## Outside the module directory

The HTML audit found no independent scripts, HTTP calls, invoke calls or inline
sort/filter/reduce implementations in `app/frontend/views/`. Paths below are
relative to `app/frontend/`; final owner is UI presentation, consuming the
corresponding stores. Do not move domain logic into markup during a port.

| Markup | Consumers / task | Retention/deletion boundary |
|--------|------------------|----------------------------|
| `index.html` | Bootstrap / .2, .3, .27 | Retain shell markup and main.js/vendor script loading |
| `views/library.html`, `views/artists.html`, `views/albums.html` | Library browsers / .4, .5, .29 | Retain layout/interaction expressions; engine supplies query/grouping/artwork truth |
| `views/queue.html`, `views/now-playing.html`, `views/footer.html` | Queue/player / .14, .23, TASK-329 | Retain rendered snapshots/gestures, no navigation/session authority |
| `views/sidebar.html` | Navigation/playlists / .7, .9 | Retain view selection/menus, not naming or persistence policy |
| `views/genius.html` | Agent UI / .25 | Retain prompts/progress display, not tool/onboarding authority |
| `views/modals.html`, `views/drop-overlay.html` | Dialogs/drop UI / .10, .14, .16, .30 | Retain drafts/confirmation, delegate mutations to engine |
| `views/settings.html`, `views/settings-columns.html` | Preferences/layout / .7 | Retain UI; engine owns durable app settings |
| `views/settings-audio.html` | Audio settings / .13, .19 | Retain device/cache controls, not policy |
| `views/settings-library.html` | Library settings / .7, .16, .17, .18 | Retain scan/watch/reconcile controls, not orchestration |
| `views/settings-plex.html`, `views/settings-lastfm.html` | Services / .20, .21, .22 | Retain credentials entry/status UI without exposing saved secrets |
| `views/settings-stats.html` | Statistics/charts / .11, .24 | Retain display/export gestures, not selection rules |

`main.js` and HTML listeners are part of TASK-393.27's final caller audit.
Vite/Vitest/Playwright configuration, styles and vendored UI assets are tooling/
presentation, not another engine implementation.

Frontend tests remain Vitest for snapshot application, errors and UI state;
domain assertions move to Zig with the owning capability. Playwright drives real
gestures for wiring, not store-only logic. Mocked Tauri success is not evidence
that a live sidecar, native audio or upgrade works.
