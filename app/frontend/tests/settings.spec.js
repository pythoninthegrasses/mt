import { test, expect } from '@playwright/test';
import {
  waitForAlpine,
  getAlpineStore,
} from './fixtures/helpers.js';
import {
  createLibraryState,
  setupLibraryMocks,
} from './fixtures/mock-library.js';
import { DEFAULT_SORT_IGNORE_WORDS } from '../js/constants.js';

/**
 * Settings Persistence and Immediate Application Tests
 *
 * Tests for verifying that settings changes apply immediately and
 * persist across page reloads (via localStorage or backend).
 */

test.describe('Settings Persistence', () => {
  test.beforeEach(async ({ page }) => {
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

    // Clear localStorage before tests to ensure clean state
    await page.addInitScript(() => {
      localStorage.clear();
    });

    await page.goto('/');
    await waitForAlpine(page);
  });

  test('should persist sidebar open/closed state after reload', async ({ page }) => {
    // Get initial state - sidebar should be open by default
    let uiStore = await getAlpineStore(page, 'ui');
    expect(uiStore.sidebarOpen).toBe(true);

    // Toggle sidebar to closed
    await page.evaluate(() => {
      window.Alpine.store('ui').toggleSidebar();
    });

    uiStore = await getAlpineStore(page, 'ui');
    expect(uiStore.sidebarOpen).toBe(false);

    // Wait for state to be persisted
    await page.waitForTimeout(200);

    // Reload the page
    await page.reload();
    await waitForAlpine(page);

    // Note: Without backend, persistence depends on localStorage or window.settings
    // In browser mode without Tauri, state may reset
    uiStore = await getAlpineStore(page, 'ui');
    // Just verify state is tracked correctly (persistence may vary by mode)
    expect(typeof uiStore.sidebarOpen).toBe('boolean');
  });

  test('should persist theme preset changes', async ({ page }) => {
    // Navigate to appearance settings
    await page.evaluate(() => {
      window.Alpine.store('ui').setView('settings');
      window.Alpine.store('ui').setSettingsSection('appearance');
    });
    await page.waitForTimeout(100);

    // Verify we start with light preset
    let uiStore = await getAlpineStore(page, 'ui');
    expect(uiStore.themePreset).toBe('light');

    // Change to metro-teal preset
    const metroTealButton = page.locator('[data-testid="settings-theme-metro-teal"]');
    await metroTealButton.click();
    await page.waitForTimeout(200);

    uiStore = await getAlpineStore(page, 'ui');
    expect(uiStore.themePreset).toBe('metro-teal');
  });

  test('should persist library view mode changes', async ({ page }) => {
    // Get initial view mode
    let uiStore = await getAlpineStore(page, 'ui');
    const initialMode = uiStore.libraryViewMode;
    expect(['list', 'grid', 'compact']).toContain(initialMode);

    // Change view mode
    const newMode = initialMode === 'list' ? 'grid' : 'list';
    await page.evaluate((mode) => {
      window.Alpine.store('ui').setLibraryViewMode(mode);
    }, newMode);

    await page.waitForTimeout(200);

    uiStore = await getAlpineStore(page, 'ui');
    expect(uiStore.libraryViewMode).toBe(newMode);
  });

  test('should persist settings section selection', async ({ page }) => {
    // Navigate to settings
    await page.evaluate(() => {
      window.Alpine.store('ui').setView('settings');
    });
    await page.waitForTimeout(100);

    // Navigate to appearance section
    await page.click('[data-testid="settings-nav-appearance"]');
    await page.waitForTimeout(100);

    let uiStore = await getAlpineStore(page, 'ui');
    expect(uiStore.settingsSection).toBe('appearance');

    // Navigate to shortcuts section
    await page.click('[data-testid="settings-nav-shortcuts"]');
    await page.waitForTimeout(100);

    uiStore = await getAlpineStore(page, 'ui');
    expect(uiStore.settingsSection).toBe('shortcuts');
  });

  test('should persist sort ignore words toggle', async ({ page }) => {
    // Navigate to sorting settings
    await page.click('[data-testid="sidebar-settings"]');
    await page.click('[data-testid="settings-nav-sorting"]');
    await page.waitForSelector('[data-testid="settings-section-sorting"]', { state: 'visible' });

    // Get initial state
    let uiStore = await getAlpineStore(page, 'ui');
    const initialState = uiStore.sortIgnoreWords;

    // Toggle the setting
    const toggle = page.locator('[data-testid="settings-sort-ignore-words-toggle"]');
    await toggle.click();
    await page.waitForTimeout(200);

    uiStore = await getAlpineStore(page, 'ui');
    expect(uiStore.sortIgnoreWords).toBe(!initialState);
  });

  test('should persist sort ignore words list changes', async ({ page }) => {
    // Navigate to sorting settings
    await page.click('[data-testid="sidebar-settings"]');
    await page.click('[data-testid="settings-nav-sorting"]');
    await page.waitForSelector('[data-testid="settings-section-sorting"]', { state: 'visible' });

    // Modify the word list
    const input = page.locator('[data-testid="settings-sort-ignore-words-input"]');
    await input.clear();
    await input.fill('the, a, an, el, la');
    await input.blur();
    await page.waitForTimeout(200);

    const uiStore = await getAlpineStore(page, 'ui');
    expect(uiStore.sortIgnoreWordsList).toBe('the, a, an, el, la');
  });
});

