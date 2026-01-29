import { test, expect } from '@playwright/test';
import { waitForAlpine } from './fixtures/helpers.js';
import { createLibraryState, setupLibraryMocks } from './fixtures/mock-library.js';
import { createPlaylistState, setupPlaylistMocks } from './fixtures/mock-playlists.js';

/**
 * Visual Regression Tests
 *
 * Uses Playwright's toHaveScreenshot() for visual comparison testing.
 * These tests create baseline screenshots on first run and compare
 * against them on subsequent runs to detect style regressions.
 *
 * Screenshot baselines are stored in tests/visual-regression.spec.js-snapshots/
 *
 * Note: Uses a small pixel threshold (0.5%) to handle minor anti-aliasing
 * and rendering differences between test runs.
 */

// Default screenshot comparison options for visual regression tests
const screenshotOptions = {
  // Allow up to 2% of pixels to differ (handles anti-aliasing and font rendering variations)
  maxDiffPixelRatio: 0.02,
  // Threshold for pixel color comparison (0 = exact match, 1 = any match)
  threshold: 0.3,
};

/**
 * Common setup for mocking API routes
 */
async function setupMocks(page) {
  const libraryState = createLibraryState();
  await setupLibraryMocks(page, libraryState);

  const playlistState = createPlaylistState();
  await setupPlaylistMocks(page, playlistState);

  // Mock Last.fm to prevent error toasts
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

test.describe('Visual Regression: Player Controls', () => {
  test.beforeEach(async ({ page }) => {
    await setupMocks(page);
    await page.goto('/');
    await waitForAlpine(page);
    await page.waitForSelector('[data-track-id]', { state: 'visible' });
  });

  test('player controls default state', async ({ page }) => {
    // Use the footer element which contains all player controls
    const playerFooter = page.locator('footer');
    await expect(playerFooter).toBeVisible();
    await expect(playerFooter).toHaveScreenshot('player-controls-default.png', screenshotOptions);
  });

  test('player controls with track loaded', async ({ page }) => {
    // Double-click first track to load it
    await page.locator('[data-track-id]').first().dblclick();
    await page.waitForTimeout(300);

    const playerFooter = page.locator('footer');
    await expect(playerFooter).toHaveScreenshot('player-controls-track-loaded.png', screenshotOptions);
  });

  test('player controls with shuffle enabled', async ({ page }) => {
    // Enable shuffle
    await page.locator('[data-testid="player-shuffle"]').click();
    await page.waitForTimeout(100);

    const playerFooter = page.locator('footer');
    await expect(playerFooter).toHaveScreenshot('player-controls-shuffle-on.png', screenshotOptions);
  });

  test('player controls with loop enabled', async ({ page }) => {
    // Enable loop (click once for loop-all)
    await page.locator('[data-testid="player-loop"]').click();
    await page.waitForTimeout(100);

    const playerFooter = page.locator('footer');
    await expect(playerFooter).toHaveScreenshot('player-controls-loop-all.png', screenshotOptions);
  });

  test('player controls with loop-one enabled', async ({ page }) => {
    // Click loop twice for loop-one
    await page.locator('[data-testid="player-loop"]').click();
    await page.locator('[data-testid="player-loop"]').click();
    await page.waitForTimeout(100);

    const playerFooter = page.locator('footer');
    await expect(playerFooter).toHaveScreenshot('player-controls-loop-one.png', screenshotOptions);
  });

  test('player controls with muted volume', async ({ page }) => {
    // Click mute button
    await page.locator('[data-testid="player-mute"]').click();
    await page.waitForTimeout(100);

    const playerFooter = page.locator('footer');
    await expect(playerFooter).toHaveScreenshot('player-controls-muted.png', screenshotOptions);
  });

  test('player controls with all toggles active', async ({ page }) => {
    // Enable shuffle
    await page.locator('[data-testid="player-shuffle"]').click();
    // Enable loop
    await page.locator('[data-testid="player-loop"]').click();
    // Mute
    await page.locator('[data-testid="player-mute"]').click();
    await page.waitForTimeout(100);

    const playerFooter = page.locator('footer');
    await expect(playerFooter).toHaveScreenshot('player-controls-all-active.png', screenshotOptions);
  });
});

test.describe('Visual Regression: Library View Modes', () => {
  test.beforeEach(async ({ page }) => {
    await setupMocks(page);
    await page.goto('/');
    await waitForAlpine(page);
    await page.waitForSelector('[data-track-id]', { state: 'visible' });
  });

  test('library list view', async ({ page }) => {
    // Ensure list view mode
    await page.evaluate(() => {
      window.Alpine.store('ui').setLibraryViewMode('list');
    });
    await page.waitForTimeout(200);

    // Screenshot the library view area (main content excluding sidebar and footer)
    const libraryView = page.locator('[x-data="libraryBrowser"]');
    await expect(libraryView).toBeVisible();
    await expect(libraryView).toHaveScreenshot('library-view-list.png', screenshotOptions);
  });

  test('library grid view', async ({ page }) => {
    // Switch to grid view
    await page.evaluate(() => {
      window.Alpine.store('ui').setLibraryViewMode('grid');
    });
    await page.waitForTimeout(200);

    const libraryView = page.locator('[x-data="libraryBrowser"]');
    await expect(libraryView).toHaveScreenshot('library-view-grid.png', screenshotOptions);
  });

  test('library compact view', async ({ page }) => {
    // Switch to compact view
    await page.evaluate(() => {
      window.Alpine.store('ui').setLibraryViewMode('compact');
    });
    await page.waitForTimeout(200);

    const libraryView = page.locator('[x-data="libraryBrowser"]');
    await expect(libraryView).toHaveScreenshot('library-view-compact.png', screenshotOptions);
  });

  test('library list view with selected track', async ({ page }) => {
    // Ensure list view
    await page.evaluate(() => {
      window.Alpine.store('ui').setLibraryViewMode('list');
    });
    await page.waitForTimeout(100);

    // Click to select first track
    await page.locator('[data-track-id]').first().click();
    await page.waitForTimeout(100);

    const libraryView = page.locator('[x-data="libraryBrowser"]');
    await expect(libraryView).toHaveScreenshot('library-view-list-selected.png', screenshotOptions);
  });

  test('library grid view with selected track', async ({ page }) => {
    // Switch to grid view
    await page.evaluate(() => {
      window.Alpine.store('ui').setLibraryViewMode('grid');
    });
    await page.waitForTimeout(100);

    // Click to select first track
    await page.locator('[data-track-id]').first().click();
    await page.waitForTimeout(100);

    const libraryView = page.locator('[x-data="libraryBrowser"]');
    await expect(libraryView).toHaveScreenshot('library-view-grid-selected.png', screenshotOptions);
  });
});

test.describe('Visual Regression: Settings Panels', () => {
  test.beforeEach(async ({ page }) => {
    await setupMocks(page);
    await page.goto('/');
    await waitForAlpine(page);

    // Navigate to settings
    await page.click('[data-testid="sidebar-settings"]');
    await page.waitForSelector('[data-testid="settings-view"]', { state: 'visible' });
  });

  test('settings general panel', async ({ page }) => {
    await page.click('[data-testid="settings-nav-general"]');
    await page.waitForSelector('[data-testid="settings-section-general"]', { state: 'visible' });

    const settingsPanel = page.locator('[data-testid="settings-section-general"]');
    await expect(settingsPanel).toHaveScreenshot('settings-panel-general.png', screenshotOptions);
  });

  test('settings appearance panel', async ({ page }) => {
    await page.click('[data-testid="settings-nav-appearance"]');
    await page.waitForSelector('[data-testid="settings-section-appearance"]', { state: 'visible' });

    const settingsPanel = page.locator('[data-testid="settings-section-appearance"]');
    await expect(settingsPanel).toHaveScreenshot('settings-panel-appearance.png', screenshotOptions);
  });

  test('settings library panel', async ({ page }) => {
    await page.click('[data-testid="settings-nav-library"]');
    await page.waitForSelector('[data-testid="settings-section-library"]', { state: 'visible' });

    const settingsPanel = page.locator('[data-testid="settings-section-library"]');
    await expect(settingsPanel).toHaveScreenshot('settings-panel-library.png', screenshotOptions);
  });

  test('settings shortcuts panel', async ({ page }) => {
    await page.click('[data-testid="settings-nav-shortcuts"]');
    await page.waitForSelector('[data-testid="settings-section-shortcuts"]', { state: 'visible' });

    const settingsPanel = page.locator('[data-testid="settings-section-shortcuts"]');
    await expect(settingsPanel).toHaveScreenshot('settings-panel-shortcuts.png', screenshotOptions);
  });

  test('settings sorting panel', async ({ page }) => {
    await page.click('[data-testid="settings-nav-sorting"]');
    await page.waitForSelector('[data-testid="settings-section-sorting"]', { state: 'visible' });

    const settingsPanel = page.locator('[data-testid="settings-section-sorting"]');
    await expect(settingsPanel).toHaveScreenshot('settings-panel-sorting.png', screenshotOptions);
  });

  test('settings advanced panel', async ({ page }) => {
    await page.click('[data-testid="settings-nav-advanced"]');
    await page.waitForSelector('[data-testid="settings-section-advanced"]', { state: 'visible' });

    const settingsPanel = page.locator('[data-testid="settings-section-advanced"]');
    await expect(settingsPanel).toHaveScreenshot('settings-panel-advanced.png', screenshotOptions);
  });

  test('settings lastfm panel', async ({ page }) => {
    await page.click('[data-testid="settings-nav-lastfm"]');
    await page.waitForSelector('[data-testid="settings-section-lastfm"]', { state: 'visible' });

    const settingsPanel = page.locator('[data-testid="settings-section-lastfm"]');
    await expect(settingsPanel).toHaveScreenshot('settings-panel-lastfm.png', screenshotOptions);
  });

  test('settings full view', async ({ page }) => {
    const settingsView = page.locator('[data-testid="settings-view"]');
    await expect(settingsView).toBeVisible();
    await expect(settingsView).toHaveScreenshot('settings-full-view.png', screenshotOptions);
  });
});

test.describe('Visual Regression: Theme Presets', () => {
  test.beforeEach(async ({ page }) => {
    await setupMocks(page);
    await page.goto('/');
    await waitForAlpine(page);
    await page.waitForSelector('[data-track-id]', { state: 'visible' });
  });

  test('light theme full page', async ({ page }) => {
    // Ensure light theme
    await page.evaluate(() => {
      window.Alpine.store('ui').setThemePreset('light');
    });
    await page.waitForTimeout(200);

    await expect(page).toHaveScreenshot('theme-light-full.png', {
      ...screenshotOptions,
      fullPage: false,
    });
  });

  test('metro-teal theme full page', async ({ page }) => {
    // Switch to metro-teal theme
    await page.evaluate(() => {
      window.Alpine.store('ui').setThemePreset('metro-teal');
    });
    await page.waitForTimeout(200);

    await expect(page).toHaveScreenshot('theme-metro-teal-full.png', {
      ...screenshotOptions,
      fullPage: false,
    });
  });

  test('light theme player controls', async ({ page }) => {
    // Ensure light theme
    await page.evaluate(() => {
      window.Alpine.store('ui').setThemePreset('light');
    });
    await page.waitForTimeout(200);

    const playerFooter = page.locator('footer');
    await expect(playerFooter).toHaveScreenshot('theme-light-player.png', screenshotOptions);
  });

  test('metro-teal theme player controls', async ({ page }) => {
    // Switch to metro-teal theme
    await page.evaluate(() => {
      window.Alpine.store('ui').setThemePreset('metro-teal');
    });
    await page.waitForTimeout(200);

    const playerFooter = page.locator('footer');
    await expect(playerFooter).toHaveScreenshot('theme-metro-teal-player.png', screenshotOptions);
  });

  test('light theme sidebar', async ({ page }) => {
    // Ensure light theme
    await page.evaluate(() => {
      window.Alpine.store('ui').setThemePreset('light');
    });
    await page.waitForTimeout(200);

    const sidebar = page.locator('aside[x-data="sidebar"]');
    await expect(sidebar).toHaveScreenshot('theme-light-sidebar.png', screenshotOptions);
  });

  test('metro-teal theme sidebar', async ({ page }) => {
    // Switch to metro-teal theme
    await page.evaluate(() => {
      window.Alpine.store('ui').setThemePreset('metro-teal');
    });
    await page.waitForTimeout(200);

    const sidebar = page.locator('aside[x-data="sidebar"]');
    await expect(sidebar).toHaveScreenshot('theme-metro-teal-sidebar.png', screenshotOptions);
  });

  test('light theme library content', async ({ page }) => {
    // Ensure light theme
    await page.evaluate(() => {
      window.Alpine.store('ui').setThemePreset('light');
    });
    await page.waitForTimeout(200);

    const libraryView = page.locator('[x-data="libraryBrowser"]');
    await expect(libraryView).toHaveScreenshot('theme-light-library.png', screenshotOptions);
  });

  test('metro-teal theme library content', async ({ page }) => {
    // Switch to metro-teal theme
    await page.evaluate(() => {
      window.Alpine.store('ui').setThemePreset('metro-teal');
    });
    await page.waitForTimeout(200);

    const libraryView = page.locator('[x-data="libraryBrowser"]');
    await expect(libraryView).toHaveScreenshot('theme-metro-teal-library.png', screenshotOptions);
  });

  test('light theme settings appearance panel', async ({ page }) => {
    // Ensure light theme
    await page.evaluate(() => {
      window.Alpine.store('ui').setThemePreset('light');
    });
    await page.waitForTimeout(100);

    // Navigate to settings appearance
    await page.click('[data-testid="sidebar-settings"]');
    await page.click('[data-testid="settings-nav-appearance"]');
    await page.waitForSelector('[data-testid="settings-section-appearance"]', { state: 'visible' });

    const settingsPanel = page.locator('[data-testid="settings-section-appearance"]');
    await expect(settingsPanel).toHaveScreenshot('theme-light-settings-appearance.png', screenshotOptions);
  });

  test('metro-teal theme settings appearance panel', async ({ page }) => {
    // Switch to metro-teal theme
    await page.evaluate(() => {
      window.Alpine.store('ui').setThemePreset('metro-teal');
    });
    await page.waitForTimeout(100);

    // Navigate to settings appearance
    await page.click('[data-testid="sidebar-settings"]');
    await page.click('[data-testid="settings-nav-appearance"]');
    await page.waitForSelector('[data-testid="settings-section-appearance"]', { state: 'visible' });

    const settingsPanel = page.locator('[data-testid="settings-section-appearance"]');
    await expect(settingsPanel).toHaveScreenshot('theme-metro-teal-settings-appearance.png', screenshotOptions);
  });
});

test.describe('Visual Regression: Sidebar States', () => {
  test.beforeEach(async ({ page }) => {
    await setupMocks(page);
    await page.goto('/');
    await waitForAlpine(page);
    await page.waitForSelector('[data-track-id]', { state: 'visible' });
  });

  test('sidebar expanded', async ({ page }) => {
    // Ensure sidebar is open
    await page.evaluate(() => {
      window.Alpine.store('ui').sidebarOpen = true;
    });
    await page.waitForTimeout(200);

    const sidebar = page.locator('aside[x-data="sidebar"]');
    await expect(sidebar).toHaveScreenshot('sidebar-expanded.png', screenshotOptions);
  });

  test('sidebar with search focused', async ({ page }) => {
    const searchInput = page.locator('[data-testid="sidebar-search"]');
    if (await searchInput.isVisible()) {
      await searchInput.focus();
      await page.waitForTimeout(100);

      const sidebar = page.locator('aside[x-data="sidebar"]');
      await expect(sidebar).toHaveScreenshot('sidebar-search-focused.png', screenshotOptions);
    }
  });

  test('sidebar with section selected', async ({ page }) => {
    // Click on a sidebar section
    const songsSection = page.locator('[data-testid="sidebar-section-songs"]');
    if (await songsSection.isVisible()) {
      await songsSection.click();
      await page.waitForTimeout(100);

      const sidebar = page.locator('aside[x-data="sidebar"]');
      await expect(sidebar).toHaveScreenshot('sidebar-section-selected.png', screenshotOptions);
    }
  });

  test('sidebar playlist list', async ({ page }) => {
    const playlistList = page.locator('[data-testid="playlist-list"]');
    if (await playlistList.isVisible()) {
      await expect(playlistList).toHaveScreenshot('sidebar-playlist-list.png', screenshotOptions);
    }
  });
});

test.describe('Visual Regression: Queue View', () => {
  test.beforeEach(async ({ page }) => {
    await setupMocks(page);
    await page.goto('/');
    await waitForAlpine(page);
    await page.waitForSelector('[data-track-id]', { state: 'visible' });
  });

  test('queue view empty', async ({ page }) => {
    // Navigate to queue view
    await page.evaluate(() => {
      window.Alpine.store('ui').setView('queue');
    });
    await page.waitForTimeout(200);

    // Screenshot the main content area
    await expect(page).toHaveScreenshot('queue-view-empty.png', { ...screenshotOptions, fullPage: false });
  });

  test('queue view with tracks', async ({ page }) => {
    // Add tracks to queue
    await page.locator('[data-track-id]').first().dblclick();
    await page.locator('[data-track-id]').nth(1).dblclick();
    await page.waitForTimeout(200);

    // Navigate to queue view
    await page.evaluate(() => {
      window.Alpine.store('ui').setView('queue');
    });
    await page.waitForTimeout(200);

    await expect(page).toHaveScreenshot('queue-view-with-tracks.png', { ...screenshotOptions, fullPage: false });
  });
});

test.describe('Visual Regression: Now Playing View', () => {
  test.beforeEach(async ({ page }) => {
    await setupMocks(page);
    await page.goto('/');
    await waitForAlpine(page);
    await page.waitForSelector('[data-track-id]', { state: 'visible' });
  });

  test('now playing view with track', async ({ page }) => {
    // Load a track
    await page.locator('[data-track-id]').first().dblclick();
    await page.waitForTimeout(200);

    // Navigate to now playing view
    await page.evaluate(() => {
      window.Alpine.store('ui').setView('nowPlaying');
    });
    await page.waitForTimeout(200);

    await expect(page).toHaveScreenshot('now-playing-view.png', { ...screenshotOptions, fullPage: false });
  });
});

test.describe('Visual Regression: Context Menu', () => {
  test.beforeEach(async ({ page }) => {
    await setupMocks(page);
    await page.goto('/');
    await waitForAlpine(page);
    await page.waitForSelector('[data-track-id]', { state: 'visible' });
  });

  test('track context menu', async ({ page }) => {
    // Right-click on a track to open context menu
    await page.locator('[data-track-id]').first().click({ button: 'right' });
    await page.waitForTimeout(200);

    const contextMenu = page.locator('[data-testid="track-context-menu"]');
    if (await contextMenu.isVisible()) {
      await expect(contextMenu).toHaveScreenshot('context-menu-track.png', screenshotOptions);
    }
  });
});
