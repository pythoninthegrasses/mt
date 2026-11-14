---
id: TASK-355.6
title: 'Frontend flip for the one endpoint, and the POC report'
status: Done
assignee: []
created_date: '2026-09-11 00:39'
updated_date: '2026-11-14T18:46:00Z'
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
Final subtask of the Zig sidecar POC: prove the frontend can call the one Zig-backed library read endpoint directly using the dormant client in app/frontend/js/api/shared.js. Runtime base URL and bearer token must come from Rust and the running sidecar, not a hardcoded endpoint. Flip only one API domain module, leave stores unchanged, and preserve existing test behavior. Close out the narrow POC with a factual synthesis of available measurements, obstacles and verification limits. Per the 2026-11-14 reconciliation, the broader migration recommendation and missing controlled build/CI/dependency comparisons belong to TASK-369.5, using this report and the TASK-353 mt-core extraction as inputs.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 app/frontend/js/api/shared.js reads its base URL and bearer token from a value injected by the Rust side at runtime, not from a hardcoded constant
- [x] #2 Exactly one frontend API domain module calls the sidecar endpoint directly with no tauriInvoke fallback
- [x] #3 No file under app/frontend/js/stores/ is modified
- [x] #4 Existing Vitest and Playwright suites both pass unmodified
- [x] #5 A factual POC report is recorded on this task covering available build/CI/dependency measurements, explicitly missing controlled deltas, obstacles across all six subtasks, verification limits, and the handoff of the broader migration go/no-go decision to TASK-369.5.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Reconcile the POC closeout with the already-recorded TASK-369.5 handoff: synthesize historical measurements and obstacles from TASK-352 and TASK-355.1 through TASK-355.6; distinguish placeholder CI timings from completed-sidecar measurements and identify missing controlled deltas; scope AC#5 to the factual POC report with the broader migration decision owned by TASK-369.5; verify cross-references and task metadata, then mark this task Done without claiming new runtime verification.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Historical implementation/review notes follow. The 2026-11-14 POC report below supersedes their statements that AC#5 remains outstanding.

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

### Human review (post-run)

Reviewed the agent's commit (`7e38f6a`) directly rather than trusting the notes above at face value:

- Independently re-ran Vitest (626 passed / 17 failed) and Playwright chromium (`E2E_MODE=full --project=chromium`: 504 passed / 5 failed / 2 skipped) — both match the reported counts and failure sets exactly. Confirmed all 5 Playwright failures reproduce identically against base `main` (`92feb45`) in a throwaway comparison worktree, independent of the agent's own stash-based claim.
- Found and reverted two out-of-scope stylistic hunks the agent's diff carried that the ACs never asked for: `main.js`'s `handleFileDrop`/`testDialog` `function` → arrow-function conversion, and a ternary condition-order flip in `library.js`'s `getSection` `page` calculation. Both were semantically identical to what they replaced; reverted in `7bb6a72` to keep the diff to what AC#1-#4 describe. (Note: `main.js` isn't in `deno.jsonc`'s lint `include` list, so neither version affected `task lint`.)
- Discarded a stray, uncommitted `deno fmt`-style reformatting (double-quotes, altered indent) found sitting dirty in the worktree ~46s after the agent's commit — pure whitespace/quote noise (confirmed via `git diff -w`), never staged or committed by the agent itself, not part of the reviewed diff.
- Status left as `In Progress`, not `Done`: AC#1-#4 are genuinely satisfied, but AC#5 (the POC report/recommendation) remains outstanding and is being done separately.

### POC report and decision handoff (2026-11-14)

This is a synthesis of recorded evidence, not a new benchmark or runtime test run. Per the user-approved reconciliation with TASK-355's existing closeout, AC#5 now covers the factual POC report; TASK-369.5 owns the broader migration decision. Missing measurements remain explicit rather than being marked measured by this closeout.

#### Outcome and verification limits