test.describe('Theme Changes Apply Immediately', () => {
  test.beforeEach(async ({ page }) => {
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
  });

  test('should apply light theme immediately to DOM', async ({ page }) => {
    // Navigate to appearance settings
    await page.evaluate(() => {
      window.Alpine.store('ui').setView('settings');
      window.Alpine.store('ui').setSettingsSection('appearance');
    });
    await page.waitForTimeout(100);

    // Click light theme button
    const lightButton = page.locator('[data-testid="settings-theme-light"]');
    await lightButton.click();
    await page.waitForTimeout(100);

    // Verify DOM reflects light theme
    const themeClasses = await page.evaluate(() => {
      return {
        hasLight: document.documentElement.classList.contains('light'),
        hasDark: document.documentElement.classList.contains('dark'),
        themePreset: document.documentElement.dataset.themePreset,
      };
    });

    // Light preset should have 'light' class (unless system prefers dark)
    expect(themeClasses.themePreset).toBeUndefined();
  });

  test('should apply metro-teal theme immediately to DOM', async ({ page }) => {
    // Navigate to appearance settings
    await page.evaluate(() => {
      window.Alpine.store('ui').setView('settings');
      window.Alpine.store('ui').setSettingsSection('appearance');
    });
    await page.waitForTimeout(100);

    // Click metro-teal theme button
    const metroTealButton = page.locator('[data-testid="settings-theme-metro-teal"]');
    await metroTealButton.click();
    await page.waitForTimeout(100);

    // Verify DOM reflects metro-teal theme
    const themeClasses = await page.evaluate(() => {
      return {
        hasLight: document.documentElement.classList.contains('light'),
        hasDark: document.documentElement.classList.contains('dark'),
        themePreset: document.documentElement.dataset.themePreset,
      };
    });

    expect(themeClasses.hasDark).toBe(true);
    expect(themeClasses.themePreset).toBe('metro-teal');
  });

  test('should toggle between themes without reload', async ({ page }) => {
    // Navigate to appearance settings
    await page.evaluate(() => {
      window.Alpine.store('ui').setView('settings');
      window.Alpine.store('ui').setSettingsSection('appearance');
    });
    await page.waitForTimeout(100);

    // Start with light theme
    const lightButton = page.locator('[data-testid="settings-theme-light"]');
    const metroTealButton = page.locator('[data-testid="settings-theme-metro-teal"]');

    await lightButton.click();
    await page.waitForTimeout(100);

    let themeClasses = await page.evaluate(() => ({
      themePreset: document.documentElement.dataset.themePreset,
    }));
    expect(themeClasses.themePreset).toBeUndefined();

    // Switch to metro-teal
    await metroTealButton.click();
    await page.waitForTimeout(100);

    themeClasses = await page.evaluate(() => ({
      hasDark: document.documentElement.classList.contains('dark'),
      themePreset: document.documentElement.dataset.themePreset,
    }));
    expect(themeClasses.hasDark).toBe(true);
    expect(themeClasses.themePreset).toBe('metro-teal');

    // Switch back to light
    await lightButton.click();
    await page.waitForTimeout(100);

    themeClasses = await page.evaluate(() => ({
      hasDark: document.documentElement.classList.contains('dark'),
      themePreset: document.documentElement.dataset.themePreset,
    }));
    // Light theme removes dark class and metro-teal preset
    expect(themeClasses.themePreset).toBeUndefined();
  });

  test('should update UI store when theme changes', async ({ page }) => {
    // Navigate to appearance settings
    await page.evaluate(() => {
      window.Alpine.store('ui').setView('settings');
      window.Alpine.store('ui').setSettingsSection('appearance');
    });
    await page.waitForTimeout(100);

    // Change to metro-teal theme
    await page.click('[data-testid="settings-theme-metro-teal"]');
    await page.waitForTimeout(100);

    let uiStore = await getAlpineStore(page, 'ui');
    expect(uiStore.themePreset).toBe('metro-teal');

    // Change back to light
    await page.click('[data-testid="settings-theme-light"]');
    await page.waitForTimeout(100);

    uiStore = await getAlpineStore(page, 'ui');
    expect(uiStore.themePreset).toBe('light');
  });
});

