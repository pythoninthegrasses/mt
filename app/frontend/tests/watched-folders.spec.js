import { test, expect } from '@playwright/test';
import { waitForAlpine } from './fixtures/helpers.js';

/**
 * Watched Folders E2E Tests
 *
 * Tests for the Settings > Library > Watched Folders UI.
 * Note: Folder picker dialogs and actual file system operations require Tauri runtime.
 * These tests validate the UI behavior with mocked Tauri commands.
 */

test.describe('Watched Folders Settings UI', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForAlpine(page);

    // Navigate to Settings > Library
    await page.click('[data-testid="sidebar-settings"]');
    await page.click('[data-testid="settings-nav-library"]');
    await page.waitForSelector('[data-testid="settings-section-library"]', { state: 'visible' });
  });

  test('should display Watched Folders section in Settings > Library', async ({ page }) => {
    const watchedFoldersHeader = page.locator('h4:has-text("Watched Folders")');
    await expect(watchedFoldersHeader).toBeVisible();

    const description = page.locator('text=Automatically scan these folders for new music');
    await expect(description).toBeVisible();
  });

  test('should show browser fallback message when not in Tauri', async ({ page }) => {
    // In browser mode, __TAURI__ is undefined
    const isTauri = await page.evaluate(() => !!window.__TAURI__);

    if (!isTauri) {
      const fallbackMessage = page.locator('text=Watched folders are only available in the desktop app');
      await expect(fallbackMessage).toBeVisible();
    }
  });
});

/**
 * Watched Folders UI with Mocked Tauri Environment
 *
 * These tests require mocking __TAURI__ BEFORE page load so Alpine.js
 * renders the Tauri-specific templates.
 */
