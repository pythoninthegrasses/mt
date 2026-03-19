import { expect, test } from '@playwright/test';
import { waitForAlpine } from './fixtures/helpers.js';

test.describe('Network Cache Settings', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1624, height: 1057 });

    await page.addInitScript(() => {
      const cacheState = {
        enabled: false,
        persistent: false,
        max_bytes: 2147483648,
        used_bytes: 0,
        file_count: 0,
      };

      window.__TAURI__ = {
        core: {
          invoke: (cmd, args) => {
            if (cmd === 'network_cache_status') {
              return Promise.resolve({ ...cacheState });
            }
            if (cmd === 'network_cache_purge') {
              cacheState.used_bytes = 0;
              cacheState.file_count = 0;
              return Promise.resolve(null);
            }
            if (cmd === 'audio_list_devices') {
              return Promise.resolve({ devices: [] });
            }
            if (cmd === 'audio_set_device') {
              return Promise.resolve(null);
            }
            if (cmd === 'app_get_info') {
              return Promise.resolve({
                version: 'test',
                build: 'test',
                platform: 'test',
              });
            }
            if (cmd === 'watched_folders_list') {
              return Promise.resolve([]);
            }
            if (cmd === 'lastfm_get_settings') {
              return Promise.resolve({
                enabled: false,
                authenticated: false,
                scrobble_threshold: 90,
              });
            }
            if (cmd === 'settings_get') {
              if (args?.key === 'network_cache_enabled') {
                return Promise.resolve({
                  key: 'network_cache_enabled',
                  value: cacheState.enabled,
                });
              }
              return Promise.resolve({ key: args?.key, value: null });
            }
            if (cmd === 'settings_set') {
              if (args?.key === 'network_cache_enabled') {
                cacheState.enabled = args.value;
              }
              if (args?.key === 'network_cache_persistent') {
                cacheState.persistent = args.value;
              }
              return Promise.resolve({ key: args?.key, value: args?.value });
            }
            return Promise.resolve(null);
          },
        },
        event: {
          listen: () => Promise.resolve(() => {}),
        },
        dialog: {
          confirm: () => Promise.resolve(true),
        },
      };
    });

    await page.goto('/');
    await waitForAlpine(page);

    // Navigate to Settings > Audio
    await page.click('[data-testid="sidebar-settings"]');
    await page.waitForSelector('[data-testid="settings-nav-audio"]', {
      state: 'visible',
    });
    await page.click('[data-testid="settings-nav-audio"]');
    await page.waitForSelector('[data-testid="settings-section-audio"]', {
      state: 'visible',
    });
  });

  test('should show Audio nav item in settings', async ({ page }) => {
    const navItem = page.locator('[data-testid="settings-nav-audio"]');
    await expect(navItem).toBeVisible();
    await expect(navItem).toHaveText('Audio');
  });

  test('should display the Audio section', async ({ page }) => {
    const section = page.locator(
      '[data-testid="settings-section-audio"]',
    );
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
    const persistentToggle = page.locator(
      '[data-testid="network-cache-persistent-toggle"]',
    );
    await expect(persistentToggle).not.toBeVisible();

    const slider = page.locator(
      '[data-testid="network-cache-size-slider"]',
    );
    await expect(slider).not.toBeVisible();

    const purgeButton = page.locator(
      '[data-testid="network-cache-purge"]',
    );
    await expect(purgeButton).not.toBeVisible();

    // Enable the cache
    await page.click('[data-testid="network-cache-toggle"]');

    // Now sub-settings should be visible
    await expect(persistentToggle).toBeVisible();
    await expect(slider).toBeVisible();
    await expect(purgeButton).toBeVisible();
  });

  test('should have range slider with correct min/max', async ({ page }) => {
    // Enable cache to show slider
    await page.click('[data-testid="network-cache-toggle"]');

    const slider = page.locator(
      '[data-testid="network-cache-size-slider"]',
    );
    await expect(slider).toBeVisible();
    await expect(slider).toHaveAttribute('min', '0.5');
    await expect(slider).toHaveAttribute('max', '20');
    await expect(slider).toHaveAttribute('step', '0.5');
  });

  test('should show cache status when enabled', async ({ page }) => {
    // Enable cache
    await page.click('[data-testid="network-cache-toggle"]');

    // Cache status card should show "Used" and "Files" labels
    const usedText = page.getByText('Used', { exact: true });
    await expect(usedText).toBeVisible();

    const filesText = page.getByText('Files', { exact: true });
    await expect(filesText).toBeVisible();
  });

  test('should show purge button as disabled when cache is empty', async ({ page }) => {
    // Enable cache
    await page.click('[data-testid="network-cache-toggle"]');

    const purgeButton = page.locator(
      '[data-testid="network-cache-purge"]',
    );
    await expect(purgeButton).toBeDisabled();
  });
});
