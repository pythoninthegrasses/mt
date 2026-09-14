---
id: TASK-355.6
title: 'Frontend flip for the one endpoint, and the POC report'
status: To Do
assignee: []
created_date: '2026-09-11 00:39'
labels: []
dependencies:
  - TASK-355.4
  - TASK-355.5
parent_task_id: TASK-355
type: task
ordinal: 63500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
This is the final subtask of the Zig sidecar POC: prove the frontend can call the new Zig-backed endpoint directly, and write up the POC's findings and recommendation. app/frontend/js/api/shared.js already contains the client-side pieces needed (an API_BASE constant, a request() helper, an ApiError class) as a leftover from a previously removed sidecar; this task activates that path for real rather than building it from scratch. The base URL and auth token the frontend needs must come from the running app (injected by the Rust side, which reads them from the port/token file the sidecar wrote in TASK-355.3), not from a hardcoded constant. Only one domain module should be flipped for this POC -- this is deliberately not the full frontend migration described in the parent plan's Phase 6, just proof that the pattern works end to end. This task also closes out the parent POC by synthesizing all measurements gathered across the other five subtasks into one recommendation.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 app/frontend/js/api/shared.js reads its base URL and bearer token from a value injected by the Rust side at runtime, not from a hardcoded constant
- [x] #2 Exactly one frontend API domain module calls the sidecar endpoint directly with no tauriInvoke fallback
- [x] #3 No file under app/frontend/js/stores/ is modified
- [x] #4 Existing Vitest and Playwright suites both pass unmodified
- [ ] #5 A report is recorded on this task covering: cold and warm Zig build times, the CI wall-clock delta measured against the TASK-352 baseline, the Rust dependency-count delta, every unexpected obstacle encountered across all six subtasks, and an explicit go/no-go recommendation for proceeding to the larger migration (writes, queue, scanner, Last.fm, Plex, and the full frontend flip)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
AC#1-#4 only. AC#5 (the POC report and go/no-go recommendation) is deliberately not written here.

### What was built

Revives the runtime-injection mechanism this repo had for the Python PEX sidecar (`get_backend_url` in `621f681`, consumed by `initBackendUrl()` in `b3cc99c`, deleted wholesale in `9feabb0`), adapted for the two things that pattern never had to carry: a bearer token, and a `shared.js` split out of the old monolithic `api.js`.

