---
id: TASK-339
title: >-
  Fix six WebKit Playwright regressions: lazy tauriInvoke, library-ready wait,
  stale visual baselines
status: Done
assignee: []
created_date: '2026-04-29 20:59'
updated_date: '2026-04-30 19:06'
labels:
  - bug
  - tests
  - webkit
  - regression
dependencies: []
references:
  - app/frontend/js/api/shared.js
  - app/frontend/js/components/settings-view.js
  - app/frontend/tests/accessibility.spec.js
  - app/frontend/tests/settings.spec.js
  - app/frontend/tests/visual-regression.spec.js
  - app/frontend/tests/fixtures/helpers.js
  - app/frontend/views/library.html
  - app/frontend/js/mixins/context-menu-actions.js
priority: high
ordinal: 2750
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Six WebKit Playwright tests are failing. They split into three distinct root causes — fix each.

## Failure 1 — `accessibility.spec.js:48` › "previous button has accessible name"

`beforeEach` at line 28 times out on `await page.waitForSelector('[data-track-id]', { state: 'visible' })`. Playwright finds 44 elements but the first one isn't deemed visible (intermittent on WebKit only). The test itself only inspects `[data-testid="player-prev"]` — it doesn't actually need a track row laid out, only the library data to have arrived.

## Failures 2 & 3 — `settings.spec.js:718, 839` › Log Export tests

Same root cause for both: `app/frontend/js/api/shared.js:11` captures `invoke` at module-load time:
```js
export const invoke = window.__TAURI__?.core?.invoke;
```
Tests stub `window.__TAURI__` *after* `page.goto('/')`, so the cached `invoke` reference is permanently `undefined`. `tauriInvoke()` short-circuits to `null` and the test's `core.invoke` mock is never called.

Result for test 2 ("loading state"): success path runs synchronously (no 500 ms delay) — `isExportingLogs` flips false within one microtask, so `toBeDisabled()` never observes the disabled state.

Result for test 3 ("error toast"): the failure-injecting mock is dead code; `tauriInvoke` returns `null`, success toast `'Diagnostics exported successfully'` is shown instead of `'Failed to export diagnostics'`.

This regression was introduced by commit `4ba8be8` (gnhf #3 / tauriInvoke extraction). `tauriConfirm` two functions down already does the right thing (lazy lookup); `tauriInvoke` should match.

`exportLogs()` is at `app/frontend/js/components/settings-view.js:403-431` and uses `tauriInvoke('export_diagnostics', ...)`. The toast string at line 427 is exactly `'Failed to export diagnostics'` — no mismatch there.

## Failures 4, 5, 6 — `visual-regression.spec.js:59, 70, 126`

Stale local visual baselines. Snapshots at `app/frontend/tests/visual-regression.spec.js-snapshots/` are `.gitignore`d (per-developer) and the suite is `test.skip`-ped under `CI=true` (see `visual-regression.spec.js:7-8`).

- **`context-menu-track.png` (test 6):** baseline is 331 px tall, current render is 405 px. The 74 px delta = exactly two new menu items at ~37 px each. Items added by intentional commits `83e6cdc` ("Go to Artist") and `e93eaba` ("Go to Album") in `app/frontend/js/mixins/context-menu-actions.js:108-116`.
- **`library-view-list*.png` (tests 4, 5):** ~3% pixel diff (~27,700 px). The paginated-loading rewrite (`cb6876d`) and FOUC fix (`f8f2e1c`) added a `transform: translateY(...)` virtual-scroll wrapper at `app/frontend/views/library.html:207`; consistent with subpixel AA shifts on transformed text across many rows.

These are intentional UI changes, not regressions — baselines just need to be regenerated locally.

## Critical files

- `app/frontend/js/api/shared.js` — line 11 export and `tauriInvoke` body at lines 67-75
- `app/frontend/tests/fixtures/helpers.js` — append a `waitForLibraryReady` helper
- `app/frontend/tests/accessibility.spec.js` — line 2 import, line 28 wait
- `app/frontend/tests/visual-regression.spec.js-snapshots/*-webkit-darwin.png` — regenerate

## Recommended fixes

### Fix A — Make `tauriInvoke` lazy (resolves tests 2 & 3)

In `app/frontend/js/api/shared.js`:
- Drop the `export const invoke = window.__TAURI__?.core?.invoke;` line. Verified via grep that nothing imports it directly: `player.js` does its own `window.__TAURI__?.core` destructure; everything else goes through `tauriInvoke`.
- Inline the lookup inside `tauriInvoke`:
  ```js
  export async function tauriInvoke(cmd, params = {}) {
    const invoke = window.__TAURI__?.core?.invoke;
    if (!invoke) return null;
    try {
      return await invoke(cmd, params);
    } catch (error) {
      console.error(`[api.tauriInvoke] Tauri error (${cmd}):`, error);
      throw new ApiError(500, error.toString());
    }
  }
  ```

### Fix B — Wait on library-ready signal, not DOM visibility (resolves test 1)

In `app/frontend/tests/fixtures/helpers.js`, append:
```js
export async function waitForLibraryReady(page) {
  await page.waitForFunction(() => {
    const lib = window.Alpine?.store?.('library');
    return lib && lib.totalTracks > 0;
  });
  await page.waitForSelector('[data-track-id]', { state: 'attached' });
}
```

In `app/frontend/tests/accessibility.spec.js`:
- Import `waitForLibraryReady` alongside `waitForAlpine` (line 2).
- Replace line 28 `await page.waitForSelector('[data-track-id]', { state: 'visible' });` with `await waitForLibraryReady(page);`.

Leave `visual-regression.spec.js:50` alone — those tests legitimately need rows visually laid out before screenshotting.

### Fix C — Refresh local visual baselines (resolves tests 4, 5, 6)

After Fix A lands, regenerate the WebKit baselines:
```bash
cd app/frontend && npx playwright test visual-regression.spec.js --update-snapshots --project=webkit
```
Spot-check the regenerated PNGs:
- `context-menu-track-webkit-darwin.png` shows the full menu including "Go to Artist" and "Go to Album"
- `library-view-list*-webkit-darwin.png` show the current paginated-list layout
Anything else odd in the screenshots is a separate regression to investigate.

## Out of scope

- Do NOT change `player.js` Tauri destructure — it has its own no-op fallback and isn't broken by tests.
- Do NOT touch `visual-regression.spec.js:50` — only the failing assertions are downstream of that wait.
- Don't try to make the WebKit subpixel AA diff disappear by removing the virtual-scroll transform — the transform is load-bearing for performance.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `tauriInvoke` in `app/frontend/js/api/shared.js` looks up `window.__TAURI__?.core?.invoke` at call time, not at module load
- [x] #2 The unused `export const invoke = ...` declaration in `shared.js` is removed
- [x] #3 `waitForLibraryReady(page)` helper exists in `app/frontend/tests/fixtures/helpers.js` and waits on `Alpine.store('library').totalTracks > 0` then `[data-track-id]` attached
- [x] #4 `accessibility.spec.js` `beforeEach` uses `waitForLibraryReady` instead of waiting for `[data-track-id]` visibility
- [x] #5 Local WebKit visual baselines regenerated for `context-menu-track`, `library-view-list`, and `library-view-list-selected`
- [x] #6 `npx playwright test --project=webkit accessibility.spec.js settings.spec.js visual-regression.spec.js` passes for the six previously-failing tests
- [x] #7 No new test failures introduced in `settings.spec.js` or `accessibility.spec.js` (run the full files on webkit to confirm)
<!-- AC:END -->
