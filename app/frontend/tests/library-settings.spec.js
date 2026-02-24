import { expect, test } from '@playwright/test';
import { waitForAlpine } from './fixtures/helpers.js';

test.describe('Library Settings UI', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForAlpine(page);

    await page.click('[data-testid="sidebar-settings"]');
    await page.waitForSelector('[data-testid="settings-nav-library"]', { state: 'visible' });
  });

  test('should display Library nav item in settings sidebar', async ({ page }) => {
    const libraryNav = page.locator('[data-testid="settings-nav-library"]');
    await expect(libraryNav).toBeVisible();
    await expect(libraryNav).toHaveText('Library');
  });

  test('should navigate to Library section when clicked', async ({ page }) => {
    await page.click('[data-testid="settings-nav-library"]');
    const librarySection = page.locator('[data-testid="settings-section-library"]');
    await expect(librarySection).toBeVisible();
  });

  test('should display Manual Scan subsection', async ({ page }) => {
    await page.click('[data-testid="settings-nav-library"]');

    const librarySection = page.locator('[data-testid="settings-section-library"]');
    await expect(librarySection).toBeVisible();

    const scanTitle = librarySection.locator('text=Manual Scan');
    await expect(scanTitle).toBeVisible();

    const scanDescription = librarySection.locator('text=Update file fingerprints');
    await expect(scanDescription).toBeVisible();
  });

  test('should display Run Scan button', async ({ page }) => {
    await page.click('[data-testid="settings-nav-library"]');

    const scanButton = page.locator('[data-testid="settings-reconcile-scan"]');
    await expect(scanButton).toBeVisible();
    await expect(scanButton).toHaveText('Run Scan');
  });
});

test.describe('Library Settings with Mocked Tauri', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.__TAURI__ = {
        core: {
          invoke: async (cmd) => {
            if (cmd === 'library_reconcile_scan') {
              return {
                backfilled: 5,
                duplicates_merged: 2,
                errors: 0,
              };
            }
            if (cmd === 'app_get_info') {
              return { version: 'test', build: 'test', platform: 'test' };
            }
            if (cmd === 'watched_folders_list') {
              return [];
            }
            if (cmd === 'lastfm_get_settings') {
              return { enabled: false, authenticated: false, scrobble_threshold: 90 };
            }
            return null;
          },
        },
        event: {
          listen: async () => () => {},
        },
        dialog: {
          confirm: async () => true,
        },
      };
    });

    await page.goto('/');
    await waitForAlpine(page);

    await page.click('[data-testid="sidebar-settings"]');
    await page.click('[data-testid="settings-nav-library"]');
    await page.waitForSelector('[data-testid="settings-section-library"]', { state: 'visible' });
  });

  test('should run reconcile scan and display results', async ({ page }) => {
    const scanButton = page.locator('[data-testid="settings-reconcile-scan"]');
    await scanButton.click();

    await page.waitForSelector('text=Last scan results:', { state: 'visible' });

    const resultsSection = page.locator('[data-testid="settings-section-library"]');
    await expect(resultsSection.locator('text=Backfilled')).toBeVisible();
    await expect(resultsSection.locator('text=Duplicates Merged')).toBeVisible();
    await expect(resultsSection.locator('text=Errors')).toBeVisible();
  });

  test('should disable button while scanning', async ({ page }) => {
    await page.addInitScript(() => {
      const originalInvoke = window.__TAURI__.core.invoke;
      window.__TAURI__.core.invoke = async (cmd, args) => {
        if (cmd === 'library_reconcile_scan') {
          await new Promise((resolve) => setTimeout(resolve, 500));
          return { backfilled: 0, duplicates_merged: 0, errors: 0 };
        }
        return originalInvoke(cmd, args);
      };
    });

    await page.reload();
    await waitForAlpine(page);
    await page.click('[data-testid="sidebar-settings"]');
    await page.click('[data-testid="settings-nav-library"]');

    const scanButton = page.locator('[data-testid="settings-reconcile-scan"]');
    await scanButton.click();

    await expect(scanButton).toBeDisabled();
  });

  test('should display progress bar during reconcile scan', async ({ page }) => {
    // Mock listen to capture the callback so we can emit progress events
    await page.addInitScript(() => {
      window.__reconcileListeners = [];
      const originalInvoke = window.__TAURI__.core.invoke;
      window.__TAURI__.core.invoke = async (cmd, args) => {
        if (cmd === 'library_reconcile_scan') {
          // Emit progress events before resolving
          for (const cb of window.__reconcileListeners) {
            cb({ payload: { phase: 'fingerprinting', current: 50, total: 200 } });
          }
          await new Promise((resolve) => setTimeout(resolve, 200));
          for (const cb of window.__reconcileListeners) {
            cb({ payload: { phase: 'complete', current: 200, total: 200 } });
          }
          return { backfilled: 3, duplicates_merged: 1, errors: 0 };
        }
        return originalInvoke(cmd, args);
      };
      window.__TAURI__.event.listen = async (event, cb) => {
        if (event === 'reconcile:progress') {
          window.__reconcileListeners.push(cb);
        }
        return () => {
          window.__reconcileListeners = window.__reconcileListeners.filter((l) => l !== cb);
        };
      };
    });

    await page.reload();
    await waitForAlpine(page);
    await page.click('[data-testid="sidebar-settings"]');
    await page.click('[data-testid="settings-nav-library"]');

    const scanButton = page.locator('[data-testid="settings-reconcile-scan"]');
    await scanButton.click();

    // Progress bar should appear during scan
    const progress = page.locator('[data-testid="reconcile-progress"]');
    await expect(progress).toBeVisible({ timeout: 2000 });
    await expect(progress.locator('text=Computing fingerprints')).toBeVisible();
    await expect(progress.locator('text=50 / 200')).toBeVisible();

    // After scan completes, progress should disappear and results show
    await page.waitForSelector('text=Last scan results:', { state: 'visible', timeout: 5000 });
    await expect(progress).not.toBeVisible();
  });

  test('should remain responsive during reconcile scan', async ({ page }) => {
    await page.addInitScript(() => {
      const originalInvoke = window.__TAURI__.core.invoke;
      window.__TAURI__.core.invoke = async (cmd, args) => {
        if (cmd === 'library_reconcile_scan') {
          await new Promise((resolve) => setTimeout(resolve, 300));
          return { backfilled: 0, duplicates_merged: 0, errors: 0 };
        }
        return originalInvoke(cmd, args);
      };
    });

    await page.reload();
    await waitForAlpine(page);
    await page.click('[data-testid="sidebar-settings"]');
    await page.click('[data-testid="settings-nav-library"]');

    const scanButton = page.locator('[data-testid="settings-reconcile-scan"]');
    await scanButton.click();

    // UI should remain responsive: we can still interact with other settings nav items
    const appearanceNav = page.locator('[data-testid="settings-nav-appearance"]');
    await expect(appearanceNav).toBeVisible();
    await appearanceNav.click();
    const appearanceSection = page.locator('[data-testid="settings-section-appearance"]');
    await expect(appearanceSection).toBeVisible();
  });
});
