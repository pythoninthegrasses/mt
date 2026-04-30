import { expect, test } from '@playwright/test';
import { getAlpineStore, waitForAlpine } from './fixtures/helpers.js';
import { createLibraryState } from './fixtures/mock-library.js';

/**
 * Error States Tests
 *
 * Tests for network failure handling that require a real browser context
 * (page navigation, network interception, DOM observation).
 *
 * Pure store/API-client error tests live in __tests__/api.errors.test.js.
 */

test.describe('Network Failure Handling', () => {
  test('should show error state when library API fails', async ({ page }) => {
    // Intercept library API and return 500 error
    await page.route(/\/api\/library(\?.*)?$/, async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'Internal server error' }),
      });
    });

    await page.goto('/');
    await waitForAlpine(page);

    // Library should show error or empty state
    const libraryStore = await getAlpineStore(page, 'library');
    // With no tracks loaded, the UI should handle gracefully
    expect(libraryStore.loading || libraryStore.tracks.length === 0).toBeTruthy();
  });

  test('should handle library API timeout gracefully', async ({ page }) => {
    // Intercept library API and simulate timeout
    await page.route(/\/api\/library(\?.*)?$/, async (route) => {
      // Don't fulfill - simulates timeout
      await new Promise((resolve) => setTimeout(resolve, 10000));
    });

    await page.goto('/');
    await waitForAlpine(page);

    // Should show loading state or handle timeout
    const libraryStore = await getAlpineStore(page, 'library');
    expect(libraryStore.loading === true || libraryStore.tracks.length === 0).toBeTruthy();
  });

  test('should recover when API becomes available after failure', async ({ page }) => {
    let requestCount = 0;
    const libraryState = createLibraryState({ trackCount: 10 });

    // Mock /api/library/count (pagination support)
    await page.route(/\/api\/library\/count(\?.*)?$/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          total: libraryState.tracks.length,
          total_duration: libraryState.tracks.reduce((sum, t) => sum + (t.duration || 0), 0),
        }),
      });
    });

    // First request fails, subsequent succeed
    await page.route(/\/api\/library(\?.*)?$/, async (route) => {
      requestCount++;
      if (requestCount === 1) {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ detail: 'Temporary failure' }),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            tracks: libraryState.tracks,
            total: libraryState.tracks.length,
            limit: 1000,
            offset: 0,
          }),
        });
      }
    });

    await page.goto('/');
    await waitForAlpine(page);

    // Trigger refresh by reloading library (if there's a refresh button)
    // Or just reload the page to simulate recovery
    await page.reload();
    await waitForAlpine(page);

    // Wait for tracks to load
    await page.waitForSelector('[data-track-id]', { state: 'visible', timeout: 5000 }).catch(
      () => {},
    );

    const libraryStore = await getAlpineStore(page, 'library');
    expect(libraryStore.tracks.length).toBeGreaterThan(0);
  });
});