**`crates/mt-tauri/src/sidecar.rs`** — new `sidecar_get_endpoint` Tauri command returning `Option<SidecarEndpoint> { baseUrl, token }`, camelCase-serialized to match the JS field names. It reads through the existing `SidecarState::endpoint()` (TASK-355.5's accessor for the endpoint the *startup health probe* already resolved) — there is no second parse of `sidecar.json`, so the frontend can never see an endpoint the probe never confirmed live. `None` (probe failed / sidecar never spawned) serializes to `null`, which is the frontend's cue to keep its default. `http://127.0.0.1:{port}` matches the existing convention in `probe_health` and `shadow_diff`. Registered in `lib.rs`'s `generate_handler![...]` next to `app_get_info`.

**`app/frontend/js/api/shared.js`** — `const API_BASE` becomes module-level `let apiBase` / `let apiToken` with the old hardcoded value (`http://127.0.0.1:8765/api`, no token) as the default, plus `setBackendEndpoint(baseUrl, token)`, which appends the `/api` prefix itself so callers pass an origin (same contract as the old `setApiBase(url + '/api')`, one step less error-prone). A falsy `baseUrl` is ignored rather than corrupting the default. `request()` attaches `Authorization: Bearer <token>` only when a token is set, so header-agnostic fetch mocks and the tokenless default path behave exactly as before.

**`app/frontend/main.js`** — `initBackendUrl()`, awaited at the top of `initApp()` before `settings.init()`, stores, components and `Alpine.start()`, so nothing issues an HTTP call against the pre-injection base URL. Guarded by `if (window.__TAURI__)` and try/catch like the prior art, *plus* a falsy-result check: several specs (`plex.spec.js:154`, `library-settings.spec.js:50`) stub `window.__TAURI__.core.invoke` to resolve `undefined` for commands they don't recognize, so a thrown error is not the only failure mode worth surviving — a `null`/`undefined` reply logs and keeps the default instead of propagating `undefined.baseUrl`.

**`app/frontend/js/api/library.js`** — `getTracks()` loses its `tauriInvoke('library_get_all', ...)` branch entirely and calls `request('/library?...')` directly; the query-string building is unchanged. It is the only domain module flipped, because it is the only endpoint with a Zig-side implementation (TASK-355.3/355.5). The other ten modules still `tauriInvoke` commands with no sidecar counterpart. With the branch gone the method no longer contains an `await`, so `async` was dropped — it returns the same promise `request()` returns, which is what `require-await` (enforced by `task lint` over `app/frontend/js/**/*.js`) wants.

### Verification

- **AC#1 (injection works end to end against the real sidecar).** Spawned the staged `mt-zig-core` binary against `tests/fixtures/mt_fixture.db`, read its `sidecar.json`, and drove it with exactly the URL and header shape `setBackendEndpoint` + `request()` build: `GET http://127.0.0.1:<port>/api/library?limit=2&sort_by=artist&sort_order=asc` with `Authorization: Bearer <token>` → **200, `total=301`, 2 tracks, first artist `Beginbot`**; the same URL *without* the header → **401 `{"detail":"unauthorized"}`**. That is the proof the injected port and token are the ones actually used, since the port is ephemeral (44933/51823 across two runs) and could not have come from the hardcoded default. The command's own payload was verified this way too, field for field. What is *not* covered: a real Tauri webview, i.e. the last hop from `sidecar_get_endpoint` to `initBackendUrl()` — this sandbox has no display/Tauri runtime, so `@tauri`-tagged tests stay out of scope here, same as TASK-355.5.
- **AC#2 — `api.errors.test.js` "Concurrent Request Handling" passes**, calling `api.library.getTracks()` three ways against a mocked global `fetch` with no `window.__TAURI__` present; that test exercises the flipped code path unmodified. The flip is a dead-branch removal, not a behavior change, for the existing suites: `tauriInvoke` returns `null` whenever `window.__TAURI__` is absent (all Vitest, and every Playwright spec except the seven that hand-roll their own `invoke` mock), so `request()` was already the path taken in practice.
- **AC#3 — `git status app/frontend/js/stores/` is empty.** The whole diff is `js/api/shared.js`, `js/api/library.js`, `main.js`, and the two Rust files.
- **AC#4 — Vitest: 626 passed / 17 failed (34 files), failure set byte-identical to the pre-change baseline** (captured by stash-and-compare; `comm -3` of baseline vs. after failure lists is empty). Those 17 are pre-existing and in files this diff does not touch (`context-menu-favorites`, `go-to-album`, `go-to-artist`, `library.store` FOUC #2 — `isRemote is not a function` family, already recorded on TASK-355.4/355.5).
- **AC#4 — Playwright (chromium, non-`@tauri`): 504 passed / 5 failed / 2 skipped.** All 5 — `lastfm.spec.js:201`, `library-type-to-jump.spec.js:187`, 3× `plex.spec.js` cloud badge — are in the baseline failure set, and the lastfm one was additionally re-proved individually: it fails with the same `strict mode violation: locator('text=Awaiting Authorization')…resolved to 2 elements` on the stashed clean tree as with the diff applied. The suite ran unmodified; no spec was edited, skipped, or rewritten.
  - Two environment caveats, stated rather than papered over. (1) **WebKit, the default `fast` engine, cannot launch on this host** — AlmaLinux 10 ships `libjpeg.so.62`/`libjxl.so.0.10` where Playwright's webkit build wants `libjpeg.so.8`/`libjxl.so.0.8` (same finding as TASK-355.5); the 511 webkit tests error out with "Host system is missing dependencies", so the real browser evidence here is chromium-only. (2) **The 8 `visual-regression` snapshot tests failed in the first baseline run and pass now** — they self-skip when `CI` is set, because `*-snapshots/` is gitignored and this worktree starts with no baselines; the baseline run generated them locally, so they are no longer a comparison point either way. Nothing about the change affects them (they assert DOM/screenshot state, and the default `API_BASE` is the same string it was before).
- **Rust: 892 passed / 0 failed** (`cargo test --workspace`, 2 ignored). Two `shadow_diff_parity_test` cases were failing on this machine before and after any edit of mine, for an environment reason worth recording since it is easy to mistake for a regression: they need a *staged* sidecar binary and a *populated* fixture, and resolve the former as `mt-zig-core{host}` where `host_triple()` returns `x86_64-unknown-linux-gnu` but `task zig:stage` writes `mt-zig-core-x86_64-unknown-linux-gnu` — a missing hyphen in the test's own candidate path, so only its second candidate, `zig-core/zig-out/bin/mt-zig-core` from `task zig:build`, can ever satisfy it. Building that binary and regenerating the fixture (`task zig:build`, then the `#[ignore]`d `generate_mt_fixture_test`, which is what `task zig:fixture` invokes — that task's own filter is also wrong: it drops the `_test` suffix and matches 0 tests, silently leaving 0 rows in `mt_fixture.db`) makes both pass. **Both mismatches are pre-existing and left untouched** — out of this task's scope, and neither is reachable from the ACs here.
- **Lint/format:** `task lint` clean (deno lint + clippy + zig fmt), `deno fmt --check` clean, `rustfmt --check` clean on both Rust files. `cargo clippy -p mt-tauri --all-targets` reports zero findings in `sidecar.rs`; its 7 lib warnings are the same pre-existing `plex.rs`/`removed.rs`/`lib.rs` ones recorded on TASK-355.5.
<!-- SECTION:NOTES:END -->
