import { test, expect } from '@playwright/test';
import { waitForAlpine } from './fixtures/helpers.js';
import { createLibraryState, setupLibraryMocks } from './fixtures/mock-library.js';
import { createPlaylistState, setupPlaylistMocks } from './fixtures/mock-playlists.js';

/**
 * Text Selection Tests
 *
 * Verifies that UI chrome (sidebar, footer, albums, artists, settings, etc.)
 * prevents text selection, while content areas like lyrics remain selectable.
 */

async function setupMocks(page) {
  const libraryState = createLibraryState();
  await setupLibraryMocks(page, libraryState);

  const playlistState = createPlaylistState();
  await setupPlaylistMocks(page, playlistState);

  await page.route(/\/api\/lastfm\/settings/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        enabled: false,
        username: null,
        authenticated: false,
        configured: false,
        scrobble_threshold: 50,
      }),
    });
  });
}

/**
 * Assert that an element has user-select: none computed style
 */
async function getUserSelect(locator) {
  return await locator.evaluate((el) => {
    const style = window.getComputedStyle(el);
    return style.userSelect || style.webkitUserSelect;
  });
}

async function expectNoTextSelection(page, selector, description) {
  const userSelect = await getUserSelect(page.locator(selector).first());
  expect(userSelect, `${description} should have user-select: none`).toBe(
    'none',
  );
}

test.describe('Text Selection Prevention', () => {
  test.beforeEach(async ({ page }) => {
    await setupMocks(page);
    await page.goto('/');
    await waitForAlpine(page);
    await page.waitForSelector('[data-track-id]', { state: 'visible' });
  });

  test('sidebar prevents text selection', async ({ page }) => {
    await expectNoTextSelection(
      page,
      'aside[x-data="sidebar"]',
      'Sidebar',
    );
  });

  test('footer prevents text selection', async ({ page }) => {
    await expectNoTextSelection(page, 'footer', 'Footer');
  });

  test('library view prevents text selection', async ({ page }) => {
    await expectNoTextSelection(
      page,
      '[x-data="libraryBrowser"]',
      'Library view',
    );
  });

  test('albums view prevents text selection', async ({ page }) => {
    await page.evaluate(() =>
      window.Alpine.store('ui').setView('albums')
    );
    await page.waitForSelector('[data-testid="albums-view"]', {
      state: 'visible',
    });
    await expectNoTextSelection(
      page,
      '[data-testid="albums-view"]',
      'Albums view',
    );
  });

  test('artists view prevents text selection', async ({ page }) => {
    await page.evaluate(() =>
      window.Alpine.store('ui').setView('artists')
    );
    await page.waitForSelector('[data-testid="artists-view"]', {
      state: 'visible',
    });
    await expectNoTextSelection(
      page,
      '[data-testid="artists-view"]',
      'Artists view',
    );
  });

  test('settings view prevents text selection', async ({ page }) => {
    await page.click('[data-testid="sidebar-settings"]');
    await page.waitForSelector('[data-testid="settings-view"]', {
      state: 'visible',
    });
    await expectNoTextSelection(
      page,
      '[data-testid="settings-view"]',
      'Settings view',
    );
  });

  test('queue view prevents text selection', async ({ page }) => {
    await page.evaluate(() =>
      window.Alpine.store('ui').setView('queue')
    );
    await page.waitForTimeout(200);
    await expectNoTextSelection(
      page,
      '[data-testid="queue-view"]',
      'Queue view',
    );
  });

  test('search input prevents selection when empty', async ({ page }) => {
    const searchInput = page.locator('[data-testid="sidebar-search"]');
    if (await searchInput.isVisible()) {
      const userSelect = await getUserSelect(searchInput);
      expect(
        userSelect,
        'Empty search input should have user-select: none',
      ).toBe('none');
    }
  });

  test('search input allows selection when has text', async ({ page }) => {
    const searchInput = page.locator('[data-testid="sidebar-search"]');
    if (await searchInput.isVisible()) {
      await searchInput.fill('test');
      await page.waitForTimeout(100);
      const userSelect = await getUserSelect(searchInput);
      expect(
        userSelect,
        'Search input with text should have user-select: text',
      ).toBe('text');
    }
  });
});
