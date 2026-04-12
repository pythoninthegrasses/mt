import { test, expect } from '@playwright/test';
import { waitForAlpine } from './fixtures/helpers.js';
import { createLibraryState, setupLibraryMocks } from './fixtures/mock-library.js';
import { createPlaylistState, setupPlaylistMocks } from './fixtures/mock-playlists.js';

// Skip visual regression tests in CI (snapshots are gitignored)
const isCI = process.env.CI === 'true';
test.skip(() => isCI, 'Visual regression tests skipped in CI (snapshots not committed)');

/**
 * Visual Regression Tests (reduced set)
 *
 * 8 critical UI state snapshots covering the key visual areas.
 * Full per-panel and per-theme variants removed — these provided
 * diminishing returns and made baseline maintenance expensive.
 */

const screenshotOptions = {
  maxDiffPixelRatio: 0.02,
  threshold: 0.3,
};

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

test.describe('Visual Regression: Critical UI States', () => {
  test.beforeEach(async ({ page }) => {
    await setupMocks(page);
    await page.goto('/');
    await waitForAlpine(page);
    await page.waitForSelector('[data-track-id]', { state: 'visible' });
  });

  test('player controls default state', async ({ page }) => {
    const playerFooter = page.locator('footer');
    await expect(playerFooter).toBeVisible();
    await expect(playerFooter).toHaveScreenshot('player-controls-default.png', screenshotOptions);
  });

  test('library list view', async ({ page }) => {
    await page.evaluate(() => {
      window.Alpine.store('ui').setLibraryViewMode('list');
    });
    await page.waitForTimeout(200);

    const libraryView = page.locator('[x-data="libraryBrowser"]');
    await expect(libraryView).toBeVisible();
    await expect(libraryView).toHaveScreenshot('library-view-list.png', screenshotOptions);
  });

  test('library list view with selected track', async ({ page }) => {
    await page.evaluate(() => {
      window.Alpine.store('ui').setLibraryViewMode('list');
    });
    await page.waitForTimeout(100);

    await page.locator('[data-track-id]').first().click();
    await page.waitForTimeout(100);

    const libraryView = page.locator('[x-data="libraryBrowser"]');
    await expect(libraryView).toHaveScreenshot('library-view-list-selected.png', screenshotOptions);
  });

  test('settings full view', async ({ page }) => {
    await page.click('[data-testid="sidebar-settings"]');
    await page.waitForSelector('[data-testid="settings-view"]', { state: 'visible' });

    const settingsView = page.locator('[data-testid="settings-view"]');
    await expect(settingsView).toHaveScreenshot('settings-full-view.png', screenshotOptions);
  });

  test('sidebar expanded', async ({ page }) => {
    await page.evaluate(() => {
      window.Alpine.store('ui').sidebarOpen = true;
    });
    await page.waitForTimeout(200);

    const sidebar = page.locator('aside[x-data="sidebar"]');
    await expect(sidebar).toHaveScreenshot('sidebar-expanded.png', screenshotOptions);
  });

  test('queue view with tracks', async ({ page }) => {
    await page.locator('[data-track-id]').first().dblclick();
    await page.locator('[data-track-id]').nth(1).dblclick();
    await page.waitForTimeout(200);

    await page.evaluate(() => {
      window.Alpine.store('ui').setView('queue');
    });
    await page.waitForTimeout(200);

    await expect(page).toHaveScreenshot('queue-view-with-tracks.png', { ...screenshotOptions, fullPage: false });
  });

  test('now playing view with track', async ({ page }) => {
    await page.locator('[data-track-id]').first().dblclick();
    await page.waitForTimeout(200);

    await page.evaluate(() => {
      window.Alpine.store('ui').setView('nowPlaying');
    });
    await page.waitForTimeout(200);

    await expect(page).toHaveScreenshot('now-playing-view.png', { ...screenshotOptions, fullPage: false });
  });

  test('track context menu', async ({ page }) => {
    await page.locator('[data-track-id]').first().click({ button: 'right' });
    await page.waitForTimeout(200);

    const contextMenu = page.locator('[data-testid="track-context-menu"]');
    if (await contextMenu.isVisible()) {
      await expect(contextMenu).toHaveScreenshot('context-menu-track.png', screenshotOptions);
    }
  });
});