The narrow read-only POC is technically viable: the vendored SQLite binding cross-compiled for four targets (355.2), the signed/notarized macOS bundle launched and served an authenticated request on real hardware (355.4), and the Rust parity harness compared 26 query shapes against a 301-row fixture with zero divergences while detecting deliberate sabotage (355.5). The frontend flips only `library.getTracks()`, obtains the runtime endpoint through Rust, and leaves stores unchanged (355.6).

These are not proof of migration-wide equivalence. The parity evidence is fixture/query-matrix bounded, and the binding documents ASCII-only case folding versus Rust's Unicode lowercasing. Plain-browser Playwright never calls the real Rust command or sidecar: setting `MT_SHADOW_DIFF=1` there does not exercise parity. The final Tauri-webview injection-to-fetch hop was not exercised in 355.6; the signed-bundle probe in 355.4 is distinct evidence. Historical suite counts above establish no new failures relative to baseline, not universally green suites; AC#4 was accepted on that basis in the recorded human review.

#### Measurements and missing deltas

| Measurement | Recorded result | Interpretation / source |
|---|---|---|
| Zig CI job, cold / warm cache | 44s / 23s | TASK-355.1 runs 34646813761 / 34647003875, Zig 0.15.2 and the initial placeholder tree. Whole-job timings, NOT completed-sidecar build-only timings. |
| Local SQLite-bearing Zig build, cold cache | approximately 3s | TASK-355.2; approximately 2-3s per cross-compile target. No corresponding warm build-only measurement or completed-sidecar cold/warm pair is recorded in the six subtasks. |
| TASK-352 Rust build baseline, cold / main.rs edit | 95s / 3.21s | Linux x86_64 historical baseline, no warm sccache cache. Not comparable to later Mac measurements or the smaller Zig program as a language speedup. |
| TASK-352 CI baseline | 9m34s total; Linux build 8m53s | Run 34815076214 at `a9c794e`; multiple other jobs failed, Playwright skipped. This run already included Zig jobs and is NOT a pre-sidecar control. |
| CI wall-clock delta attributable to POC | Not measured | No matched before/after run isolates the endpoint flip. Parallel Zig/shadow-diff jobs add no dependency edge to the build critical path, but that is not a measured zero-second delta. |
| Rust dependency baseline | 1443 `cargo tree -e normal` lines | TASK-352 at `a9c794e`; line count includes repeated graph entries, not 1443 unique crates. |
| Rust dependency-count delta attributable to POC | Not measured | The POC retains the Rust implementation and bundled SQLite; it demonstrates no dependency removal. Do not attribute later dependency trimming to Zig. |
| Later dev-loop / disk baseline | 2.2s warm build, 1.0s warm check, 35.2s cold; target/ 12.3 GiB | TASK-369.1, `benchmarks/edit-to-run/results-2026-11-13/`, as recorded in 369.5. 1270 normal-dependency tree lines / 421 unique crates. Different revision/environment from TASK-352, not a controlled POC delta. |

The toolchain changed to Zig 0.16.0 during 355.4 because 0.15.2 was incompatible with the macOS 26.5 SDK. A fresh comparison must pin revision, host, toolchains, cache state, profile, and feature set. TASK-369.5 must supply the missing completed-sidecar cold/warm measurements and controlled CI/dependency deltas, as well as quantify the current double-SQLite cost and the savings after deleting the Rust counterpart.

#### Obstacles recorded across the six subtasks