test.describe('Watched Folders with Mocked Tauri', () => {
  test.beforeEach(async ({ page }) => {
    // Mock __TAURI__ before page load
    await page.addInitScript(() => {
      window.__TAURI__ = {
        core: {
          invoke: async (cmd, args) => {
            // Mock responses for Tauri commands
            if (cmd === 'watched_folders_list') {
              return window.__mockWatchedFolders || [];
            }
            if (cmd === 'watched_folders_add') {
              const newFolder = {
                id: Date.now(),
                path: args.request.path,
                mode: args.request.mode || 'continuous',
                cadence_minutes: args.request.cadence_minutes || 10,
                enabled: true,
              };
              window.__mockWatchedFolders = window.__mockWatchedFolders || [];
              window.__mockWatchedFolders.push(newFolder);
              return newFolder;
            }
            if (cmd === 'watched_folders_update') {
              return { id: args.id, ...args.request };
            }
            if (cmd === 'watched_folders_remove') {
              return null;
            }
            if (cmd === 'watched_folders_rescan') {
              return null;
            }
            return null;
          }
        },
        dialog: {
          open: async () => '/Users/test/MockedFolder'
        }
      };
      window.__mockWatchedFolders = [];
    });
  });

  test('should show empty state when no watched folders in Tauri mode', async ({ page }) => {
    await page.goto('/');
    await waitForAlpine(page);

    await page.click('[data-testid="sidebar-settings"]');
    await page.click('[data-testid="settings-nav-library"]');
    await page.waitForSelector('[data-testid="settings-section-library"]', { state: 'visible' });

    // Wait for the settings view to initialize
    await page.waitForTimeout(200);

    // In Tauri mode with no folders, should show empty state (not fallback)
    const emptyState = page.locator('text=No watched folders configured');
    await expect(emptyState).toBeVisible();

    const addFirstFolderBtn = page.locator('[data-testid="watched-folder-add-empty-btn"]');
    await expect(addFirstFolderBtn).toBeVisible();
  });

  test('should display watched folders list with folder items', async ({ page }) => {
    // Pre-populate mock folders
    await page.addInitScript(() => {
      window.__mockWatchedFolders = [
        { id: 1, path: '/Users/test/Music', mode: 'continuous', cadence_minutes: 10, enabled: true },
        { id: 2, path: '/Users/test/Downloads', mode: 'startup', cadence_minutes: null, enabled: true }
      ];
    });

    await page.goto('/');
    await waitForAlpine(page);

    await page.click('[data-testid="sidebar-settings"]');
    await page.click('[data-testid="settings-nav-library"]');
    await page.waitForSelector('[data-testid="settings-section-library"]', { state: 'visible' });

    // Wait for Alpine to process the watched folders
    await page.waitForTimeout(300);

    const foldersList = page.locator('[data-testid="watched-folders-list"]');
    await expect(foldersList).toBeVisible();

    const folderItems = page.locator('[data-testid^="watched-folder-item-"]');
    await expect(folderItems).toHaveCount(2);
  });

  test('should display mode selector for each folder', async ({ page }) => {
    await page.addInitScript(() => {
      window.__mockWatchedFolders = [
        { id: 1, path: '/Users/test/Music', mode: 'continuous', cadence_minutes: 10, enabled: true }
      ];
    });

    await page.goto('/');
    await waitForAlpine(page);

    await page.click('[data-testid="sidebar-settings"]');
    await page.click('[data-testid="settings-nav-library"]');
    await page.waitForSelector('[data-testid="settings-section-library"]', { state: 'visible' });
    await page.waitForTimeout(300);

    const modeSelect = page.locator('[data-testid="watched-folder-item-1"] select');
    await expect(modeSelect).toBeVisible();

    const options = modeSelect.locator('option');
    await expect(options).toHaveCount(2);
    await expect(options.nth(0)).toHaveText('On startup');
    await expect(options.nth(1)).toHaveText('Continuous');
  });

  test('should show cadence input only for continuous mode', async ({ page }) => {
    await page.addInitScript(() => {
      window.__mockWatchedFolders = [
        { id: 1, path: '/Users/test/Music', mode: 'continuous', cadence_minutes: 10, enabled: true },
        { id: 2, path: '/Users/test/Downloads', mode: 'startup', cadence_minutes: null, enabled: true }
      ];
    });

    await page.goto('/');
    await waitForAlpine(page);

    await page.click('[data-testid="sidebar-settings"]');
    await page.click('[data-testid="settings-nav-library"]');
    await page.waitForSelector('[data-testid="settings-section-library"]', { state: 'visible' });
    await page.waitForTimeout(300);

    // Continuous mode folder should have cadence input
    const continuousFolderCadence = page.locator('[data-testid="watched-folder-item-1"] input[type="number"]');
    await expect(continuousFolderCadence).toBeVisible();

    // Startup mode folder should NOT have cadence input
    const startupFolderCadence = page.locator('[data-testid="watched-folder-item-2"] input[type="number"]');
    await expect(startupFolderCadence).not.toBeVisible();
  });

  test('should display rescan button for each folder', async ({ page }) => {
    await page.addInitScript(() => {
      window.__mockWatchedFolders = [
        { id: 1, path: '/Users/test/Music', mode: 'continuous', cadence_minutes: 10, enabled: true }
      ];
    });

    await page.goto('/');
    await waitForAlpine(page);

    await page.click('[data-testid="sidebar-settings"]');
    await page.click('[data-testid="settings-nav-library"]');
    await page.waitForSelector('[data-testid="settings-section-library"]', { state: 'visible' });
    await page.waitForTimeout(300);

    const rescanBtn = page.locator('[data-testid="watched-folder-rescan-btn-1"]');
    await expect(rescanBtn).toBeVisible();
    await expect(rescanBtn).toHaveAttribute('title', 'Rescan now');
  });

  test('should display remove button for each folder', async ({ page }) => {
    await page.addInitScript(() => {
      window.__mockWatchedFolders = [
        { id: 1, path: '/Users/test/Music', mode: 'continuous', cadence_minutes: 10, enabled: true }
      ];
    });

    await page.goto('/');
    await waitForAlpine(page);

    await page.click('[data-testid="sidebar-settings"]');
    await page.click('[data-testid="settings-nav-library"]');
    await page.waitForSelector('[data-testid="settings-section-library"]', { state: 'visible' });
    await page.waitForTimeout(300);

    const removeBtn = page.locator('[data-testid="watched-folder-remove-btn-1"]');
    await expect(removeBtn).toBeVisible();
    await expect(removeBtn).toHaveAttribute('title', 'Remove folder');
  });

  test('should display Add Folder button', async ({ page }) => {
    await page.addInitScript(() => {
      window.__mockWatchedFolders = [
        { id: 1, path: '/Users/test/Music', mode: 'continuous', cadence_minutes: 10, enabled: true }
      ];
    });

    await page.goto('/');
    await waitForAlpine(page);

    await page.click('[data-testid="sidebar-settings"]');
    await page.click('[data-testid="settings-nav-library"]');
    await page.waitForSelector('[data-testid="settings-section-library"]', { state: 'visible' });
    await page.waitForTimeout(300);

    const addBtn = page.locator('[data-testid="watched-folder-add-btn"]');
    await expect(addBtn).toBeVisible();
    await expect(addBtn).toHaveText('Add Folder');
  });

  test('should truncate long folder paths', async ({ page }) => {
    const longPath = '/Users/verylongusername/Documents/Very Long Folder Name/Another Long Folder/Music Library';

    await page.addInitScript((path) => {
      window.__mockWatchedFolders = [
        { id: 1, path: path, mode: 'continuous', cadence_minutes: 10, enabled: true }
      ];
    }, longPath);

    await page.goto('/');
    await waitForAlpine(page);

    await page.click('[data-testid="sidebar-settings"]');
    await page.click('[data-testid="settings-nav-library"]');
    await page.waitForSelector('[data-testid="settings-section-library"]', { state: 'visible' });
    await page.waitForTimeout(300);

    const pathSpan = page.locator('[data-testid="watched-folder-item-1"] span.font-mono');
    const displayedPath = await pathSpan.textContent();

    // Path should be truncated (contains ...)
    expect(displayedPath).toContain('...');
    // Full path should be in title attribute
    await expect(pathSpan).toHaveAttribute('title', longPath);
  });
});

