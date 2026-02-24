import { expect, test } from '@playwright/test';
import { waitForAlpine } from './fixtures/helpers.js';
import { createLibraryState, setupLibraryMocks } from './fixtures/mock-library.js';

/**
 * Library View Mode Parity Tests (task-227)
 *
 * Tests that track selection, context menus, and play actions work consistently
 * across all library view modes (list, grid, compact).
 *
 * Note: Currently the UI renders the same list-based layout regardless of mode.
 * These tests verify that interactions work correctly when the mode is changed,
 * ensuring parity as different views are implemented.
 */
test.describe('Library View Mode Parity (task-227)', () => {
  const viewModes = ['list', 'grid', 'compact'];

  for (const mode of viewModes) {
    test.describe(`${mode} view`, () => {
      test.beforeEach(async ({ page }) => {
        const libraryState = createLibraryState();
        await setupLibraryMocks(page, libraryState);
        await page.goto('/');
        await waitForAlpine(page);

        // AC #1, #5, #6: Set view mode
        await page.evaluate((viewMode) => {
          window.Alpine.store('ui').setLibraryViewMode(viewMode);
        }, mode);
        await page.waitForTimeout(100);
      });

      test('view mode should be set correctly', async ({ page }) => {
        const currentMode = await page.evaluate(() => window.Alpine.store('ui').libraryViewMode);
        expect(currentMode).toBe(mode);
      });

      test('should allow track selection via click', async ({ page }) => {
        // AC #2: Select track and verify selection state
        await page.waitForSelector('[data-track-id]', { state: 'visible' });

        const firstTrackId = await page.locator('[data-track-id]').first().getAttribute(
          'data-track-id',
        );

        // Click first track
        await page.locator('[data-track-id]').first().click();

        // Verify selection state in libraryBrowser component
        const isSelected = await page.evaluate((trackId) => {
          const browserEl = document.querySelector('[x-data="libraryBrowser"]');
          if (!browserEl) return false;
          const data = window.Alpine.$data(browserEl);
          return data.selectedTracks?.has(parseInt(trackId));
        }, firstTrackId);

        expect(isSelected).toBe(true);
      });

      test('should show context menu on right-click', async ({ page }) => {
        // AC #3: Right-click and verify context menu appears
        await page.waitForSelector('[data-track-id]', { state: 'visible' });

        // Right-click first track
        await page.locator('[data-track-id]').first().click({ button: 'right' });

        // Verify context menu appears
        await page.waitForSelector('[data-testid="track-context-menu"]', {
          state: 'visible',
          timeout: 3000,
        });

        // Verify expected menu items are present
        // Note: Some labels are dynamic (e.g., "Add Track to Queue", "Edit Metadata...")
        const playNowItem = page.locator(
          '[data-testid="track-context-menu"] .context-menu-item:has-text("Play Now")',
        );
        const addToQueueItem = page.locator(
          '[data-testid="track-context-menu"] .context-menu-item:has-text("to Queue")',
        );
        const editMetadataItem = page.locator(
          '[data-testid="track-context-menu"] .context-menu-item:has-text("Edit Metadata")',
        );

        await expect(playNowItem).toBeVisible();
        await expect(addToQueueItem).toBeVisible();
        await expect(editMetadataItem).toBeVisible();

        // Dismiss menu
        await page.keyboard.press('Escape');
      });

      test('should add track to queue on double-click', async ({ page }) => {
        // AC #4: Double-click track and verify playback/queue action
        await page.waitForSelector('[data-track-id]', { state: 'visible' });

        // Verify queue is empty initially
        const initialQueueLength = await page.evaluate(() =>
          window.Alpine.store('queue').items.length
        );
        expect(initialQueueLength).toBe(0);

        // Double-click first track
        await page.locator('[data-track-id]').first().dblclick();

        // Wait for queue to update
        await page.waitForFunction(() => window.Alpine.store('queue').items.length > 0, {
          timeout: 3000,
        });

        // Verify queue has tracks
        const queueData = await page.evaluate(() => {
          const queue = window.Alpine.store('queue');
          return {
            length: queue.items.length,
            hasCurrentTrack: queue.currentTrack !== null,
          };
        });

        expect(queueData.length).toBeGreaterThan(0);
      });

      test('should support multi-select with Shift+click', async ({ page }) => {
        await page.waitForSelector('[data-track-id]', { state: 'visible' });

        // Ensure enough tracks
        const trackCount = await page.locator('[data-track-id]').count();
        if (trackCount < 3) {
          test.skip();
          return;
        }

        // Click first track
        await page.locator('[data-track-id]').first().click();

        // Shift+click third track
        await page.keyboard.down('Shift');
        await page.locator('[data-track-id]').nth(2).click();
        await page.keyboard.up('Shift');

        // Verify multiple tracks selected
        const selectedCount = await page.evaluate(() => {
          const browserEl = document.querySelector('[x-data="libraryBrowser"]');
          if (!browserEl) return 0;
          const data = window.Alpine.$data(browserEl);
          return data.selectedTracks?.size || 0;
        });

        expect(selectedCount).toBeGreaterThanOrEqual(3);
      });

      test('should support multi-select with Ctrl/Cmd+click', async ({ page }) => {
        await page.waitForSelector('[data-track-id]', { state: 'visible' });

        // Ensure enough tracks
        const trackCount = await page.locator('[data-track-id]').count();
        if (trackCount < 3) {
          test.skip();
          return;
        }

        const isMac = process.platform === 'darwin';
        const modifier = isMac ? 'Meta' : 'Control';

        // Click first track
        await page.locator('[data-track-id]').first().click();

        // Ctrl/Cmd+click third track (non-contiguous)
        await page.keyboard.down(modifier);
        await page.locator('[data-track-id]').nth(2).click();
        await page.keyboard.up(modifier);

        // Verify 2 tracks selected (first and third, not second)
        const selectedCount = await page.evaluate(() => {
          const browserEl = document.querySelector('[x-data="libraryBrowser"]');
          if (!browserEl) return 0;
          const data = window.Alpine.$data(browserEl);
          return data.selectedTracks?.size || 0;
        });

        expect(selectedCount).toBe(2);
      });

      test('selection should persist after view mode change', async ({ page }) => {
        await page.waitForSelector('[data-track-id]', { state: 'visible' });

        const firstTrackId = await page.locator('[data-track-id]').first().getAttribute(
          'data-track-id',
        );

        // Select a track
        await page.locator('[data-track-id]').first().click();

        // Verify selected
        let isSelected = await page.evaluate((trackId) => {
          const browserEl = document.querySelector('[x-data="libraryBrowser"]');
          if (!browserEl) return false;
          const data = window.Alpine.$data(browserEl);
          return data.selectedTracks?.has(parseInt(trackId));
        }, firstTrackId);
        expect(isSelected).toBe(true);

        // Change to a different mode
        const nextMode = mode === 'list' ? 'grid' : (mode === 'grid' ? 'compact' : 'list');
        await page.evaluate((m) => {
          window.Alpine.store('ui').setLibraryViewMode(m);
        }, nextMode);
        await page.waitForTimeout(100);

        // Verify selection persisted
        isSelected = await page.evaluate((trackId) => {
          const browserEl = document.querySelector('[x-data="libraryBrowser"]');
          if (!browserEl) return false;
          const data = window.Alpine.$data(browserEl);
          return data.selectedTracks?.has(parseInt(trackId));
        }, firstTrackId);
        expect(isSelected).toBe(true);
      });
    });
  }

  // Additional cross-mode tests
  test.describe('cross-mode behavior', () => {
    test.beforeEach(async ({ page }) => {
      const libraryState = createLibraryState();
      await setupLibraryMocks(page, libraryState);
      await page.goto('/');
      await waitForAlpine(page);
    });

    test('should cycle through all view modes', async ({ page }) => {
      for (const mode of viewModes) {
        await page.evaluate((m) => {
          window.Alpine.store('ui').setLibraryViewMode(m);
        }, mode);

        const currentMode = await page.evaluate(() => window.Alpine.store('ui').libraryViewMode);
        expect(currentMode).toBe(mode);
      }
    });

    test('context menu should work after switching view modes', async ({ page }) => {
      await page.waitForSelector('[data-track-id]', { state: 'visible' });

      // Start in list mode
      await page.evaluate(() => {
        window.Alpine.store('ui').setLibraryViewMode('list');
      });

      // Switch to grid mode
      await page.evaluate(() => {
        window.Alpine.store('ui').setLibraryViewMode('grid');
      });
      await page.waitForTimeout(100);

      // Right-click should still work
      await page.locator('[data-track-id]').first().click({ button: 'right' });
      await page.waitForSelector('[data-testid="track-context-menu"]', {
        state: 'visible',
        timeout: 3000,
      });

      const playNowItem = page.locator(
        '[data-testid="track-context-menu"] .context-menu-item:has-text("Play Now")',
      );
      await expect(playNowItem).toBeVisible();

      await page.keyboard.press('Escape');

      // Switch to compact mode
      await page.evaluate(() => {
        window.Alpine.store('ui').setLibraryViewMode('compact');
      });
      await page.waitForTimeout(100);

      // Right-click should still work
      await page.locator('[data-track-id]').first().click({ button: 'right' });
      await page.waitForSelector('[data-testid="track-context-menu"]', {
        state: 'visible',
        timeout: 3000,
      });

      await expect(playNowItem).toBeVisible();
    });

    test('double-click should work after switching view modes', async ({ page }) => {
      await page.waitForSelector('[data-track-id]', { state: 'visible' });

      // Start in list, switch to compact
      await page.evaluate(() => {
        window.Alpine.store('ui').setLibraryViewMode('list');
      });
      await page.evaluate(() => {
        window.Alpine.store('ui').setLibraryViewMode('compact');
      });
      await page.waitForTimeout(100);

      // Double-click should still add to queue
      await page.locator('[data-track-id]').first().dblclick();

      await page.waitForFunction(() => window.Alpine.store('queue').items.length > 0, {
        timeout: 3000,
      });

      const queueLength = await page.evaluate(() => window.Alpine.store('queue').items.length);
      expect(queueLength).toBeGreaterThan(0);
    });
  });
});
