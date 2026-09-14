---
id: TASK-355.5
title: Shadow-diff harness proving Rust/Zig parity
status: To Do
assignee: []
created_date: '2026-09-11 00:39'
labels: []
dependencies:
  - TASK-355.3
parent_task_id: TASK-355
type: task
ordinal: 62500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Porting roughly 7,500 lines of hand-written SQL from Rust to Zig by hand carries a real risk of silent wrong-result bugs, and there is no Zig-side test suite to serve as a ground truth. The mechanism that makes this porting defensible is a differential (shadow-mode) harness: for the ported endpoint, run both the existing Rust implementation and the new Zig implementation against the same input and compare their serialized JSON output, logging any divergence rather than trusting either implementation blindly. A hard rule for whoever does any future SQL porting under this mechanism: SQL query strings must be copied verbatim from the Rust source, never rewritten or "improved" during the port, since that reintroduces the exact risk this harness exists to catch.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A runtime flag causes the relevant Rust command to execute both the existing Rust implementation and a call to the new Zig sidecar endpoint, and compare their canonical JSON output
- [x] #2 Any divergence between the two is logged with enough detail to diagnose it
- [x] #3 The full existing Playwright suite passes with the shadow-diff flag enabled, with zero divergences logged
- [x] #4 The repo-root mt.db and mt_20260127.sql are used as realistic test fixtures
- [x] #5 A deliberately introduced divergence between the two implementations is demonstrated to be caught by the harness
- [x] #6 The shadow-diff harness is excluded from the main rust CI job's critical path (e.g. it runs in a separate, non-blocking job or is opt-in)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
### What was built

**`crates/mt-tauri/src/shadow_diff.rs`** (new) — flag, Rust-query → Zig-query-string translation, the comparison, and the divergence log.

