import { test, expect } from '@playwright/test';
import {
  waitForAlpine,
  getAlpineStore,
} from './fixtures/helpers.js';

/**
 * Watched Folders E2E Tests
 *
 * Tests for the Settings > General > Watched Folders UI.
 * Note: Folder picker dialogs and actual file system operations require Tauri runtime.
 * These tests validate the UI behavior with mocked Tauri commands.
 */

test.describe('Watched Folders Settings UI', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForAlpine(page);

    // Navigate to Settings
    await page.click('[data-testid="sidebar-settings"]');
    await page.waitForSelector('[data-testid="settings-section-general"]', { state: 'visible' });
  });

  test('should display Watched Folders section in Settings > General', async ({ page }) => {
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
    await page.waitForSelector('[data-testid="settings-section-general"]', { state: 'visible' });

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
    await page.waitForSelector('[data-testid="settings-section-general"]', { state: 'visible' });

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
    await page.waitForSelector('[data-testid="settings-section-general"]', { state: 'visible' });
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
    await page.waitForSelector('[data-testid="settings-section-general"]', { state: 'visible' });
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
    await page.waitForSelector('[data-testid="settings-section-general"]', { state: 'visible' });
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
    await page.waitForSelector('[data-testid="settings-section-general"]', { state: 'visible' });
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
    await page.waitForSelector('[data-testid="settings-section-general"]', { state: 'visible' });
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
    await page.waitForSelector('[data-testid="settings-section-general"]', { state: 'visible' });
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
    await page.waitForSelector('[data-testid="settings-section-general"]', { state: 'visible' });
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
    await page.waitForSelector('[data-testid="settings-section-general"]', { state: 'visible' });
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
    await page.waitForSelector('[data-testid="settings-section-general"]', { state: 'visible' });

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
    await page.waitForSelector('[data-testid="settings-section-general"]', { state: 'visible' });
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
    await page.waitForSelector('[data-testid="settings-section-general"]', { state: 'visible' });
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

/**
 * Watched Folders Utility Functions
 *
 * Tests for the watched-folders.js utility module functions.
 * These tests verify the core logic for extracting parent directories,
 * filtering already-watched paths, and prompting users.
 */
test.describe('Watched Folders Utility Functions', () => {
  test.beforeEach(async ({ page }) => {
    // Mock __TAURI__ with comprehensive watched folders support
    await page.addInitScript(() => {
      window.__tauriDialogCalls = [];
      window.__tauriInvokeCalls = [];
      window.__mockWatchedFolders = [];

      window.__TAURI__ = {
        core: {
          invoke: async (cmd, args) => {
            window.__tauriInvokeCalls.push({ cmd, args });

            if (cmd === 'watched_folders_list') {
              return window.__mockWatchedFolders || [];
            }
            if (cmd === 'watched_folders_add') {
              const newFolder = {
                id: Date.now(),
                path: args.request.path,
                mode: args.request.mode || 'continuous',
                cadence_minutes: args.request.cadence_minutes || 10,
                enabled: args.request.enabled !== false,
              };
              window.__mockWatchedFolders = window.__mockWatchedFolders || [];
              window.__mockWatchedFolders.push(newFolder);
              return newFolder;
            }
            return null;
          }
        },
        dialog: {
          confirm: async (message, options) => {
            window.__tauriDialogCalls.push({ type: 'confirm', message, options });
            // Return true by default (user confirms)
            return window.__mockDialogConfirmResult !== undefined
              ? window.__mockDialogConfirmResult
              : true;
          },
          open: async () => null
        },
        event: {
          listen: async () => () => {}
        }
      };
    });

    await page.goto('/');
    await waitForAlpine(page);
  });

  test('should extract parent directories from file paths', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { extractParentDirectories } = await import('/js/utils/watched-folders.js');
      return extractParentDirectories([
        '/Users/test/Music/Rock/song1.mp3',
        '/Users/test/Music/Rock/song2.mp3',
        '/Users/test/Music/Jazz/track.flac'
      ]);
    });

    expect(result).toContain('/Users/test/Music/Rock');
    expect(result).toContain('/Users/test/Music/Jazz');
    expect(result.length).toBe(2); // Deduplicated
  });

  test('should treat directory paths as-is (not extract parent)', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { extractParentDirectories } = await import('/js/utils/watched-folders.js');
      return extractParentDirectories(['/Users/test/Music/NewAlbum']);
    });

    expect(result).toContain('/Users/test/Music/NewAlbum');
    expect(result.length).toBe(1);
  });

  test('should remove subdirectories when parent directory is also present', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { extractParentDirectories } = await import('/js/utils/watched-folders.js');
      return extractParentDirectories([
        '/Users/test/Music/Doppler',
        '/Users/test/Music/Doppler/Artist A',
        '/Users/test/Music/Doppler/Artist B',
        '/Users/test/Music/Doppler/Artist C',
      ]);
    });

    expect(result).toEqual(['/Users/test/Music/Doppler']);
  });

  test('should collapse many sibling directories into their common parent', async ({ page }) => {
    // When 5+ directories share the same parent but the parent itself is not in the list,
    // they should be collapsed into the parent directory
    const result = await page.evaluate(async () => {
      const { extractParentDirectories } = await import('/js/utils/watched-folders.js');
      return extractParentDirectories([
        '/Users/test/Music/Doppler/Artist A',
        '/Users/test/Music/Doppler/Artist B',
        '/Users/test/Music/Doppler/Artist C',
        '/Users/test/Music/Doppler/Artist D',
        '/Users/test/Music/Doppler/Artist E',
      ]);
    });

    expect(result).toEqual(['/Users/test/Music/Doppler']);
  });

  test('should not collapse few sibling directories', async ({ page }) => {
    // When fewer than 5 directories share the same parent, keep them individual
    const result = await page.evaluate(async () => {
      const { extractParentDirectories } = await import('/js/utils/watched-folders.js');
      return extractParentDirectories([
        '/Users/test/Music/Rock',
        '/Users/test/Music/Jazz',
      ]);
    });

    expect(result).toContain('/Users/test/Music/Rock');
    expect(result).toContain('/Users/test/Music/Jazz');
    expect(result.length).toBe(2);
  });

  test('should prompt and add directories when confirmed', async ({ page }) => {
    await page.evaluate(async () => {
      const { promptToAddWatchedFolders } = await import('/js/utils/watched-folders.js');
      await promptToAddWatchedFolders(['/Users/test/Music/Rock/song1.mp3']);
    });

    await page.waitForTimeout(300);

    // Verify dialog was shown
    const dialogCalls = await page.evaluate(() => window.__tauriDialogCalls);
    const confirmCall = dialogCalls.find(c => c.type === 'confirm');

    expect(confirmCall).toBeTruthy();
    expect(confirmCall.message).toContain('watched folders');
    expect(confirmCall.message).toContain('/Users/test/Music/Rock');

    // Verify directory was added
    const invokeCalls = await page.evaluate(() => window.__tauriInvokeCalls);
    const addCall = invokeCalls.find(c => c.cmd === 'watched_folders_add');

    expect(addCall).toBeTruthy();
    expect(addCall.args.request.path).toBe('/Users/test/Music/Rock');
    expect(addCall.args.request.mode).toBe('continuous');
  });

  test('should not prompt for already-watched directories', async ({ page }) => {
    await page.evaluate(() => {
      window.__mockWatchedFolders = [
        { id: 1, path: '/Users/test/Music/Rock', mode: 'continuous', cadence_minutes: 10, enabled: true }
      ];
    });

    await page.evaluate(async () => {
      const { promptToAddWatchedFolders } = await import('/js/utils/watched-folders.js');
      await promptToAddWatchedFolders(['/Users/test/Music/Rock/song.mp3']);
    });

    await page.waitForTimeout(300);

    // Verify NO dialog was shown
    const dialogCalls = await page.evaluate(() => window.__tauriDialogCalls);
    expect(dialogCalls.length).toBe(0);
  });

  test('should handle user declining confirmation', async ({ page }) => {
    await page.evaluate(() => {
      window.__mockDialogConfirmResult = false;
    });

    await page.evaluate(async () => {
      const { promptToAddWatchedFolders } = await import('/js/utils/watched-folders.js');
      await promptToAddWatchedFolders(['/Users/test/Music/Classical/symphony.mp3']);
    });

    await page.waitForTimeout(300);

    // Dialog was shown
    const dialogCalls = await page.evaluate(() => window.__tauriDialogCalls);
    expect(dialogCalls.length).toBe(1);

    // But directory was NOT added
    const invokeCalls = await page.evaluate(() => window.__tauriInvokeCalls);
    const addCall = invokeCalls.find(c => c.cmd === 'watched_folders_add');

    expect(addCall).toBeFalsy();
  });

  test('should handle multiple unique parent directories', async ({ page }) => {
    await page.evaluate(async () => {
      const { promptToAddWatchedFolders } = await import('/js/utils/watched-folders.js');
      await promptToAddWatchedFolders([
        '/Users/test/Music/Rock/song1.mp3',
        '/Users/test/Music/Jazz/song2.mp3',
        '/Users/test/Music/Classical/song3.mp3'
      ]);
    });

    await page.waitForTimeout(500);

    // Verify dialog lists all unique directories
    const dialogCalls = await page.evaluate(() => window.__tauriDialogCalls);
    const confirmCall = dialogCalls[0];

    expect(confirmCall.message).toContain('/Users/test/Music/Rock');
    expect(confirmCall.message).toContain('/Users/test/Music/Jazz');
    expect(confirmCall.message).toContain('/Users/test/Music/Classical');
    expect(confirmCall.message).toContain('directories'); // Plural

    // Verify all directories were added
    const invokeCalls = await page.evaluate(() => window.__tauriInvokeCalls);
    const addCalls = invokeCalls.filter(c => c.cmd === 'watched_folders_add');

    expect(addCalls.length).toBe(3);
  });
});