test.describe('Watched Folders Actions', () => {
  test.beforeEach(async ({ page }) => {
    // Mock __TAURI__ before page load
    await page.addInitScript(() => {
      window.__tauriInvokeCalls = [];
      window.__TAURI__ = {
        core: {
          invoke: async (cmd, args) => {
            window.__tauriInvokeCalls.push({ cmd, args });
            if (cmd === 'watched_folders_list') {
              return window.__mockWatchedFolders || [];
            }
            if (cmd === 'watched_folders_remove') {
              window.__mockWatchedFolders = (window.__mockWatchedFolders || []).filter(f => f.id !== args.id);
              return null;
            }
            if (cmd === 'watched_folders_update') {
              const folder = window.__mockWatchedFolders?.find(f => f.id === args.id);
              if (folder) {
                Object.assign(folder, args.request);
              }
              return folder || { id: args.id, ...args.request };
            }
            if (cmd === 'watched_folders_rescan') {
              return null;
            }
            return null;
          }
        },
        dialog: { open: async () => null }
      };
      window.__mockWatchedFolders = [];
    });
  });

  test('should remove folder from list when remove button clicked', async ({ page }) => {
    await page.addInitScript(() => {
      window.__mockWatchedFolders = [
        { id: 1, path: '/Users/test/Music', mode: 'continuous', cadence_minutes: 10, enabled: true },
        { id: 2, path: '/Users/test/Downloads', mode: 'startup', cadence_minutes: null, enabled: true }
      ];
    });

    await page.goto('/');
    await waitForAlpine(page);

    await page.click('[data-testid="sidebar-settings"]');
    await page.click('[data-testid="settings-nav-library"]');
    await page.waitForSelector('[data-testid="settings-section-library"]', { state: 'visible' });
    await page.waitForTimeout(300);

    // Verify 2 folders exist
    let folderItems = page.locator('[data-testid^="watched-folder-item-"]');
    await expect(folderItems).toHaveCount(2);

    // Click remove on first folder
    await page.click('[data-testid="watched-folder-remove-btn-1"]');

    await page.waitForTimeout(300);

    // Verify only 1 folder remains
    folderItems = page.locator('[data-testid^="watched-folder-item-"]');
    await expect(folderItems).toHaveCount(1);
  });

  test('should update mode when mode selector changed', async ({ page }) => {
    await page.addInitScript(() => {
      window.__mockWatchedFolders = [
        { id: 1, path: '/Users/test/Music', mode: 'continuous', cadence_minutes: 10, enabled: true }
      ];
    });

    await page.goto('/');
    await waitForAlpine(page);

    await page.click('[data-testid="sidebar-settings"]');
    await page.click('[data-testid="settings-nav-library"]');
    await page.waitForSelector('[data-testid="settings-section-library"]', { state: 'visible' });
    await page.waitForTimeout(300);

    // Change mode to startup
    const modeSelect = page.locator('[data-testid="watched-folder-item-1"] select');
    await modeSelect.selectOption('startup');

    await page.waitForTimeout(300);

    // Verify update was called
    const invokeCalls = await page.evaluate(() => window.__tauriInvokeCalls);
    const updateCall = invokeCalls.find(c => c.cmd === 'watched_folders_update');
    expect(updateCall).toBeTruthy();
    expect(updateCall.args.id).toBe(1);
    expect(updateCall.args.request?.mode).toBe('startup');
  });

  test('should show loading state during folder operations', async ({ page }) => {
    await page.goto('/');
    await waitForAlpine(page);

    await page.click('[data-testid="sidebar-settings"]');
    await page.click('[data-testid="settings-nav-library"]');
    await page.waitForSelector('[data-testid="settings-section-library"]', { state: 'visible' });

    // Set loading state directly via Alpine
    await page.evaluate(() => {
      const settingsView = document.querySelector('[x-data="settingsView"]');
      if (settingsView && window.Alpine) {
        const data = window.Alpine.$data(settingsView);
        data.watchedFoldersLoading = true;
      }
    });

    await page.waitForTimeout(100);

    const loadingState = page.locator('text=Loading...');
    await expect(loadingState).toBeVisible();
  });
});

