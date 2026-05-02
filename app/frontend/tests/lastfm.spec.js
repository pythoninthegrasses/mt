import { test, expect } from '@playwright/test';
import {
  waitForAlpine,
  getAlpineStore,
} from './fixtures/helpers.js';

test.describe('Last.fm Integration', () => {
  test.describe('Authentication Flow', () => {
    test.beforeEach(async ({ page }) => {
      // Set viewport size to mimic desktop use
      await page.setViewportSize({ width: 1624, height: 1057 });

      // Mock unauthenticated state for authentication flow tests
      // IMPORTANT: Set up route mocks BEFORE page.goto() to intercept player store's init() call
      await page.route('**/lastfm/settings', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            enabled: false,
            authenticated: false,
            username: null,
            scrobble_threshold: 90,
            configured: true,
          }),
        });
      });

      await page.goto('/');
      await waitForAlpine(page);

      // Navigate to settings
      await page.click('[data-testid="sidebar-settings"]');
      await page.waitForSelector('[data-testid="settings-nav-lastfm"]');
      // Click on Last.fm section
      await page.click('[data-testid="settings-nav-lastfm"]');
      await page.waitForSelector('[data-testid="settings-section-lastfm"]');
    });

    test('should display connection status indicator', async ({ page }) => {
      // Check for status indicator
      const statusIndicator = page.locator('.w-3.h-3.rounded-full').first();
      await expect(statusIndicator).toBeVisible();

      // Should show red (not connected) initially
      const classes = await statusIndicator.getAttribute('class');
      expect(classes).toContain('bg-red-500');
    });

    test('should show "Not Connected" status when not authenticated', async ({ page }) => {
      const statusText = page.locator('text=Not Connected').first();
      await expect(statusText).toBeVisible();
    });

    test('should show Connect button when not authenticated', async ({ page }) => {
      const connectButton = page.locator('[data-testid="lastfm-connect"]');
      await expect(connectButton).toBeVisible();
      await expect(connectButton).toHaveText('Connect');
    });

    test('should handle auth flow with pending state', async ({ page }) => {
      await page.route('**/lastfm/auth-url', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            auth_url: 'https://www.last.fm/api/auth/?api_key=test&token=testtoken123',
            token: 'testtoken123',
          }),
        });
      });

      // Click Connect button
      await page.click('[data-testid="lastfm-connect"]');

      // Check that status changed to "Awaiting Authorization" with yellow indicator
      const statusText = page.locator('text=Awaiting Authorization').first();
      await expect(statusText).toBeVisible();

      const statusIndicator = page.locator('.w-3.h-3.rounded-full').first();
      const classes = await statusIndicator.getAttribute('class');
      expect(classes).toContain('bg-yellow-500');

      // Check that Complete Authentication button is visible
      const completeButton = page.locator('[data-testid="lastfm-complete-auth"]');
      await expect(completeButton).toBeVisible();
      await expect(completeButton).toHaveText('Complete Authentication');

      // Check that Cancel button is visible
      const cancelButton = page.locator('[data-testid="lastfm-cancel-auth"]');
      await expect(cancelButton).toBeVisible();
      await expect(cancelButton).toHaveText('Cancel');

      // Connect button should be hidden
      const connectButton = page.locator('[data-testid="lastfm-connect"]');
      await expect(connectButton).not.toBeVisible();
    });

    test('should complete authentication successfully', async ({ page }) => {
      await page.route('**/lastfm/auth-url', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            auth_url: 'https://www.last.fm/api/auth/?api_key=test&token=testtoken123',
            token: 'testtoken123',
          }),
        });
      });

      await page.route('**/lastfm/auth-callback**', async (route) => {
        const postData = route.request().postDataJSON();
        // Handle both POST with body and GET/POST without body
        if (postData?.token === 'testtoken123' || route.request().url().includes('token=testtoken123')) {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              username: 'testuser',
              authenticated: true,
            }),
          });
        } else {
          // Default successful response for any auth-callback
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              username: 'testuser',
              authenticated: true,
            }),
          });
        }
      });

      await page.route('**/lastfm/queue/status', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            queued_scrobbles: 0,
          }),
        });
      });

      // Click Connect
      await page.click('[data-testid="lastfm-connect"]');
      await page.waitForSelector('[data-testid="lastfm-complete-auth"]');

      // Click Complete Authentication
      await page.click('[data-testid="lastfm-complete-auth"]');

      // Verify authenticated state
      const statusText = page.locator('text=Connected as testuser').first();
      await expect(statusText).toBeVisible({ timeout: 5000 });

      // Status indicator should be green
      const statusIndicator = page.locator('.w-3.h-3.rounded-full').first();
      const classes = await statusIndicator.getAttribute('class');
      expect(classes).toContain('bg-green-500');

      // Disconnect button should be visible
      const disconnectButton = page.locator('[data-testid="lastfm-disconnect"]');
      await expect(disconnectButton).toBeVisible();
    });

    test('should cancel pending authentication', async ({ page }) => {
      await page.route('**/lastfm/auth-url', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            auth_url: 'https://www.last.fm/api/auth/?api_key=test&token=testtoken123',
            token: 'testtoken123',
          }),
        });
      });

      // Click Connect
      await page.click('[data-testid="lastfm-connect"]');

      // Verify we're in pending state
      await expect(page.locator('[data-testid="lastfm-cancel-auth"]')).toBeVisible();

      // Click Cancel
      await page.click('[data-testid="lastfm-cancel-auth"]');

      // Should return to not connected state
      const statusText = page.locator('text=Not Connected').first();
      await expect(statusText).toBeVisible();

      // Connect button should be visible again
      const connectButton = page.locator('[data-testid="lastfm-connect"]');
      await expect(connectButton).toBeVisible();

      // Complete and Cancel buttons should be hidden
      await expect(page.locator('[data-testid="lastfm-complete-auth"]')).not.toBeVisible();
      await expect(page.locator('[data-testid="lastfm-cancel-auth"]')).not.toBeVisible();
    });

    test('should handle authentication errors gracefully', async ({ page }) => {
      await page.route('**/lastfm/auth-url', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            auth_url: 'https://www.last.fm/api/auth/?api_key=test&token=testtoken123',
            token: 'testtoken123',
          }),
        });
      });

      await page.route('**/lastfm/auth-callback**', async (route) => {
        await route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({
            detail: 'Authentication failed',
          }),
        });
      });

      // Click Connect
      await page.click('[data-testid="lastfm-connect"]');
      await page.waitForSelector('[data-testid="lastfm-complete-auth"]');

      // Click Complete Authentication
      await page.click('[data-testid="lastfm-complete-auth"]');

      // Should still show pending state (or return to not connected depending on implementation)
      // The important thing is it doesn't crash
      const awaitingText = page.locator('text=Awaiting Authorization').first();
      const notConnectedText = page.locator('text=Not Connected').first();
      await expect(awaitingText.or(notConnectedText)).toBeVisible({ timeout: 5000 });
    });

    test('should show disconnect button when authenticated', async ({ page }) => {
      // Simulate already authenticated state
      await page.evaluate(() => {
        const settingsComponent = window.Alpine.$data(document.querySelector('[x-data*="settingsView"]'));
        if (settingsComponent) {
          settingsComponent.lastfm.authenticated = true;
          settingsComponent.lastfm.username = 'testuser';
        }
      });

      // Verify disconnect button is visible
      const disconnectButton = page.locator('[data-testid="lastfm-disconnect"]');
      await expect(disconnectButton).toBeVisible();

      // Connect button should not be visible
      const connectButton = page.locator('[data-testid="lastfm-connect"]');
      await expect(connectButton).not.toBeVisible();
    });

    test('should display contextual help text based on auth state', async ({ page }) => {
      // Initial state: show connect help text
      const connectHelpText = page.locator('text=Connect your Last.fm account to enable scrobbling');
      await expect(connectHelpText).toBeVisible();

      await page.route('**/lastfm/auth-url', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            auth_url: 'https://www.last.fm/api/auth/?api_key=test&token=testtoken123',
            token: 'testtoken123',
          }),
        });
      });

      // Click Connect
      await page.click('[data-testid="lastfm-connect"]');

      // Pending state: show complete authentication help text
      const pendingHelpText = page.locator('text=After authorizing on Last.fm, click "Complete Authentication"');
      await expect(pendingHelpText).toBeVisible();
    });
  });

  test.describe('Now Playing Updates', () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width: 1624, height: 1057 });
      await page.goto('/');
      await waitForAlpine(page);
    });

    test('should update Now Playing when track starts playing', async ({ page }) => {
      let nowPlayingCalled = false;
      let nowPlayingData = null;

      await page.route('**/lastfm/now-playing', async (route) => {
        nowPlayingCalled = true;
        nowPlayingData = route.request().postDataJSON();
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            status: 'success',
            message: 'Now playing updated',
          }),
        });
      });

      // Simulate track playing (mock player state)
      await page.evaluate(() => {
        const player = window.Alpine.store('player');
        player.currentTrack = {
          id: '1',
          title: 'Test Track',
          artist: 'Test Artist',
          album: 'Test Album',
        };
        player.duration = 240000; // 4 minutes in ms
        player.isPlaying = true;

        // Trigger Now Playing update
        player._updateLastfmNowPlaying();
      });

      await expect.poll(() => nowPlayingCalled, { timeout: 3000 }).toBe(true);
      expect(nowPlayingData).toMatchObject({
        artist: 'Test Artist',
        track: 'Test Track',
        album: 'Test Album',
        duration: 240, // Should be in seconds
      });
    });

    test('should handle Now Playing errors silently', async ({ page }) => {
      // Mock failed Now Playing update
      await page.route('**/lastfm/now-playing', async (route) => {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({
            detail: 'Internal server error',
          }),
        });
      });

      // Simulate track playing
      await page.evaluate(() => {
        const player = window.Alpine.store('player');
        player.currentTrack = {
          id: '1',
          title: 'Test Track',
          artist: 'Test Artist',
        };
        player.duration = 180000;
        player.isPlaying = true;

        // Trigger Now Playing update
        player._updateLastfmNowPlaying();
      });

      // App should still be functional
      const player = await getAlpineStore(page, 'player');
      expect(player.currentTrack.title).toBe('Test Track');
    });

    test('should include album in Now Playing if available', async ({ page }) => {
      let nowPlayingData = null;

      await page.route('**/lastfm/now-playing', async (route) => {
        nowPlayingData = route.request().postDataJSON();
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ status: 'success' }),
        });
      });

      await page.evaluate(() => {
        const player = window.Alpine.store('player');
        player.currentTrack = {
          id: '1',
          title: 'Track With Album',
          artist: 'Artist Name',
          album: 'Album Name',
        };
        player.duration = 200000;
        player._updateLastfmNowPlaying();
      });

      await expect.poll(() => nowPlayingData, { timeout: 3000 }).not.toBeNull();
      expect(nowPlayingData.album).toBe('Album Name');
    });

    test('should omit album from Now Playing if not available', async ({ page }) => {
      let nowPlayingData = null;

      await page.route('**/lastfm/now-playing', async (route) => {
        nowPlayingData = route.request().postDataJSON();
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ status: 'success' }),
        });
      });

      await page.evaluate(() => {
        const player = window.Alpine.store('player');
        player.currentTrack = {
          id: '1',
          title: 'Track Without Album',
          artist: 'Artist Name',
          // No album field
        };
        player.duration = 200000;
        player._updateLastfmNowPlaying();
      });

      await expect.poll(() => nowPlayingData, { timeout: 3000 }).not.toBeNull();
      expect(nowPlayingData.album).toBeUndefined();
    });
  });

  // 'Scrobble API (task-007)' tests removed: used page.evaluate(import('/js/api.js'))
  // which is unavailable in the preview bundle. API behavior belongs in Rust tests.

  test.describe('Settings Persistence', () => {
    test('should load Last.fm settings on init', async ({ page }) => {
      await page.setViewportSize({ width: 1624, height: 1057 });

      await page.route('**/lastfm/settings', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            enabled: true,
            authenticated: true,
            username: 'loadeduser',
            scrobble_threshold: 0.9,
          }),
        });
      });

      await page.goto('/');
      await waitForAlpine(page);
      await page.click('[data-testid="sidebar-settings"]');
      await page.waitForSelector('[data-testid="settings-nav-lastfm"]');
      await page.click('[data-testid="settings-nav-lastfm"]');
      await page.waitForSelector('[data-testid="settings-section-lastfm"]');

      const statusText = page.locator('text=Connected as loadeduser').first();
      await expect(statusText).toBeVisible({ timeout: 5000 });
    });

    test('should load queue status when authenticated', async ({ page }) => {
      await page.setViewportSize({ width: 1624, height: 1057 });

      await page.route('**/lastfm/settings', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            enabled: true,
            authenticated: true,
            username: 'testuser',
            scrobble_threshold: 0.9,
          }),
        });
      });

      let queueStatusCalled = false;
      await page.route('**/lastfm/queue/status', async (route) => {
        queueStatusCalled = true;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            queued_scrobbles: 5,
          }),
        });
      });

      await page.goto('/');
      await waitForAlpine(page);
      await page.click('[data-testid="sidebar-settings"]');
      await page.waitForSelector('[data-testid="settings-nav-lastfm"]');
      await page.click('[data-testid="settings-nav-lastfm"]');
      await page.waitForSelector('[data-testid="settings-section-lastfm"]');

      expect(queueStatusCalled).toBe(true);
    });
  });

  test.describe('Queue Management', () => {
    test('should display queued scrobbles count', async ({ page }) => {
      await page.setViewportSize({ width: 1624, height: 1057 });

      await page.route('**/lastfm/settings', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            enabled: true,
            authenticated: true,
            username: 'testuser',
            scrobble_threshold: 90,
          }),
        });
      });

      await page.route('**/lastfm/queue/status', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            queued_scrobbles: 12,
          }),
        });
      });

      await page.goto('/');
      await waitForAlpine(page);
      await page.click('[data-testid="sidebar-settings"]');
      await page.waitForSelector('[data-testid="settings-nav-lastfm"]');
      await page.click('[data-testid="settings-nav-lastfm"]');
      await page.waitForSelector('[data-testid="settings-section-lastfm"]');

      const queueCount = page.locator('text=/12.*scrobbles queued/i');
      await expect(queueCount).toBeVisible();
    });

    test('should show retry button when scrobbles are queued', async ({ page }) => {
      await page.setViewportSize({ width: 1624, height: 1057 });

      await page.route('**/lastfm/settings', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            enabled: true,
            authenticated: true,
            username: 'testuser',
            scrobble_threshold: 90,
          }),
        });
      });

      await page.route('**/lastfm/queue/status', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            queued_scrobbles: 5,
          }),
        });
      });

      await page.goto('/');
      await waitForAlpine(page);
      await page.click('[data-testid="sidebar-settings"]');
      await page.waitForSelector('[data-testid="settings-nav-lastfm"]');
      await page.click('[data-testid="settings-nav-lastfm"]');
      await page.waitForSelector('[data-testid="settings-section-lastfm"]');

      const retryButton = page.locator('[data-testid="lastfm-retry-queue"]');
      await expect(retryButton).toBeVisible();
    });

    test('should hide retry button when queue is empty', async ({ page }) => {
      await page.setViewportSize({ width: 1624, height: 1057 });

      await page.route('**/lastfm/settings', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            enabled: true,
            authenticated: true,
            username: 'testuser',
            scrobble_threshold: 90,
          }),
        });
      });

      await page.route('**/lastfm/queue/status', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            queued_scrobbles: 0,
          }),
        });
      });

      await page.goto('/');
      await waitForAlpine(page);
      await page.click('[data-testid="sidebar-settings"]');
      await page.waitForSelector('[data-testid="settings-nav-lastfm"]');
      await page.click('[data-testid="settings-nav-lastfm"]');
      await page.waitForSelector('[data-testid="settings-section-lastfm"]');

      const retryButton = page.locator('[data-testid="lastfm-retry-queue"]');
      await expect(retryButton).not.toBeVisible();
    });

    test('should successfully retry queued scrobbles', async ({ page }) => {
      await page.setViewportSize({ width: 1624, height: 1057 });

      await page.route('**/lastfm/settings', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            enabled: true,
            authenticated: true,
            username: 'testuser',
            scrobble_threshold: 90,
          }),
        });
      });

      let queueStatusCallCount = 0;
      await page.route('**/lastfm/queue/status', async (route) => {
        queueStatusCallCount++;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            queued_scrobbles: queueStatusCallCount === 1 ? 8 : 3,
          }),
        });
      });

      await page.route('**/lastfm/queue/retry', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            status: 'Successfully retried 5 scrobbles',
            remaining_queued: 3,
          }),
        });
      });

      await page.goto('/');
      await waitForAlpine(page);
      await page.click('[data-testid="sidebar-settings"]');
      await page.waitForSelector('[data-testid="settings-nav-lastfm"]');
      await page.click('[data-testid="settings-nav-lastfm"]');
      await page.waitForSelector('[data-testid="settings-section-lastfm"]');

      await page.click('[data-testid="lastfm-retry-queue"]');

      const toast = page.locator('[data-testid="toast-container"] div').filter({ hasText: /remaining/i });
      await expect(toast).toBeVisible({ timeout: 3000 });

      const updatedCount = page.locator('text=/3.*scrobbles queued/i');
      await expect(updatedCount).toBeVisible({ timeout: 3000 });
    });

    test('should handle retry errors gracefully', async ({ page }) => {
      await page.setViewportSize({ width: 1624, height: 1057 });

      await page.route('**/lastfm/settings', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            enabled: true,
            authenticated: true,
            username: 'testuser',
            scrobble_threshold: 90,
          }),
        });
      });

      await page.route('**/lastfm/queue/status', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            queued_scrobbles: 5,
          }),
        });
      });

      await page.route('**/lastfm/queue/retry', async (route) => {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({
            detail: 'Failed to retry scrobbles',
          }),
        });
      });

      await page.goto('/');
      await waitForAlpine(page);
      await page.click('[data-testid="sidebar-settings"]');
      await page.waitForSelector('[data-testid="settings-nav-lastfm"]');
      await page.click('[data-testid="settings-nav-lastfm"]');
      await page.waitForSelector('[data-testid="settings-section-lastfm"]');

      const retryResponse = page.waitForResponse('**/lastfm/queue/retry');
      await page.click('[data-testid="lastfm-retry-queue"]');
      await retryResponse;

      const errorToast = page.locator('[data-testid="toast-container"] div').filter({ hasText: /failed to retry/i });
      await expect(errorToast).toBeVisible({ timeout: 2000 });
    });

    test('should update queue count dynamically', async ({ page }) => {
      await page.setViewportSize({ width: 1624, height: 1057 });

      await page.route('**/lastfm/settings', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            enabled: true,
            authenticated: true,
            username: 'testuser',
            scrobble_threshold: 90,
          }),
        });
      });

      let currentQueueCount = 10;
      await page.route('**/lastfm/queue/status', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            queued_scrobbles: currentQueueCount,
          }),
        });
      });

      await page.goto('/');
      await waitForAlpine(page);
      await page.click('[data-testid="sidebar-settings"]');
      await page.waitForSelector('[data-testid="settings-nav-lastfm"]');
      await page.click('[data-testid="settings-nav-lastfm"]');
      await page.waitForSelector('[data-testid="settings-section-lastfm"]');

      const initialCount = page.locator('text=/10.*scrobbles queued/i');
      await expect(initialCount).toBeVisible();

      currentQueueCount = 7;
      await page.evaluate(() => {
        const settingsComponent = window.Alpine.$data(document.querySelector('[x-data*="settingsView"]'));
        if (settingsComponent) {
          settingsComponent.lastfm.queueStatus = { queued_scrobbles: 7 };
        }
      });

      const updatedCount = page.locator('text=/7.*scrobbles queued/i');
      await expect(updatedCount).toBeVisible({ timeout: 3000 });
    });
  });

  test.describe('Loved Tracks Import', () => {
    test('should show import button when authenticated', async ({ page }) => {
      await page.setViewportSize({ width: 1624, height: 1057 });

      await page.route('**/lastfm/settings', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            enabled: true,
            authenticated: true,
            username: 'testuser',
            scrobble_threshold: 90,
          }),
        });
      });

      await page.goto('/');
      await waitForAlpine(page);
      await page.click('[data-testid="sidebar-settings"]');
      await page.waitForSelector('[data-testid="settings-nav-lastfm"]');
      await page.click('[data-testid="settings-nav-lastfm"]');
      await page.waitForSelector('[data-testid="settings-section-lastfm"]');

      const importButton = page.locator('[data-testid="lastfm-import-loved"]');
      await expect(importButton).toBeVisible();
    });

    test('should hide import button when not authenticated', async ({ page }) => {
      await page.setViewportSize({ width: 1624, height: 1057 });

      await page.route('**/lastfm/settings', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            enabled: false,
            authenticated: false,
            username: null,
            scrobble_threshold: 90,
          }),
        });
      });

      await page.goto('/');
      await waitForAlpine(page);
      await page.click('[data-testid="sidebar-settings"]');
      await page.waitForSelector('[data-testid="settings-nav-lastfm"]');
      await page.click('[data-testid="settings-nav-lastfm"]');
      await page.waitForSelector('[data-testid="settings-section-lastfm"]');

      const importButton = page.locator('[data-testid="lastfm-import-loved"]');
      await expect(importButton).not.toBeVisible();
    });

    test('should successfully import loved tracks', async ({ page }) => {
      await page.setViewportSize({ width: 1624, height: 1057 });

      await page.route('**/lastfm/settings', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            enabled: true,
            authenticated: true,
            username: 'testuser',
            scrobble_threshold: 90,
          }),
        });
      });

      await page.route('**/lastfm/queue/status', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            queued_scrobbles: 0,
          }),
        });
      });

      let importCalled = false;
      await page.route('**/lastfm/import-loved-tracks', async (route) => {
        importCalled = true;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            status: 'success',
            total_loved_tracks: 150,
            imported_count: 120,
            message: 'Imported 120 tracks, 10 already favorited, 20 not in library',
          }),
        });
      });

      await page.goto('/');
      await waitForAlpine(page);
      await page.click('[data-testid="sidebar-settings"]');
      await page.waitForSelector('[data-testid="settings-nav-lastfm"]');
      await page.click('[data-testid="settings-nav-lastfm"]');
      await page.waitForSelector('[data-testid="settings-section-lastfm"]');

      await page.click('[data-testid="lastfm-import-loved"]');
      await expect.poll(() => importCalled, { timeout: 5000 }).toBe(true);

      const successToast = page.locator('[data-testid="toast-container"] div').filter({ hasText: /imported.*120/i });
      await expect(successToast).toBeVisible({ timeout: 5000 });
    });

    test('should show loading state during import', async ({ page }) => {
      await page.setViewportSize({ width: 1624, height: 1057 });

      await page.route('**/lastfm/settings', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            enabled: true,
            authenticated: true,
            username: 'testuser',
            scrobble_threshold: 90,
          }),
        });
      });

      await page.route('**/lastfm/queue/status', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            queued_scrobbles: 0,
          }),
        });
      });

      let resolveImport;
      const importPending = new Promise((resolve) => { resolveImport = resolve; });

      await page.route('**/lastfm/import-loved-tracks', async (route) => {
        await importPending;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            status: 'success',
            total_loved_tracks: 50,
            imported_count: 45,
            message: 'Imported 45 tracks',
          }),
        });
      });

      await page.goto('/');
      await waitForAlpine(page);
      await page.click('[data-testid="sidebar-settings"]');
      await page.waitForSelector('[data-testid="settings-nav-lastfm"]');
      await page.click('[data-testid="settings-nav-lastfm"]');
      await page.waitForSelector('[data-testid="settings-section-lastfm"]');

      await page.click('[data-testid="lastfm-import-loved"]');

      const importingText = page.locator('text=/importing/i');
      await expect(importingText).toBeVisible({ timeout: 1000 });

      resolveImport();

      await expect(importingText).not.toBeVisible({ timeout: 3000 });
    });

    test('should handle import errors gracefully', async ({ page }) => {
      await page.setViewportSize({ width: 1624, height: 1057 });

      await page.route('**/lastfm/settings', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            enabled: true,
            authenticated: true,
            username: 'testuser',
            scrobble_threshold: 90,
          }),
        });
      });

      await page.route('**/lastfm/queue/status', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            queued_scrobbles: 0,
          }),
        });
      });

      await page.route('**/lastfm/import-loved-tracks', async (route) => {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({
            detail: 'Failed to fetch loved tracks from Last.fm',
          }),
        });
      });

      await page.goto('/');
      await waitForAlpine(page);
      await page.click('[data-testid="sidebar-settings"]');
      await page.waitForSelector('[data-testid="settings-nav-lastfm"]');
      await page.click('[data-testid="settings-nav-lastfm"]');
      await page.waitForSelector('[data-testid="settings-section-lastfm"]');

      const importResponse = page.waitForResponse('**/lastfm/import-loved-tracks');
      await page.click('[data-testid="lastfm-import-loved"]');
      await importResponse;

      const errorToast = page.locator('[data-testid="toast-container"] div').filter({ hasText: /failed.*import/i });
      await expect(errorToast).toBeVisible({ timeout: 2000 });
    });

    test('should require authentication for import', async ({ page }) => {
      await page.setViewportSize({ width: 1624, height: 1057 });

      await page.route('**/lastfm/settings', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            enabled: true,
            authenticated: true,
            username: 'testuser',
            scrobble_threshold: 90,
          }),
        });
      });

      await page.route('**/lastfm/queue/status', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            queued_scrobbles: 0,
          }),
        });
      });

      await page.route('**/lastfm/import-loved-tracks', async (route) => {
        await route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({
            detail: 'Not authenticated with Last.fm',
          }),
        });
      });

      await page.goto('/');
      await waitForAlpine(page);
      await page.click('[data-testid="sidebar-settings"]');
      await page.waitForSelector('[data-testid="settings-nav-lastfm"]');
      await page.click('[data-testid="settings-nav-lastfm"]');
      await page.waitForSelector('[data-testid="settings-section-lastfm"]');

      await page.click('[data-testid="lastfm-import-loved"]');

      const authError = page.locator('[data-testid="toast-container"] div').filter({ hasText: /Failed to import loved tracks/i });
      await expect(authError).toBeVisible({ timeout: 3000 });
    });

    test('should display import statistics', async ({ page }) => {
      await page.setViewportSize({ width: 1624, height: 1057 });

      await page.route('**/lastfm/settings', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            enabled: true,
            authenticated: true,
            username: 'testuser',
            scrobble_threshold: 90,
          }),
        });
      });

      await page.route('**/lastfm/queue/status', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            queued_scrobbles: 0,
          }),
        });
      });

      await page.route('**/lastfm/import-loved-tracks', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            status: 'success',
            total_loved_tracks: 200,
            imported_count: 150,
            message: 'Imported 150 tracks, 30 already favorited, 20 not in library',
          }),
        });
      });

      await page.goto('/');
      await waitForAlpine(page);
      await page.click('[data-testid="sidebar-settings"]');
      await page.waitForSelector('[data-testid="settings-nav-lastfm"]');
      await page.click('[data-testid="settings-nav-lastfm"]');
      await page.waitForSelector('[data-testid="settings-section-lastfm"]');

      await page.click('[data-testid="lastfm-import-loved"]');

      const successToast = page.locator('[data-testid="toast-container"] div').filter({ hasText: /imported.*150.*loved tracks/i });
      await expect(successToast).toBeVisible({ timeout: 5000 });
    });
  });
});