- **Flag (AC#1): `MT_SHADOW_DIFF`** (`1`/`true`/`TRUE`/`yes`), following `MT_LOG`'s env-var precedent. Read per call rather than cached, matching `db::indexed_prefix_lookup_enabled`'s env branch — caching is what made that flag's settings-driven half go stale — and this is one cheap `env::var` per library request, not a hot loop. **With the flag off the command costs one `env::var` read and nothing else**: the query clone, the response clone and the comparison all live inside `if enabled()`, so there is no Zig round-trip and no comparison overhead.
- **Command wiring.** `library_get_all` takes `State<'_, SidecarState>` and, when enabled, spawns a detached `tauri::async_runtime::spawn` task — not `block_on`, because `library_get_all` is a *sync* command on Tauri's command thread pool and `block_on` inside a tokio worker panics. Detaching also keeps the sidecar's single-threaded accept loop off the frontend's request latency. The Rust response is returned unchanged whatever the comparison finds: a divergence is logged, never thrown.
- **`SidecarState`** gains `Arc` + `Clone` (so a command can hand the same state to a detached task without borrowing `State<'_, _>` past its own invocation), a `pub(crate) endpoint()` accessor that reuses the endpoint the startup health probe already resolved (no second parse of `sidecar.json`), and a `#[cfg(test)] for_test` constructor.
- **Comparison = byte compare of two compact JSON documents** (AC#1/#2). serde_json and `std.json.Stringify` both emit compact JSON, and `zig-core`'s `writeTrack` emits keys in `Track`'s declaration order deliberately, so byte equality is the *strictest* available check — it also catches a value written into a different key slot, which a field-wise deep compare would wave through. Confirmed empirically before writing the harness: on the 301-row fixture the two sides agree byte for byte across a 235,990-byte response (`EQUAL true`), covering `total`/`limit`/`offset` and every `Track` field including float rendering, `i64` nanosecond timestamps and NULL handling.
- **Query translation.** `zig_query_string` maps the Rust `LibraryQuery` onto the sidecar's contract with hand-rolled `application/x-www-form-urlencoded` encoding — exactly the character set `parseQuery`'s decoder has to agree about (`+`, `&`, `%`, `'`, multi-byte UTF-8). `sort_by` needs the pre-parse wire name (`LibrarySortColumn` renders as the SQL expression, and `Year` is ambiguous once parsed — `date` and `year` both collapse into it), so `sort_column_name` supplies it.

**Divergence log (AC#2)** — diagnosable rather than "mismatch": `first_diff_offset` plus ~120 chars of context from *both* sides at that offset, `rust_len`/`zig_len`, and a structural summary (`keys=[...] tracks=N`, or `unparseable: <err>`) so a shape divergence is distinguishable from a value divergence. `event = "shadow_diff divergence"` is the CI grep target. Capped at `MAX_DIVERGENCE_LOGS = 20` so one systematically broken port cannot bury the rest of the log under thousands of identical diffs.

**Zig side.** A `--sabotage` flag (`main.zig` → `server.Options.sabotage` → `library.respondWithSabotage`) forces the one field named by `library.sabotage_field` (`genre`) to a constant. `respond` still delegates with `false`, so the production endpoint path is byte-for-byte unchanged. No CI job passes the flag.

**`crates/mt-tauri/src/shadow_diff_parity_test.rs`** (new) — the fixture-driven check that drives the *real sidecar binary over a socket*, not two Rust functions in memory. A 26-case query matrix (every sort column in both orders, `ignore_words` → the `strip_sort_prefix` UDF each side registers independently, search including every special character, artist/album filters, and mid-library / past-the-end / wider-than-library / zero pagination) asserting zero divergences, plus the sabotage test asserting exactly one. The sidecar path resolves through Tauri's own `externalBin` staging convention, newest-binary-wins, with a capability probe for `--sabotage`.

### Verification

- **AC#1/#4 — `fixture_library_get_all_matches_between_rust_and_zig`: PASS.** 26 query shapes against the real fixture, >1,000 rows compared, zero divergences asserted per shape. The row count is itself asserted so the matrix cannot silently degrade into a trivial comparison.
- **AC#5 — `sabotaged_sidecar_divergence_is_caught`: PASS**, with the log captured via `--nocapture` as real evidence:

  ```text
  ERROR mt_lib::shadow_diff: shadow-diff: Rust and Zig returned different JSON
    event="shadow_diff divergence" target_impl="zig" what="response_body"
    rust_len=81872 zig_len=82572 first_diff_offset=308
    rust_context=…"date":"2025","genre":null,"duration":327.541,…
    zig_context =…"date":"2025","genre":"SABOTAGED","duration":327.541,…
    rust_structure=keys=[limit,offset,total,tracks] tracks=100
    zig_structure=keys=[limit,offset,total,tracks] tracks=100  divergence_count=1
  ```

  Field, both values and byte offset — a reviewer can localize the bug from the log alone. Verified independently of the test: the sabotaged sidecar returns `genre: "SABOTAGED"`, the clean sidecar returns `genre: null`, Rust returns `null`. Unlike "temporarily edit code, observe, revert", the sabotage is a *flag*, so this demonstration stays repeatable in CI instead of being a one-time manual act whose evidence evaporates on revert.
- **AC#3 — Playwright with `MT_SHADOW_DIFF=1`.** Non-`@tauri` suite (per AGENTS.md, `@tauri` tests need a real Tauri runtime and hardware audio and are excluded from default CI): **504 passed, 5 failed, 2 skipped** on chromium (see below for webkit). Those 5 (lastfm auth error handling, type-to-jump debounce, 3× Plex cloud badge) reproduce **identically on the clean baseline with my changes stashed** — pre-existing, and my diff touches zero frontend files (`git status app/frontend/` is empty). Two caveats originally stated: this first ran on **chromium, not webkit** (default `fast` mode is webkit-only), because AlmaLinux 10 ships `libjpeg.so.62`/`libjxl.so.0.10` where Playwright's webkit build wants `libjpeg.so.8`/`libjxl.so.0.8` — no compatible package exists in the base OS or EPEL repos (confirmed via `dnf repoquery`, both differ by ABI-generation, not just naming); the 8 `visual-regression` snapshot tests failed on the first run only because `*-snapshots/` is gitignored and no baselines existed.
  - **Reviewer follow-up (webkit re-verification, post-review).** Rather than symlinking mismatched sonames, ran the actual `webkit` project (this repo's real default engine) inside the official `mcr.microsoft.com/playwright:v1.58.0-noble` container (matches the pinned `@playwright/test` version exactly), bind-mounting this worktree so the project's own pinned Playwright/browser build ran unmodified — genuinely compatible libs via the browser vendor's own supported base image, not a manufactured fix. Result: **495 passed, 14 failed, 2 skipped**. Of the 14: the same 5 baseline failures reproduce; 8 are `visual-regression` snapshot tests with no `webkit-linux` baseline committed (same gitignored-snapshot cause, engine-specific baseline images); the 14th, `library-column-resize.spec.js:219` ("no horizontal scroll after window resize"), reproduced only under full-suite 12-worker parallel load and passed cleanly both in isolation and when the whole `library-column-resize.spec.js` file was re-run alone (22/22 passed) — parallel-load flakiness, not a regression (this diff touches zero frontend files, confirmed via `git status --short` on the exact reviewed commit). No new, diff-attributable webkit failures.
  - **Deeper finding surfaced during this follow-up, not caught in the original run: AC#3's "zero divergences logged" claim is vacuously true on both engines.** The non-`@tauri` Playwright suite runs against `npm run build && npm run preview` — a static Vite server, no Tauri runtime, no Rust process, no Zig sidecar. `app/frontend/js/stores/player.js:6-8` falls back `invoke` to a no-op stub (`Promise.resolve(console.warn('Tauri not available'))`) whenever `window.__TAURI__` is absent, which it is in every plain-browser test; the 7 spec files that do set `window.__TAURI__` (`plex`, `settings-audio`, `library-settings`, `settings`, `statistics`, `network-cache-settings`, `watched-folders`) all hand-roll their own mock `invoke`, never a real backend call. So `library_get_all` — the one command `MT_SHADOW_DIFF` gates — never executes during this suite, on any browser or engine; the env var has no effect here. AC#1/#2/#5's Rust-level parity tests (`shadow_diff_parity_test.rs`) remain the actual evidence the harness works; AC#3 as currently scoped only proves the flag doesn't break the frontend build/UI, not that the harness runs clean under real usage. Left as-is per explicit reviewer instruction (accepted, not re-scoped in this task) — flagged here for whoever picks up a follow-on task that wants AC#3 to mean what it currently implies.
- **Rust 892 passed / 0 failed**; `zig build test` 36/36; `deno fmt --check`, `deno lint`, `cargo fmt --all -- --check`, `zig fmt --check` and `actionlint` all clean. `cargo clippy -D warnings` reports 7 findings — verified by stash-and-compare to be the **identical 7 on baseline**, all in `plex.rs`/`removed.rs`/`downloader.rs`/`lib.rs:689`, none of which this task touches. My new code contributes zero clippy findings. Vitest shows 17 failures in 4 files (`isRemote is not a function`), matching the pre-existing set already recorded on TASK-355.4, with zero frontend files in my diff.
- **AC#4 — fixtures.** `mt_20260127.sql` is the authoritative fixture: `tests/fixtures/mt_fixture.db` is built from it through the real `Database::new`/migrations path (301 rows, current schema) and generated on demand by the test when absent, so the CI job needn't know about `task zig:fixture`. The repo-root `mt.db` was tried and **cannot** be an automated fixture: it is a pre-migration schema (no `disc_number`/`disc_total`/`genre`/`source`/`remote_id`, still carrying the retired `lastfm_loved`), and the sidecar fails on it with `no such column: disc_number`. That is the same reason `fixture_gen.rs` takes its schema from `Database::new` rather than from the dump — recorded as a divergence, not "fixed". `mt.db` stays `.gitignore`d and no automated job depends on it.
- **AC#6 — CI.** `taskfiles/ci.yml` gains `ci:shadow-diff` (`requires: TARGET`; stages the sidecar via `:zig:stage`, generates the fixture, runs the harness; nextest where installed, plain `cargo test` otherwise, the same fallback `task test` relies on). `test.yml` gains a `shadow-diff` job on the Linux runner with `continue-on-error: true`, deliberately absent from every other job's `needs` — mirroring how the existing `zig` job stays off the critical path, and reusing the `continue-on-error` precedent already used three times in that file. The main `rust` job is untouched: no new toolchain, no new dependency, and it still cannot fail on Zig-side work.

### Bugs found while building this

- **The `--sabotage` flag was inert.** The first implementation parsed the flag and logged about it in `main.zig` but never threaded it into `server.Options`, so `library.respond` sabotaged nothing and the AC#5 test failed with 0 divergences. Caught only because the test asserts `== 1` — a sabotage switch nobody checks is worse than none, since it invites a false "the harness works" claim.
- **Stale staged binary.** The test first resolved `crates/mt-tauri/binaries/mt-zig-core-<triple>`, built before the flag existed, which rejects `--sabotage` with `unrecognized argument`. Newest-wins plus a capability probe now reports that as *"predates the --sabotage flag; rebuild"* instead of a confusing spawn failure.
- **Fixture generation race.** Both parity tests generate `mt_fixture.db` when absent; concurrently they delete-then-insert into the same file, failing with `UNIQUE constraint failed: library.id` on a half-populated table. Masked locally by a pre-existing fixture and visible only on a clean run. Fixed with a generation lock and a double-check.

### Note for the reviewer

`lib.rs:805` (`tauri::generate_context!`) was reported during this run as an `OUT_DIR` blocker. It is not one: `crates/mt-tauri/build.rs:11` runs `tauri_build::build()`, which is what supplies `OUT_DIR`; `cargo check` and `cargo test --lib --no-run` both exit 0; and `git blame` puts that line in `af04d617` (Jan 2026), untouched here — this task's entire `lib.rs` diff is two `mod` declarations. rust-analyzer expands the macro without cargo's env. Deleting the macro or adding a stub build script to satisfy that heuristic would break the real build, so it was left alone.
<!-- SECTION:NOTES:END -->
