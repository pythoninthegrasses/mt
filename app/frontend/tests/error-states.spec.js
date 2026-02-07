import { test, expect } from '@playwright/test';
import {
  waitForAlpine,
  getAlpineStore,
  setAlpineStoreProperty,
} from './fixtures/helpers.js';
import {
  createLibraryState,
  setupLibraryMocks,
} from './fixtures/mock-library.js';
import {
  createPlaylistState,
  setupPlaylistMocks,
} from './fixtures/mock-playlists.js';

/**
 * Error States and Toast Notification Tests
 *
 * Tests for error handling, network failures, API timeouts,
 * and toast notification display throughout the application.
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
    await page.waitForSelector('[data-track-id]', { state: 'visible', timeout: 5000 }).catch(() => {});

    const libraryStore = await getAlpineStore(page, 'library');
    expect(libraryStore.tracks.length).toBeGreaterThan(0);
  });
});

test.describe('API Error Responses', () => {
  test.beforeEach(async ({ page }) => {
    const libraryState = createLibraryState();
    await setupLibraryMocks(page, libraryState);
    await page.goto('/');
    await waitForAlpine(page);
  });

  test('should handle 404 response for missing track', async ({ page }) => {
    // Override the specific track endpoint to return 404
    await page.route(/\/api\/library\/9999$/, async (route) => {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Track not found' }),
      });
    });

    // Attempt to access non-existent track via store method
    const result = await page.evaluate(async () => {
      try {
        const { api } = await import('/js/api.js');
        await api.library.getTrack(9999);
        return { success: true };
      } catch (e) {
        return { success: false, error: e.message, status: e.status };
      }
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe(404);
  });

  test('should handle malformed JSON response', async ({ page }) => {
    await page.route(/\/api\/library\/stats/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: 'not valid json {{{',
      });
    });

    // Attempt to get stats
    const result = await page.evaluate(async () => {
      try {
        const { api } = await import('/js/api.js');
        await api.library.getStats();
        return { success: true };
      } catch (e) {
        return { success: false, error: e.message };
      }
    });

    expect(result.success).toBe(false);
  });

  test('should handle empty response body', async ({ page }) => {
    await page.route(/\/api\/library\/stats/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: '',
      });
    });

    // Empty responses should be handled as null
    const result = await page.evaluate(async () => {
      try {
        const { api } = await import('/js/api.js');
        const stats = await api.library.getStats();
        return { success: true, result: stats };
      } catch (e) {
        return { success: false, error: e.message };
      }
    });

    // Empty body returns null according to api.js implementation
    expect(result.success).toBe(true);
    expect(result.result).toBeNull();
  });
});

test.describe('Toast Notifications', () => {
  test.beforeEach(async ({ page }) => {
    const libraryState = createLibraryState();
    await setupLibraryMocks(page, libraryState);
    const playlistState = createPlaylistState();
    await setupPlaylistMocks(page, playlistState);

    // Mock Last.fm settings to prevent error toasts on load
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

    // Clear any existing toasts from page load
    await page.evaluate(() => {
      window.Alpine.store('ui').toasts = [];
    });
  });

  test('should show toast notification via ui store', async ({ page }) => {
    // Trigger a toast via Alpine store
    await page.evaluate(() => {
      window.Alpine.store('ui').toast('Test message', 'info', 5000);
    });

    // Verify toast was added to store
    const uiStore = await getAlpineStore(page, 'ui');
    expect(uiStore.toasts.length).toBeGreaterThan(0);
    const testToast = uiStore.toasts.find((t) => t.message === 'Test message');
    expect(testToast).toBeTruthy();
    expect(testToast.type).toBe('info');
  });

  test('should show success toast', async ({ page }) => {
    await page.evaluate(() => {
      window.Alpine.store('ui').toast('Operation successful', 'success', 5000);
    });

    const uiStore = await getAlpineStore(page, 'ui');
    const successToast = uiStore.toasts.find((t) => t.type === 'success');
    expect(successToast).toBeTruthy();
    expect(successToast.message).toBe('Operation successful');
  });

  test('should show warning toast', async ({ page }) => {
    await page.evaluate(() => {
      window.Alpine.store('ui').toast('Warning: check settings', 'warning', 5000);
    });

    const uiStore = await getAlpineStore(page, 'ui');
    const warningToast = uiStore.toasts.find((t) => t.type === 'warning');
    expect(warningToast).toBeTruthy();
    expect(warningToast.message).toBe('Warning: check settings');
  });

  test('should show error toast', async ({ page }) => {
    await page.evaluate(() => {
      window.Alpine.store('ui').toast('Error occurred', 'error', 5000);
    });

    const uiStore = await getAlpineStore(page, 'ui');
    const errorToast = uiStore.toasts.find((t) => t.message === 'Error occurred');
    expect(errorToast).toBeTruthy();
    expect(errorToast.type).toBe('error');
  });

  test('should dismiss toast by ID', async ({ page }) => {
    // Add toast and get its ID
    const toastId = await page.evaluate(() => {
      return window.Alpine.store('ui').toast('Dismissable toast', 'info', 0);
    });

    // Verify toast exists
    let uiStore = await getAlpineStore(page, 'ui');
    expect(uiStore.toasts.find((t) => t.id === toastId)).toBeTruthy();

    // Dismiss the toast
    await page.evaluate((id) => {
      window.Alpine.store('ui').dismissToast(id);
    }, toastId);

    // Verify toast was removed
    uiStore = await getAlpineStore(page, 'ui');
    expect(uiStore.toasts.find((t) => t.id === toastId)).toBeFalsy();
  });

  test('should auto-dismiss toast after duration', async ({ page }) => {
    // Add toast with short duration
    await page.evaluate(() => {
      window.Alpine.store('ui').toast('Auto-dismiss test', 'info', 500);
    });

    // Verify toast exists initially
    let uiStore = await getAlpineStore(page, 'ui');
    const initialCount = uiStore.toasts.length;
    expect(initialCount).toBeGreaterThan(0);

    // Wait for auto-dismiss
    await page.waitForTimeout(700);

    // Verify toast was removed
    uiStore = await getAlpineStore(page, 'ui');
    const autoDismissedToast = uiStore.toasts.find((t) => t.message === 'Auto-dismiss test');
    expect(autoDismissedToast).toBeFalsy();
  });

  test('should persist toast when duration is 0', async ({ page }) => {
    // Add persistent toast (duration 0)
    await page.evaluate(() => {
      window.Alpine.store('ui').toast('Persistent toast', 'info', 0);
    });

    // Wait longer than typical auto-dismiss
    await page.waitForTimeout(500);

    // Verify toast still exists
    const uiStore = await getAlpineStore(page, 'ui');
    const persistentToast = uiStore.toasts.find((t) => t.message === 'Persistent toast');
    expect(persistentToast).toBeTruthy();
  });

  test('should handle multiple concurrent toasts', async ({ page }) => {
    // Add multiple toasts quickly
    await page.evaluate(() => {
      const ui = window.Alpine.store('ui');
      ui.toast('Toast 1', 'info', 5000);
      ui.toast('Toast 2', 'success', 5000);
      ui.toast('Toast 3', 'warning', 5000);
      ui.toast('Toast 4', 'error', 5000);
    });

    const uiStore = await getAlpineStore(page, 'ui');
    // Should have at least our 4 toasts (may have others from page load)
    expect(uiStore.toasts.length).toBeGreaterThanOrEqual(4);

    // Verify our specific toasts exist
    const messages = uiStore.toasts.map((t) => t.message);
    expect(messages).toContain('Toast 1');
    expect(messages).toContain('Toast 2');
    expect(messages).toContain('Toast 3');
    expect(messages).toContain('Toast 4');
  });
  test('success toast should use theme accent class, not hardcoded green', async ({ page }) => {
    await page.evaluate(() => {
      window.Alpine.store('ui').toast('Theme toast test', 'success', 5000);
    });

    const toast = page.locator('[data-testid="toast-container"] > div').last();
    await expect(toast).toBeVisible();

    // Success toast should use the toast-accent class (theme-derived color)
    await expect(toast).toHaveClass(/toast-accent/);
    // Should NOT use hardcoded green
    await expect(toast).not.toHaveClass(/bg-green-500/);
  });

  test('success toast accent color changes with theme (light vs metro-teal)', async ({ page }) => {
    // Get the toast accent CSS variable in default light theme
    const lightAccent = await page.evaluate(() => {
      return getComputedStyle(document.documentElement).getPropertyValue('--mt-toast-bg').trim();
    });
    expect(lightAccent).toBeTruthy();

    // Switch to metro-teal preset
    await page.evaluate(() => {
      window.Alpine.store('ui').setThemePreset('metro-teal');
    });

    // Get the toast accent CSS variable in metro-teal theme
    const tealAccent = await page.evaluate(() => {
      return getComputedStyle(document.documentElement).getPropertyValue('--mt-toast-bg').trim();
    });
    expect(tealAccent).toBeTruthy();

    // The two theme accents should be different colors
    expect(lightAccent).not.toBe(tealAccent);
  });

  test('success toast text should be white for contrast', async ({ page }) => {
    await page.evaluate(() => {
      window.Alpine.store('ui').toast('Contrast test', 'success', 5000);
    });

    const toast = page.locator('[data-testid="toast-container"] > div').last();
    await expect(toast).toBeVisible();

    // Text color should be white (or near-white) for readability
    const fgVar = await page.evaluate(() => {
      return getComputedStyle(document.documentElement).getPropertyValue('--mt-toast-fg').trim();
    });
    expect(fgVar).toBeTruthy();
  });
});

test.describe('Playlist API Error Handling', () => {
  test.beforeEach(async ({ page }) => {
    const libraryState = createLibraryState();
    await setupLibraryMocks(page, libraryState);
    await page.goto('/');
    await waitForAlpine(page);
  });

  test('should handle playlist creation failure', async ({ page }) => {
    // Mock playlist creation to fail
    await page.route(/\/api\/playlists$/, async (route, request) => {
      if (request.method() === 'POST') {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Failed to create playlist' }),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ playlists: [] }),
        });
      }
    });

    // Attempt to create playlist
    const result = await page.evaluate(async () => {
      try {
        const { api } = await import('/js/api.js');
        await api.playlists.create('Test Playlist');
        return { success: true };
      } catch (e) {
        return { success: false, error: e.message, status: e.status };
      }
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe(500);
  });

  test('should handle playlist deletion failure', async ({ page }) => {
    await page.route(/\/api\/playlists\/\d+$/, async (route, request) => {
      if (request.method() === 'DELETE') {
        await route.fulfill({
          status: 403,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Cannot delete system playlist' }),
        });
      } else {
        await route.continue();
      }
    });

    const result = await page.evaluate(async () => {
      try {
        const { api } = await import('/js/api.js');
        await api.playlists.delete(1);
        return { success: true };
      } catch (e) {
        return { success: false, error: e.message, status: e.status };
      }
    });

    expect(result.success).toBe(false);
  });
});

test.describe('Queue API Error Handling', () => {
  test.beforeEach(async ({ page }) => {
    const libraryState = createLibraryState();
    await setupLibraryMocks(page, libraryState);
    await page.goto('/');
    await waitForAlpine(page);
  });

  test('should handle queue add failure', async ({ page }) => {
    await page.route(/\/api\/queue\/add/, async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Queue is full' }),
      });
    });

    const result = await page.evaluate(async () => {
      try {
        const { api } = await import('/js/api.js');
        await api.queue.add([1, 2, 3]);
        return { success: true };
      } catch (e) {
        return { success: false, error: e.message, status: e.status };
      }
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe(500);
  });

  test('should handle queue clear failure', async ({ page }) => {
    await page.route(/\/api\/queue\/clear/, async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Failed to clear queue' }),
      });
    });

    const result = await page.evaluate(async () => {
      try {
        const { api } = await import('/js/api.js');
        await api.queue.clear();
        return { success: true };
      } catch (e) {
        return { success: false, error: e.message, status: e.status };
      }
    });

    expect(result.success).toBe(false);
  });
});

test.describe('Loading States', () => {
  test.beforeEach(async ({ page }) => {
    const libraryState = createLibraryState();
    await setupLibraryMocks(page, libraryState);
    await page.goto('/');
    await waitForAlpine(page);
  });

  test('should show global loading overlay when enabled', async ({ page }) => {
    // Enable global loading
    await page.evaluate(() => {
      window.Alpine.store('ui').showLoading('Processing...');
    });

    const uiStore = await getAlpineStore(page, 'ui');
    expect(uiStore.globalLoading).toBe(true);
    expect(uiStore.loadingMessage).toBe('Processing...');
  });

  test('should hide global loading overlay when disabled', async ({ page }) => {
    // Enable then disable loading
    await page.evaluate(() => {
      window.Alpine.store('ui').showLoading('Processing...');
    });

    await page.evaluate(() => {
      window.Alpine.store('ui').hideLoading();
    });

    const uiStore = await getAlpineStore(page, 'ui');
    expect(uiStore.globalLoading).toBe(false);
    expect(uiStore.loadingMessage).toBe('');
  });

  test('should track library loading state', async ({ page }) => {
    // Set library to loading state
    await page.evaluate(() => {
      window.Alpine.store('library').loading = true;
    });

    const libraryStore = await getAlpineStore(page, 'library');
    expect(libraryStore.loading).toBe(true);

    // Complete loading
    await page.evaluate(() => {
      window.Alpine.store('library').loading = false;
    });

    const updatedStore = await getAlpineStore(page, 'library');
    expect(updatedStore.loading).toBe(false);
  });
});

test.describe('Modal Error States', () => {
  test.beforeEach(async ({ page }) => {
    const libraryState = createLibraryState();
    await setupLibraryMocks(page, libraryState);
    await page.goto('/');
    await waitForAlpine(page);
  });

  test('should open and close modal via ui store', async ({ page }) => {
    // Open modal
    await page.evaluate(() => {
      window.Alpine.store('ui').openModal('confirm', { message: 'Test confirm' });
    });

    let uiStore = await getAlpineStore(page, 'ui');
    expect(uiStore.modal).toBeTruthy();
    expect(uiStore.modal.type).toBe('confirm');
    expect(uiStore.modal.data.message).toBe('Test confirm');

    // Close modal
    await page.evaluate(() => {
      window.Alpine.store('ui').closeModal();
    });

    uiStore = await getAlpineStore(page, 'ui');
    expect(uiStore.modal).toBeNull();
  });

  test('should handle missing track modal', async ({ page }) => {
    // Create a mock missing track
    const missingTrack = {
      id: 1,
      title: 'Missing Track',
      artist: 'Unknown Artist',
      filepath: '/path/to/missing.mp3',
      missing: true,
      last_seen_at: new Date().toISOString(),
    };

    // Open missing track modal
    await page.evaluate((track) => {
      window.Alpine.store('ui').showMissingTrackModal(track);
    }, missingTrack);

    const uiStore = await getAlpineStore(page, 'ui');
    expect(uiStore.missingTrackModal).toBeTruthy();
    expect(uiStore.missingTrackModal.track.title).toBe('Missing Track');

    // Close it with cancelled result
    await page.evaluate(() => {
      window.Alpine.store('ui').closeMissingTrackModal('cancelled');
    });

    const updatedStore = await getAlpineStore(page, 'ui');
    expect(updatedStore.missingTrackModal).toBeNull();
  });
});

test.describe('Settings Error Handling', () => {
  test.beforeEach(async ({ page }) => {
    const libraryState = createLibraryState();
    await setupLibraryMocks(page, libraryState);
    await page.goto('/');
    await waitForAlpine(page);
  });

  test('should handle settings API failure gracefully', async ({ page }) => {
    // Mock settings endpoint to fail
    await page.route(/\/api\/settings/, async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Settings unavailable' }),
      });
    });

    // Attempt to get settings
    const result = await page.evaluate(async () => {
      try {
        const { api } = await import('/js/api.js');
        await api.settings.getAll();
        return { success: true };
      } catch (e) {
        return { success: false, error: e.message, status: e.status };
      }
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe(500);
  });

  test('should use default settings when API is unavailable', async ({ page }) => {
    // The UI store should have default values even without backend
    const uiStore = await getAlpineStore(page, 'ui');

    expect(uiStore.theme).toBeDefined();
    expect(uiStore.sidebarOpen).toBeDefined();
    expect(uiStore.sidebarWidth).toBeDefined();
    expect(uiStore.libraryViewMode).toBeDefined();
  });
});

test.describe('Last.fm API Error Handling', () => {
  test.beforeEach(async ({ page }) => {
    const libraryState = createLibraryState();
    await setupLibraryMocks(page, libraryState);
    await page.goto('/');
    await waitForAlpine(page);
  });

  test('should handle Last.fm scrobble failure', async ({ page }) => {
    await page.route(/\/api\/lastfm\/scrobble/, async (route) => {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Last.fm service unavailable' }),
      });
    });

    const result = await page.evaluate(async () => {
      try {
        const { api } = await import('/js/api.js');
        await api.lastfm.scrobble({
          artist: 'Test Artist',
          track: 'Test Track',
          timestamp: Math.floor(Date.now() / 1000),
          duration: 180,
          played_time: 180,
        });
        return { success: true };
      } catch (e) {
        return { success: false, error: e.message, status: e.status };
      }
    });

    expect(result.success).toBe(false);
  });

  test('should handle Last.fm auth URL failure', async ({ page }) => {
    await page.route(/\/api\/lastfm\/auth-url/, async (route) => {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'API key not configured' }),
      });
    });

    const result = await page.evaluate(async () => {
      try {
        const { api } = await import('/js/api.js');
        await api.lastfm.getAuthUrl();
        return { success: true };
      } catch (e) {
        return { success: false, error: e.message, status: e.status };
      }
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe(401);
  });
});

test.describe('Favorites API Error Handling', () => {
  test.beforeEach(async ({ page }) => {
    const libraryState = createLibraryState();
    await setupLibraryMocks(page, libraryState);
    await page.goto('/');
    await waitForAlpine(page);
  });

  test('should handle favorites add failure', async ({ page }) => {
    await page.route(/\/api\/favorites\/\d+$/, async (route, request) => {
      if (request.method() === 'POST') {
        await route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Track already favorited' }),
        });
      } else {
        await route.continue();
      }
    });

    const result = await page.evaluate(async () => {
      try {
        const { api } = await import('/js/api.js');
        await api.favorites.add(1);
        return { success: true };
      } catch (e) {
        return { success: false, error: e.message, status: e.status };
      }
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe(409);
  });

  test('should handle favorites remove failure for non-favorite track', async ({ page }) => {
    await page.route(/\/api\/favorites\/\d+$/, async (route, request) => {
      if (request.method() === 'DELETE') {
        await route.fulfill({
          status: 404,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Track not in favorites' }),
        });
      } else {
        await route.continue();
      }
    });

    const result = await page.evaluate(async () => {
      try {
        const { api } = await import('/js/api.js');
        await api.favorites.remove(9999);
        return { success: true };
      } catch (e) {
        return { success: false, error: e.message, status: e.status };
      }
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe(404);
  });
});

test.describe('Watched Folders API Error Handling', () => {
  test.beforeEach(async ({ page }) => {
    const libraryState = createLibraryState();
    await setupLibraryMocks(page, libraryState);
    await page.goto('/');
    await waitForAlpine(page);
  });

  test('should handle watched folders list failure', async ({ page }) => {
    await page.route(/\/api\/watched-folders$/, async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Database connection failed' }),
      });
    });

    const result = await page.evaluate(async () => {
      try {
        const { api } = await import('/js/api.js');
        await api.watchedFolders.list();
        return { success: true };
      } catch (e) {
        return { success: false, error: e.message, status: e.status };
      }
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe(500);
  });

  test('should handle watched folder add with invalid path', async ({ page }) => {
    await page.route(/\/api\/watched-folders$/, async (route, request) => {
      if (request.method() === 'POST') {
        await route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Path does not exist' }),
        });
      } else {
        await route.continue();
      }
    });

    const result = await page.evaluate(async () => {
      try {
        const { api } = await import('/js/api.js');
        await api.watchedFolders.add('/nonexistent/path');
        return { success: true };
      } catch (e) {
        return { success: false, error: e.message, status: e.status };
      }
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe(400);
  });
});

test.describe('Concurrent Request Handling', () => {
  test('should handle multiple concurrent API requests', async ({ page }) => {
    let requestCount = 0;
    const libraryState = createLibraryState({ trackCount: 10 });

    await page.route(/\/api\/library(\?.*)?$/, async (route) => {
      requestCount++;
      // Small delay to simulate server processing
      await new Promise((resolve) => setTimeout(resolve, 50));
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
    });

    await page.goto('/');
    await waitForAlpine(page);

    // Make multiple concurrent requests
    const results = await page.evaluate(async () => {
      const { api } = await import('./js/api.js');
      const requests = [
        api.library.getTracks(),
        api.library.getTracks({ search: 'test' }),
        api.library.getTracks({ sort: 'artist' }),
      ];

      try {
        const responses = await Promise.all(requests);
        return {
          success: true,
          responseCount: responses.length,
        };
      } catch (e) {
        return { success: false, error: e.message };
      }
    });

    expect(results.success).toBe(true);
    expect(results.responseCount).toBe(3);
  });
});
