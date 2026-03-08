import { expect, test } from '@playwright/test';
import { waitForAlpine } from './fixtures/helpers.js';
import { createLibraryState, setupLibraryMocks } from './fixtures/mock-library.js';

test.describe('Network Cache Settings', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1624, height: 1057 });

    const libraryState = createLibraryState();
    await setupLibraryMocks(page, libraryState);

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

    await page.goto('/');
    await waitForAlpine(page);

    // Navigate to Settings > Audio
    await page.click('[data-testid="sidebar-settings"]');
    await page.waitForTimeout(500);
    await page.click('[data-testid="settings-nav-audio"]');
    await page.waitForTimeout(300);
  });

  test('should show Audio nav item in settings', async ({ page }) => {
    const navItem = page.locator('[data-testid="settings-nav-audio"]');
    await expect(navItem).toBeVisible();
    await expect(navItem).toHaveText('Audio');
  });

  test('should display the Audio section', async ({ page }) => {
    const section = page.locator('[data-testid="settings-section-audio"]');
    await expect(section).toBeVisible();
  });

  test('should show network cache toggle defaulting to off', async ({ page }) => {
    const toggle = page.locator('[data-testid="network-cache-toggle"]');
    await expect(toggle).toBeVisible();

    // Default is off, so the toggle should have the muted class
    const classes = await toggle.getAttribute('class');
    expect(classes).toContain('bg-muted');
  });

  test('should show sub-settings when cache is enabled', async ({ page }) => {
    // Persistent toggle, slider, and purge should not be visible initially
    const persistentToggle = page.locator('[data-testid="network-cache-persistent-toggle"]');
    await expect(persistentToggle).not.toBeVisible();

    const slider = page.locator('[data-testid="network-cache-size-slider"]');
    await expect(slider).not.toBeVisible();

    const purgeButton = page.locator('[data-testid="network-cache-purge"]');
    await expect(purgeButton).not.toBeVisible();

    // Enable the cache
    await page.click('[data-testid="network-cache-toggle"]');
    await page.waitForTimeout(300);

    // Now sub-settings should be visible
    await expect(persistentToggle).toBeVisible();
    await expect(slider).toBeVisible();
    await expect(purgeButton).toBeVisible();
  });

  test('should have range slider with correct min/max', async ({ page }) => {
    // Enable cache to show slider
    await page.click('[data-testid="network-cache-toggle"]');
    await page.waitForTimeout(300);

    const slider = page.locator('[data-testid="network-cache-size-slider"]');
    await expect(slider).toHaveAttribute('min', '0.5');
    await expect(slider).toHaveAttribute('max', '20');
    await expect(slider).toHaveAttribute('step', '0.5');
  });

  test('should show cache status when enabled', async ({ page }) => {
    // Enable cache
    await page.click('[data-testid="network-cache-toggle"]');
    await page.waitForTimeout(300);

    // Cache status card should show "0 B" and "0" files
    const usedText = page.locator('text=Used');
    await expect(usedText).toBeVisible();

    const filesText = page.locator('text=Files');
    await expect(filesText).toBeVisible();
  });

  test('should show purge button as disabled when cache is empty', async ({ page }) => {
    // Enable cache
    await page.click('[data-testid="network-cache-toggle"]');
    await page.waitForTimeout(300);

    const purgeButton = page.locator('[data-testid="network-cache-purge"]');
    await expect(purgeButton).toBeDisabled();
  });
});