test.describe('Watched Folders Rescan', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.__tauriInvokeCalls = [];
      window.__TAURI__ = {
        core: {
          invoke: async (cmd, args) => {
            window.__tauriInvokeCalls.push({ cmd, args });
            if (cmd === 'watched_folders_list') {
              return window.__mockWatchedFolders || [];
            }
            if (cmd === 'watched_folders_rescan') {
              return null;
            }
            return null;
          }
        },
        dialog: { open: async () => null }
      };
      window.__mockWatchedFolders = [];
    });
  });

  test('should trigger rescan when rescan button clicked', async ({ page }) => {
    await page.addInitScript(() => {
      window.__mockWatchedFolders = [
        { id: 1, path: '/Users/test/Music', mode: 'continuous', cadence_minutes: 10, enabled: true }
      ];
    });

    await page.goto('/');
    await waitForAlpine(page);

    await page.click('[data-testid="sidebar-settings"]');
    await page.click('[data-testid="settings-nav-library"]');
    await page.waitForSelector('[data-testid="settings-section-library"]', { state: 'visible' });
    await page.waitForTimeout(300);

    // Click rescan button
    await page.click('[data-testid="watched-folder-rescan-btn-1"]');

    await page.waitForTimeout(300);

    // Verify rescan was called
    const invokeCalls = await page.evaluate(() => window.__tauriInvokeCalls);
    const rescanCall = invokeCalls.find(c => c.cmd === 'watched_folders_rescan');
    expect(rescanCall).toBeTruthy();
    expect(rescanCall.args.id).toBe(1);
  });

  test('should show scanning indicator during rescan', async ({ page }) => {
    await page.addInitScript(() => {
      window.__mockWatchedFolders = [
        { id: 1, path: '/Users/test/Music', mode: 'continuous', cadence_minutes: 10, enabled: true }
      ];
    });

    await page.goto('/');
    await waitForAlpine(page);

    await page.click('[data-testid="sidebar-settings"]');
    await page.click('[data-testid="settings-nav-library"]');
    await page.waitForSelector('[data-testid="settings-section-library"]', { state: 'visible' });
    await page.waitForTimeout(300);

    // Set scanning state directly via Alpine
    await page.evaluate(() => {
      const settingsView = document.querySelector('[x-data="settingsView"]');
      if (settingsView && window.Alpine) {
        const data = window.Alpine.$data(settingsView);
        data.scanningFolders = new Set([1]);
      }
    });

    await page.waitForTimeout(100);

    // Rescan button should be disabled during scan
    const rescanBtn = page.locator('[data-testid="watched-folder-rescan-btn-1"]');
    await expect(rescanBtn).toBeDisabled();

    // Icon should have spin animation class
    const spinIcon = page.locator('[data-testid="watched-folder-rescan-btn-1"] svg.animate-spin');
    await expect(spinIcon).toBeVisible();
  });
});

// 'Watched Folders Utility Functions' describe removed: used page.evaluate(import())
// against raw source paths unavailable in the preview bundle. Pure function
// coverage belongs in Vitest (__tests__/watched-folders.test.js).