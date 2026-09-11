import { expect, test } from '@playwright/test';
import { waitForAlpine } from './fixtures/helpers.js';
import { createLibraryState, setupLibraryMocks } from './fixtures/mock-library.js';

/**
 * Type-to-jump blank-viewport stress test (TASK-350.1)
 *
 * Rapid type-to-jump input (j / i / n plus the End key) must never leave the
 * library viewport fully blank for more than 250ms.
 *
 * The library store is seeded into paginated mode (15 000 rows, only page 0
 * loaded) and the prefix-offset lookup is answered with a slow 400ms delay, so
 * a jump spends ~600ms in the pending state.
 *
 * Shimmer placeholders for a pending jump predate this task, so a literal
 * blank viewport (zero rendered rows, real or shimmer) does not reproduce
 * under this burst in legacy mode either — this is a regression guard for
 * that invariant across both jump_reliability_guard states, not a
 * legacy-must-fail-first test. The behavior this task actually changes —
 * retaining last-known overlapping rows instead of shimmering the whole
 * pending region — is covered separately below by directly driving the
 * component's reactive state, since reproducing a genuine partial-overlap
 * jump through realistic input timing is not deterministic.
 *
 * jump_reliability_guard is toggled through window.mtFeatureFlags (inlined via
 * addInitScript before the app bundle loads).
 */

const BLANK_LIMIT_MS = 250;
const SAMPLE_INTERVAL_MS = 50;
const SAMPLER_DURATION_MS = 5000;
const LOOKUP_DELAY_MS = 400;
const TOTAL_ROWS = 15000;

/**
 * Start the blank-viewport sampler in the page.
 *
 * The viewport counts as non-blank when at least 3 rendered rows — real track
 * rows ([data-track-id]) or shimmer placeholder rows (.animate-pulse) — are
 * visible inside the scroll container.
 */
async function startBlankViewportSampler(page) {
  await page.evaluate(
    ({ intervalMs, durationMs }) => {
      const findContainer = () => document.querySelector('[x-ref="scrollContainer"]');

      const isBlank = () => {
        const container = findContainer();
        if (!container) return false; // container gone mid-load: not a jump artifact
        const rect = container.getBoundingClientRect();
        if (rect.height === 0) return true;

        let visibleRows = 0;
        const candidates = container.querySelectorAll(
          '[data-track-id], .animate-pulse',
        );
        for (const el of candidates) {
          const r = el.getBoundingClientRect();
          if (
            r.bottom > rect.top &&
            r.top < rect.bottom &&
            r.height > 0 &&
            getComputedStyle(el).visibility !== 'hidden'
          ) {
            visibleRows++;
            if (visibleRows >= 3) return false;
          }
        }
        return true;
      };

      const state = { samples: 0, blankSamples: 0, maxRunMs: 0, done: false };
      window._mtBlankProbe = state;

      const start = performance.now();
      let lastBlankAt = null;
      setInterval(() => {
        state.samples++;
        if (isBlank()) {
          state.blankSamples++;
          if (lastBlankAt === null) {
            lastBlankAt = performance.now() - intervalMs;
          } else {
            const run = performance.now() - lastBlankAt;
            if (run > state.maxRunMs) state.maxRunMs = run;
          }
        } else {
          lastBlankAt = null;
        }
        if (performance.now() - start > durationMs) state.done = true;
      }, intervalMs);
    },
    { intervalMs: SAMPLE_INTERVAL_MS, durationMs: SAMPLER_DURATION_MS },
  );
}

/**
 * Seed the library store into paginated mode: 15 000 rows in the backend's
 * artist-sorted order, only page 0 (the first 50) loaded into the sparse page
 * map. Rows 12 000+ are real but unloaded, so a type-to-jump lookup lands on
 * an unknown region — the state where a blank flash occurs.
 */
async function seedPaginatedLibrary(page) {
  await page.evaluate(
    ({ total, pageSize }) => {
      const lib = window.Alpine.store('library');
      const base = lib.tracks.slice(0, pageSize);
      lib._sectionTracks = null;
      lib._pageSize = pageSize;
      lib._trackPages = { 0: base };
      lib._loadingPages = {};
      lib._allPagesLoaded = false;
      lib.totalTracks = total;
      lib._dataVersion++;
    },
    { total: TOTAL_ROWS, pageSize: 50 },
  );
}

/**
 * Answer the backend prefix-offset lookup after a delay with an offset that
 * lives in an unloaded page. findOffset has no HTTP fallback in browser mode,
 * so the lookup is stubbed directly on the API surface.
 */