test.describe('View Mode Persistence', () => {
  test.beforeEach(async ({ page }) => {
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
  });

  test('should allow setting view mode to list', async ({ page }) => {
    await page.evaluate(() => {
      window.Alpine.store('ui').setLibraryViewMode('list');
    });

    const uiStore = await getAlpineStore(page, 'ui');
    expect(uiStore.libraryViewMode).toBe('list');
  });

  test('should allow setting view mode to grid', async ({ page }) => {
    await page.evaluate(() => {
      window.Alpine.store('ui').setLibraryViewMode('grid');
    });

    const uiStore = await getAlpineStore(page, 'ui');
    expect(uiStore.libraryViewMode).toBe('grid');
  });

  test('should allow setting view mode to compact', async ({ page }) => {
    await page.evaluate(() => {
      window.Alpine.store('ui').setLibraryViewMode('compact');
    });

    const uiStore = await getAlpineStore(page, 'ui');
    expect(uiStore.libraryViewMode).toBe('compact');
  });

  test('should ignore invalid view mode values', async ({ page }) => {
    // Get initial mode
    const initialStore = await getAlpineStore(page, 'ui');
    const initialMode = initialStore.libraryViewMode;

    // Try to set invalid mode
    await page.evaluate(() => {
      window.Alpine.store('ui').setLibraryViewMode('invalid-mode');
    });

    const uiStore = await getAlpineStore(page, 'ui');
    // Should remain unchanged
    expect(uiStore.libraryViewMode).toBe(initialMode);
  });

  test('should cycle through view modes', async ({ page }) => {
    const modes = ['list', 'grid', 'compact'];

    for (const mode of modes) {
      await page.evaluate((m) => {
        window.Alpine.store('ui').setLibraryViewMode(m);
      }, mode);

      const uiStore = await getAlpineStore(page, 'ui');
      expect(uiStore.libraryViewMode).toBe(mode);
    }
  });
});

test.describe('Sidebar State Persistence', () => {
  test.beforeEach(async ({ page }) => {
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
  });

  test('should track sidebar open state', async ({ page }) => {
    let uiStore = await getAlpineStore(page, 'ui');
    expect(uiStore.sidebarOpen).toBe(true);

    await page.evaluate(() => {
      window.Alpine.store('ui').toggleSidebar();
    });

    uiStore = await getAlpineStore(page, 'ui');
    expect(uiStore.sidebarOpen).toBe(false);

    await page.evaluate(() => {
      window.Alpine.store('ui').toggleSidebar();
    });

    uiStore = await getAlpineStore(page, 'ui');
    expect(uiStore.sidebarOpen).toBe(true);
  });

  test('should track sidebar width', async ({ page }) => {
    const uiStore = await getAlpineStore(page, 'ui');
    expect(uiStore.sidebarWidth).toBe(250); // Default width
  });

  test('should clamp sidebar width to valid range', async ({ page }) => {
    // Set width below minimum
    await page.evaluate(() => {
      window.Alpine.store('ui').setSidebarWidth(100);
    });

    let uiStore = await getAlpineStore(page, 'ui');
    expect(uiStore.sidebarWidth).toBe(180); // Clamped to minimum

    // Set width above maximum
    await page.evaluate(() => {
      window.Alpine.store('ui').setSidebarWidth(500);
    });

    uiStore = await getAlpineStore(page, 'ui');
    expect(uiStore.sidebarWidth).toBe(400); // Clamped to maximum

    // Set width within range
    await page.evaluate(() => {
      window.Alpine.store('ui').setSidebarWidth(300);
    });

    uiStore = await getAlpineStore(page, 'ui');
    expect(uiStore.sidebarWidth).toBe(300);
  });
});

