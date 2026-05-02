/**
 * Worker-scoped page fixture for E2E tests.
 *
 * Navigates once per worker and exposes helpers to reset Alpine store state
 * between tests via page.evaluate, avoiding a full page.goto('/') each time.
 *
 * Usage:
 *   import { expect, test } from './fixtures/worker-page.js';
 *
 *   test('my test', async ({ workerPage: page }) => { ... });
 *
 *   // Between tests: reset search state without full page reload
 *   test.beforeEach(async ({ workerPage: page }) => {
 *     await page.resetSearchState();
 *   });
 *
 *   // To use a different track set (triggers page.reload()):
 *   test.beforeAll(async ({ workerPage: page }) => {
 *     await page.setLibraryTracks(customTracks);
 *   });
 */

import { test as base } from '@playwright/test';
import { createLibraryState, setupLibraryMocks } from './mock-library.js';
import { waitForAlpine, waitForLibraryReady } from './helpers.js';

export const test = base.extend({
  workerPage: [
    async ({ browser }, use) => {
      const context = await browser.newContext({
        baseURL: process.env.PLAYWRIGHT_TEST_BASE_URL || 'http://localhost:4173',
        viewport: { width: 1624, height: 1057 },
        timezoneId: 'America/Chicago',
      });
      const page = await context.newPage();

      const defaultState = createLibraryState();
      await setupLibraryMocks(page, defaultState);
      await page.goto('/');
      await waitForAlpine(page);
      await waitForLibraryReady(page);

      // Reset library searchQuery to '' and wait for the debounced reload to
      // finish. Avoids a full page.goto('/') between tests that share the same
      // library state.
      page.resetSearchState = async () => {
        await page.evaluate(() => {
          window.Alpine?.store?.('library')?.search?.('');
        });
        await page.waitForFunction(
          () => {
            const lib = window.Alpine?.store?.('library');
            return lib && !lib.loading && lib.searchQuery === '' && lib.totalTracks > 0;
          },
          { timeout: 5000 },
        );
      };

      // Replace library route handlers with new tracks and reload once.
      // Use when a test group needs a different track set than the default 50.
      page.setLibraryTracks = async (tracks) => {
        await page.unrouteAll({ behavior: 'ignoreErrors' });
        const newState = createLibraryState({ tracks });
        await setupLibraryMocks(page, newState);
        await page.reload();
        await waitForAlpine(page);
        await waitForLibraryReady(page);
      };

      await use(page);
      await context.close();
    },
    { scope: 'worker' },
  ],
});

export { expect } from '@playwright/test';