- **355.1 — tool resolution:** local Zig initially came from a VS Code extension path excluded by Taskfile. CI installed Zig on PATH without mise, breaking mise-only resolution; added the PATH fallback after the first failed CI run.
- **355.2 — SQL semantics and vendoring:** the Rust SQL UDF and test helper disagreed on whitespace handling; reconciled them and backfilled sort keys. Vendored SQLite required ignore-file anchoring, large-file/format/text-processing exclusions, package-path and cache-key changes. Disabled Darwin locking-style code to avoid CoreFoundation linkage during cross-compilation. ASCII/Unicode case-folding divergence remains bounded/documented rather than universally equivalent.
- **355.3 — fidelity and fixtures:** copied query ordering, row-dropping and JSON field ordering rather than improving them; inherited missing ORDER BY tiebreakers remain. The dump needed migration through the real schema and removal of a retired column. Apparent nanosecond timestamp mismatches came from the MCP bridge coercing i64 values through JavaScript Number, not from Rust/Zig JSON serialization.
- **355.4 — packaging and lifecycle:** Zig target names do not match Tauri's Rust-triple suffixes; explicit mappings are required. Tauri checks sidecar paths even during cargo check, so staging was needed in dev, CI and both Docker branches. Stale runtime files required cleanup; OS SIGTERM bypasses RunEvent::Exit and can orphan the child. A nightly incremental-cache ICE interrupted verification. Zig 0.15.2 failed against the macOS SDK, requiring 0.16.0. One signing check failed despite a valid downloaded artifact; diagnostics and a fresh run passed, without an established root cause. A real fresh-install race spawned the sidecar before Rust created the DB; moving spawn after DB initialization fixed it and was reverified on macOS.
- **355.5 — trustworthy parity evidence:** the initial sabotage flag was parsed but not wired; an exact divergence-count assertion caught it. Stale staged binaries lacked sabotage support. Concurrent fixture generation raced and hit duplicate IDs; generation locking fixed it. Repo-root mt.db had an obsolete schema and could not be used as the automated fixture. WebKit ABI dependencies were unavailable on AlmaLinux; a matching official Playwright container enabled re-verification. Missing engine-specific screenshot baselines and a parallel-load resize flake complicated results. Critically, mocked browser suites cannot prove live parity; the real socket-driven Rust tests do. A rust-analyzer OUT_DIR warning was not a cargo build blocker and did not justify changing generate_context!.
- **355.6 — injection, baseline failures and tooling defects:** invoke mocks can resolve undefined rather than throw, requiring a falsy-result guard. Pre-existing 17 Vitest failures and five Chromium failures required baseline comparison, not test edits. WebKit launch dependencies and gitignored screenshots constrained comparisons. Parity tests had a missing hyphen in the staged filename (tracked separately by TASK-366); zig:fixture's exact test filter omitted `_test`, silently matching zero tests. These findings were left out of the frontend implementation. Human review removed unrelated style changes and uncommitted formatting noise.

#### Recommendation and remaining owner

**Go for the narrow POC's technical feasibility; no-go for launching the full migration on this evidence alone.** TASK-352's no-go on CI-wall-clock justification still applies to an additive endpoint/shadow-diff approach that retains the Rust graph. This is not a rejection of Zig for developer-loop, disk-footprint or code-ownership reasons.

The broader go/no-go for writes, queue, scanner, Last.fm, Plex and the full frontend flip belongs exclusively to **TASK-369.5**. Next: complete the Tauri-free mt-core extraction in **TASK-353**, then compare lean split Rust against a Zig-owned complete subsystem on equal functionality/safety. Measure engine and shell edit-to-run, engine-test turnaround, cold/warm builds, CI and disk across worktrees. Count a Zig footprint win only after removing the corresponding Rust code/dependencies; do not extrapolate it from the duplicate read-only endpoint.

TASK-369.5 must cite this report and TASK-353's results, explain divergent measurements, record the ADR, and create concrete implementation follow-ups. This cleanup does not approve any larger port or claim those measurements have been performed.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Closed the narrow read-only POC with a sourced six-subtask report covering available measurements, obstacles, baseline failures and verification limits. Reconciled AC#5 with TASK-355's prior handoff: the broader migration ADR and missing controlled measurements remain in TASK-369.5, now explicitly dependent on this report. TASK-353 is unblocked and recorded as the next implementation priority. Verified task links and report against historical task records; git diff --check passed. No application code changed and no runtime suites or new benchmarks were run; existing AC#1-#4 review evidence is preserved.

Closeout checks: task lint and task format both passed; no new runtime-test or benchmark results are claimed.
<!-- SECTION:FINAL_SUMMARY:END -->