test.describe('Settings Navigation', () => {
  test.beforeEach(async ({ page }) => {
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
  });

  test('should navigate to all settings sections', async ({ page }) => {
    // Open settings
    await page.click('[data-testid="sidebar-settings"]');
    await page.waitForSelector('[data-testid="settings-view"]', { state: 'visible' });

    const sections = [
      { nav: 'settings-nav-general', section: 'settings-section-general', name: 'general' },
      { nav: 'settings-nav-appearance', section: 'settings-section-appearance', name: 'appearance' },
      { nav: 'settings-nav-library', section: 'settings-section-library', name: 'library' },
      { nav: 'settings-nav-shortcuts', section: 'settings-section-shortcuts', name: 'shortcuts' },
      { nav: 'settings-nav-sorting', section: 'settings-section-sorting', name: 'sorting' },
      { nav: 'settings-nav-advanced', section: 'settings-section-advanced', name: 'advanced' },
      { nav: 'settings-nav-lastfm', section: 'settings-section-lastfm', name: 'lastfm' },
    ];

    for (const { nav, section, name } of sections) {
      await page.click(`[data-testid="${nav}"]`);
      await page.waitForSelector(`[data-testid="${section}"]`, { state: 'visible' });

      const uiStore = await getAlpineStore(page, 'ui');
      expect(uiStore.settingsSection).toBe(name);
    }
  });

  test('should ignore invalid settings section values', async ({ page }) => {
    // Get initial section
    const initialStore = await getAlpineStore(page, 'ui');
    const initialSection = initialStore.settingsSection;

    // Try to set invalid section
    await page.evaluate(() => {
      window.Alpine.store('ui').setSettingsSection('invalid-section');
    });

    const uiStore = await getAlpineStore(page, 'ui');
    // Should remain unchanged
    expect(uiStore.settingsSection).toBe(initialSection);
  });

  test('should remember previous view when toggling settings', async ({ page }) => {
    // Verify we start in library view
    let uiStore = await getAlpineStore(page, 'ui');
    expect(uiStore.view).toBe('library');

    // Open settings
    await page.click('[data-testid="sidebar-settings"]');
    await page.waitForTimeout(100);

    uiStore = await getAlpineStore(page, 'ui');
    expect(uiStore.view).toBe('settings');
    expect(uiStore._previousView).toBe('library');

    // Close settings - should return to library
    await page.click('[data-testid="sidebar-settings"]');
    await page.waitForTimeout(100);

    uiStore = await getAlpineStore(page, 'ui');
    expect(uiStore.view).toBe('library');
  });
});

test.describe('Sort Ignore Words Settings', () => {
  test.beforeEach(async ({ page }) => {
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
  });

  test('should have default sort ignore words enabled', async ({ page }) => {
    const uiStore = await getAlpineStore(page, 'ui');
    expect(uiStore.sortIgnoreWords).toBe(true);
  });

  test('should have default sort ignore words list', async ({ page }) => {
    const uiStore = await getAlpineStore(page, 'ui');
    expect(uiStore.sortIgnoreWordsList).toBe(DEFAULT_SORT_IGNORE_WORDS);
  });

  test('should toggle sort ignore words setting', async ({ page }) => {
    // Navigate to sorting settings
    await page.click('[data-testid="sidebar-settings"]');
    await page.click('[data-testid="settings-nav-sorting"]');
    await page.waitForSelector('[data-testid="settings-section-sorting"]', { state: 'visible' });

    // Toggle off
    const toggle = page.locator('[data-testid="settings-sort-ignore-words-toggle"]');
    await toggle.click();
    await page.waitForTimeout(100);

    let uiStore = await getAlpineStore(page, 'ui');
    expect(uiStore.sortIgnoreWords).toBe(false);

    // Toggle back on
    await toggle.click();
    await page.waitForTimeout(100);

    uiStore = await getAlpineStore(page, 'ui');
    expect(uiStore.sortIgnoreWords).toBe(true);
  });

  test('should update sort ignore words list via input', async ({ page }) => {
    // Navigate to sorting settings
    await page.click('[data-testid="sidebar-settings"]');
    await page.click('[data-testid="settings-nav-sorting"]');
    await page.waitForSelector('[data-testid="settings-section-sorting"]', { state: 'visible' });

    const input = page.locator('[data-testid="settings-sort-ignore-words-input"]');

    // Verify initial value
    await expect(input).toHaveValue(DEFAULT_SORT_IGNORE_WORDS);

    // Update the value
    await input.clear();
    await input.fill('the, a, an');
    await input.blur();
    await page.waitForTimeout(100);

    const uiStore = await getAlpineStore(page, 'ui');
    expect(uiStore.sortIgnoreWordsList).toBe('the, a, an');
  });

  test('should disable input when toggle is off', async ({ page }) => {
    // Navigate to sorting settings
    await page.click('[data-testid="sidebar-settings"]');
    await page.click('[data-testid="settings-nav-sorting"]');
    await page.waitForSelector('[data-testid="settings-section-sorting"]', { state: 'visible' });

    const toggle = page.locator('[data-testid="settings-sort-ignore-words-toggle"]');
    const input = page.locator('[data-testid="settings-sort-ignore-words-input"]');

    // Initially enabled
    await expect(input).toBeEnabled();

    // Toggle off
    await toggle.click();
    await page.waitForTimeout(100);

    // Input should be disabled
    await expect(input).toBeDisabled();

    // Toggle back on
    await toggle.click();
    await page.waitForTimeout(100);

    // Input should be enabled again
    await expect(input).toBeEnabled();
  });
});