async function stubSlowOffsetLookup(page) {
  await page.evaluate((delayMs) => {
    const lib = window.Alpine.store('library');
    lib._jumpToPrefix = () =>
      new Promise((resolve) => {
        setTimeout(() => resolve(12345), delayMs);
      });
  }, LOOKUP_DELAY_MS);
}

async function setupPage(page) {
  const libraryState = createLibraryState();
  await setupLibraryMocks(page, libraryState);
  await page.goto('/');
  await waitForAlpine(page);
  await page.waitForSelector('[data-track-id]', { state: 'visible' });
  await page.evaluate(() => {
    window.Alpine.store('ui').view = 'library';
  });
  await seedPaginatedLibrary(page);
  await stubSlowOffsetLookup(page);
}

async function measureBurst(page) {
  await startBlankViewportSampler(page);

  // Letters go through the real keydown path; End is a non-printable key
  // that must not enter the type buffer.
  const keystrokes = [
    'j',
    'i',
    'n',
    'End',
    'j',
    'i',
    'n',
    'End',
    'j',
    'i',
    'n',
  ];
  for (const key of keystrokes) {
    await page.keyboard.press(key);
    await page.waitForTimeout(60);
  }

  // The burst must actually reach the backend jump path: the generation
  // token advanced and a jump is in flight.
  await page.waitForFunction(
    () => {
      const el = document.querySelector('[x-data="libraryBrowser"]');
      if (!el) return false;
      const data = window.Alpine.$data(el);
      return data._jumpGen >= 1;
    },
    { timeout: 5000 },
  );

  // The End key must not pollute the type buffer.
  const buffer = await page.evaluate(() => {
    const el = document.querySelector('[x-data="libraryBrowser"]');
    return window.Alpine.$data(el)._typeBuffer;
  });
  expect(buffer.toLowerCase()).not.toContain('end');

  await page.waitForTimeout(SAMPLER_DURATION_MS + 500);
  return page.evaluate(() => window._mtBlankProbe);
}

test.describe('Type-to-jump blank-viewport stress (TASK-350.1)', () => {
  test('rapid j/i/n/End typing never blanks the viewport for more than 250ms', async ({ page }) => {
    await page.addInitScript(() => {
      window.mtFeatureFlags = { jump_reliability_guard: false };
    });
    await setupPage(page);
    const legacyProbe = await measureBurst(page);
    expect(legacyProbe.samples).toBeGreaterThan(10);
    expect(
      legacyProbe.maxRunMs,
      `legacy blank viewport ${legacyProbe.maxRunMs}ms`,
    ).toBeLessThan(BLANK_LIMIT_MS);

    // Guarded path: same interaction, no fully-blank viewport.
    await page.addInitScript(() => {
      window.mtFeatureFlags = { jump_reliability_guard: true };
    });
    await page.reload();
    await waitForAlpine(page);
    await page.waitForSelector('[data-track-id]', { state: 'visible' });
    await page.evaluate(() => {
      window.Alpine.store('ui').view = 'library';
    });
    await seedPaginatedLibrary(page);
    await stubSlowOffsetLookup(page);

    const probe = await measureBurst(page);
    expect(probe.samples).toBeGreaterThan(10);
    expect(probe.maxRunMs, `guarded blank viewport ${probe.maxRunMs}ms`).toBeLessThan(
      BLANK_LIMIT_MS,
    );
  });

  test('keeps overlapping stale rows visible instead of shimmering the whole pending region', async ({ page }) => {
    await page.addInitScript(() => {
      window.mtFeatureFlags = { jump_reliability_guard: true };
    });
    await setupPage(page);

    // Drive the component's reactive state directly: a jump lands on a
    // viewport that partially overlaps rows already known from a prior
    // render (_swrSnapshot), with the rest of the range still unloaded.
    const result = await page.evaluate(() => {
      const el = document.querySelector('[x-data="libraryBrowser"]');
      const comp = window.Alpine.$data(el);
      const lib = window.Alpine.store('library');

      comp._swrSnapshot = [
        { track: { id: 'real-100', title: 'Real 100' }, globalIndex: 100 },
        { track: { id: 'real-101', title: 'Real 101' }, globalIndex: 101 },
      ];
      comp._swrGeneration = lib._loadGeneration;
      comp._containerHeight = comp._containerHeight || 500;
      comp._scrollTop = 100 * comp._rowHeight;
      comp._isJumping = true;
      comp._jumpingPrefix = 'z';

      const rows = comp.visibleTracks;
      return {
        total: rows.length,
        real: rows.filter((r) => !r.track._placeholder).map((r) => r.globalIndex),
        placeholders: rows.filter((r) => r.track._placeholder).length,
      };
    });

    expect(result.real).toEqual(expect.arrayContaining([100, 101]));
    expect(result.placeholders).toBeGreaterThan(0);
  });
});