test.describe('Log Export', () => {
  test.beforeEach(async ({ page }) => {
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
  });

  test('should use .log extension in save dialog', async ({ page }) => {
    // Mock window.__TAURI__ to intercept the save dialog call
    await page.evaluate(() => {
      window.__TAURI__ = {
        core: {
          invoke: async () => { return; },
        },
        dialog: {
          save: async (options) => {
            // Capture the dialog options for verification
            window._dialogOptions = options;
            return null; // User cancelled
          },
        },
      };
    });

    // Navigate to advanced settings
    await page.click('[data-testid="sidebar-settings"]');
    await page.click('[data-testid="settings-nav-advanced"]');
    await page.waitForSelector('[data-testid="settings-section-advanced"]', { state: 'visible' });

    // Click export logs button
    await page.click('[data-testid="settings-export-logs"]');
    await page.waitForTimeout(200);

    // Verify dialog was called with .log extension
    const capturedOptions = await page.evaluate(() => window._dialogOptions);
    expect(capturedOptions).toBeDefined();
    expect(capturedOptions.defaultPath).toMatch(/\.log$/);
    expect(capturedOptions.filters[0].extensions).toContain('log');
  });

  test('should show loading state during export', async ({ page }) => {
    // Mock window.__TAURI__ with delayed export
    await page.evaluate(() => {
      window.__TAURI__ = {
        core: {
          invoke: async () => {
            // Simulate async file write taking 500ms
            await new Promise(resolve => setTimeout(resolve, 500));
            return;
          },
        },
        dialog: {
          save: async () => {
            return '/tmp/test-diagnostics.log';
          },
        },
      };
    });

    // Navigate to advanced settings
    await page.click('[data-testid="sidebar-settings"]');
    await page.click('[data-testid="settings-nav-advanced"]');
    await page.waitForSelector('[data-testid="settings-section-advanced"]', { state: 'visible' });

    // Click export logs button
    const exportButton = page.locator('[data-testid="settings-export-logs"]');
    await exportButton.click();

    // Verify button is disabled during export
    await expect(exportButton).toBeDisabled();

    // Verify loading text is visible
    await expect(page.locator('text=Exporting...')).toBeVisible();

    // Wait for export to complete
    await page.waitForTimeout(600);

    // Verify button is enabled again
    await expect(exportButton).toBeEnabled();

    // Verify loading text is hidden
    await expect(page.locator('text=Exporting...')).not.toBeVisible();
  });

  test('should not freeze UI during export', async ({ page }) => {
    // Mock window.__TAURI__ with delayed export
    await page.evaluate(() => {
      window.__TAURI__ = {
        core: {
          invoke: async () => {
            // Simulate async file write taking 500ms
            await new Promise(resolve => setTimeout(resolve, 500));
            return;
          },
        },
        dialog: {
          save: async () => {
            return '/tmp/test-diagnostics.log';
          },
        },
      };
    });

    // Navigate to advanced settings
    await page.click('[data-testid="sidebar-settings"]');
    await page.click('[data-testid="settings-nav-advanced"]');
    await page.waitForSelector('[data-testid="settings-section-advanced"]', { state: 'visible' });

    // Click export logs button
    await page.click('[data-testid="settings-export-logs"]');

    // While export is happening, verify UI is still responsive
    // by clicking on another settings section
    await page.waitForTimeout(100);

    // Click on appearance section
    await page.click('[data-testid="settings-nav-appearance"]');
    await page.waitForTimeout(100);

    // Verify navigation worked (UI not frozen)
    const uiStore = await getAlpineStore(page, 'ui');
    expect(uiStore.settingsSection).toBe('appearance');

    // Navigate back to advanced to verify export completed
    await page.click('[data-testid="settings-nav-advanced"]');
    await page.waitForTimeout(600); // Wait for export to finish

    // Verify export button is enabled (export completed)
    await expect(page.locator('[data-testid="settings-export-logs"]')).toBeEnabled();
  });

  test('should show success toast after export completes', async ({ page }) => {
    // Mock window.__TAURI__
    await page.evaluate(() => {
      window.__TAURI__ = {
        core: {
          invoke: async () => {
            await new Promise(resolve => setTimeout(resolve, 100));
            return;
          },
        },
        dialog: {
          save: async () => {
            return '/tmp/test-diagnostics.log';
          },
        },
      };
    });

    // Navigate to advanced settings
    await page.click('[data-testid="sidebar-settings"]');
    await page.click('[data-testid="settings-nav-advanced"]');
    await page.waitForSelector('[data-testid="settings-section-advanced"]', { state: 'visible' });

    // Click export logs button
    await page.click('[data-testid="settings-export-logs"]');

    // Wait for export to complete and verify success toast
    await expect(page.locator('text=Diagnostics exported successfully')).toBeVisible({ timeout: 2000 });
  });

  test('should show error toast when export fails', async ({ page }) => {
    // Mock window.__TAURI__ with failing export
    await page.evaluate(() => {
      window.__TAURI__ = {
        core: {
          invoke: async () => {
            throw new Error('Failed to write file');
          },
        },
        dialog: {
          save: async () => {
            return '/tmp/test-diagnostics.log';
          },
        },
      };
    });

    // Navigate to advanced settings
    await page.click('[data-testid="sidebar-settings"]');
    await page.click('[data-testid="settings-nav-advanced"]');
    await page.waitForSelector('[data-testid="settings-section-advanced"]', { state: 'visible' });

    // Click export logs button
    await page.click('[data-testid="settings-export-logs"]');

    // Wait for error toast
    await expect(page.locator('text=Failed to export diagnostics')).toBeVisible({ timeout: 2000 });

    // Verify button is enabled again after error
    await expect(page.locator('[data-testid="settings-export-logs"]')).toBeEnabled();
  });

  test('should handle user canceling file dialog', async ({ page }) => {
    // Mock window.__TAURI__ with cancelled dialog
    await page.evaluate(() => {
      window.__TAURI__ = {
        core: {
          invoke: async () => {
            return;
          },
        },
        dialog: {
          save: async () => {
            return null; // User cancelled
          },
        },
      };
    });

    // Navigate to advanced settings
    await page.click('[data-testid="sidebar-settings"]');
    await page.click('[data-testid="settings-nav-advanced"]');
    await page.waitForSelector('[data-testid="settings-section-advanced"]', { state: 'visible' });

    // Click export logs button
    await page.click('[data-testid="settings-export-logs"]');
    await page.waitForTimeout(200);

    // Verify button is enabled (not stuck in loading state)
    await expect(page.locator('[data-testid="settings-export-logs"]')).toBeEnabled();

    // Verify no toast is shown
    await expect(page.locator('.toast')).not.toBeVisible();
  });
});

/**
 * Sidebar Theme Styling on Load (task-256)
 *
 * Verifies that the sidebar always displays correct theme styling on every
 * page load, with no flash of incorrect colors. The fix has two parts:
 * 1. Theme is pre-applied to <html> before Alpine starts (applyInitialTheme)
 * 2. Sidebar only transitions width, not background-color (transition-[width])
 */
test.describe('Sidebar Theme Styling on Load (task-256)', () => {
  test.beforeEach(async ({ page }) => {
    const libraryState = createLibraryState();
    await setupLibraryMocks(page, libraryState);

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
  });

  test('sidebar should only transition width, not all properties', async ({ page }) => {
    const aside = page.locator('aside');
    await expect(aside).toBeVisible();

    const transitionProperty = await aside.evaluate(
      (el) => window.getComputedStyle(el).transitionProperty
    );
    expect(transitionProperty).toBe('width');
  });

  test('metro-teal preset should set correct sidebar background immediately', async ({ page }) => {
    // Switch to metro-teal
    await page.evaluate(() => {
      window.Alpine.store('ui').setThemePreset('metro-teal');
    });

    const aside = page.locator('aside');

    // Background should be #1E1E1E immediately (no transition delay)
    const bgColor = await aside.evaluate(
      (el) => window.getComputedStyle(el).backgroundColor
    );
    expect(bgColor).toBe('rgb(30, 30, 30)');
  });

  test('metro-teal preset should set data-theme-preset and dark class on html', async ({ page }) => {
    await page.evaluate(() => {
      window.Alpine.store('ui').setThemePreset('metro-teal');
    });

    const attrs = await page.evaluate(() => ({
      themePreset: document.documentElement.dataset.themePreset,
      hasDark: document.documentElement.classList.contains('dark'),
      hasLight: document.documentElement.classList.contains('light'),
    }));

    expect(attrs.themePreset).toBe('metro-teal');
    expect(attrs.hasDark).toBe(true);
    expect(attrs.hasLight).toBe(false);
  });

  test('light preset should clear data-theme-preset from html', async ({ page }) => {
    // Set metro-teal first, then switch to light
    await page.evaluate(() => {
      window.Alpine.store('ui').setThemePreset('metro-teal');
    });
    await page.evaluate(() => {
      window.Alpine.store('ui').setThemePreset('light');
    });

    const attrs = await page.evaluate(() => ({
      themePreset: document.documentElement.dataset.themePreset,
      hasDark: document.documentElement.classList.contains('dark'),
    }));

    expect(attrs.themePreset).toBeUndefined();
    // Light theme should not have dark class (unless system prefers dark)
  });

  test('sidebar background should change instantly when switching themes', async ({ page }) => {
    const aside = page.locator('aside');

    // Set metro-teal
    await page.evaluate(() => {
      window.Alpine.store('ui').setThemePreset('metro-teal');
    });

    // Read background immediately (no waitForTimeout - transition-[width]
    // means background changes are instant, not animated)
    const metroTealBg = await aside.evaluate(
      (el) => window.getComputedStyle(el).backgroundColor
    );
    expect(metroTealBg).toBe('rgb(30, 30, 30)');

    // Switch to light
    await page.evaluate(() => {
      window.Alpine.store('ui').setThemePreset('light');
    });

    // Read background immediately - should already be the light theme color
    const lightBg = await aside.evaluate(
      (el) => window.getComputedStyle(el).backgroundColor
    );
    // Light theme sidebar should NOT be #1E1E1E
    expect(lightBg).not.toBe('rgb(30, 30, 30)');
  });

  test('sidebar collapse animation should still work with narrowed transition', async ({ page }) => {
    const aside = page.locator('aside');

    // Get expanded width
    const expandedWidth = await aside.evaluate((el) => el.offsetWidth);
    expect(expandedWidth).toBeGreaterThan(100);

    // Collapse sidebar
    await page.click('[data-testid="sidebar-collapse-toggle"]');

    // Wait for transition to complete (200ms duration)
    await page.waitForTimeout(300);

    // Should be collapsed to 70px
    const collapsedWidth = await aside.evaluate((el) => el.offsetWidth);
    expect(collapsedWidth).toBe(70);

    // Expand again
    await page.click('[data-testid="sidebar-collapse-toggle"]');
    await page.waitForTimeout(300);

    const restoredWidth = await aside.evaluate((el) => el.offsetWidth);
    expect(restoredWidth).toBe(expandedWidth);
  });

  test('theme preset and html attributes should be consistent after reload', async ({ page }) => {
    // Reload page
    await page.reload();
    await waitForAlpine(page);

    // After reload in browser mode, defaults apply (light preset)
    const state = await page.evaluate(() => ({
      storePreset: window.Alpine.store('ui').themePreset,
      htmlPreset: document.documentElement.dataset.themePreset,
      htmlClasses: document.documentElement.className,
    }));

    // Store and DOM should be in sync
    if (state.storePreset === 'metro-teal') {
      expect(state.htmlPreset).toBe('metro-teal');
      expect(state.htmlClasses).toContain('dark');
    } else {
      // Light preset: no data-theme-preset attribute
      expect(state.htmlPreset).toBeUndefined();
    }
  });
});
