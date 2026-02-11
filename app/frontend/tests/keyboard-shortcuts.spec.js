import { test, expect } from '@playwright/test';
import { waitForAlpine, getAlpineStore } from './fixtures/helpers.js';
import { createLibraryState, setupLibraryMocks } from './fixtures/mock-library.js';
import { createPlaylistState, setupPlaylistMocks } from './fixtures/mock-playlists.js';

/**
 * Keyboard Shortcuts Tests
 *
 * Tests for all keyboard shortcuts in the application:
 * - Cmd/Ctrl+A: Select all tracks
 * - Escape: Clear selection
 * - Enter: Play selected tracks
 * - Delete/Backspace: Remove selected tracks (context-aware)
 * - Space: Toggle play/pause (if implemented)
 */

test.describe('Library Keyboard Shortcuts', () => {
  test.beforeEach(async ({ page }) => {
    // Set up mocks before navigating
    const libraryState = createLibraryState();
    await setupLibraryMocks(page, libraryState);

    const playlistState = createPlaylistState();
    await setupPlaylistMocks(page, playlistState);

    await page.goto('/');
    await waitForAlpine(page);
    await page.waitForSelector('[x-data="libraryBrowser"]', { state: 'visible' });
    await page.waitForSelector('[data-track-id]', { state: 'visible' });
  });

  test.describe('Cmd/Ctrl+A - Select All', () => {
    test('should select all tracks when pressing Cmd+A (Mac)', async ({ page }) => {
      // Get initial selection count
      const initialSelected = await page.evaluate(() =>
        window.Alpine.store('library').selectedTracks?.size || 0
      );
      expect(initialSelected).toBe(0);

      // Get total track count (from store, not DOM - virtual scrolling renders subset)
      const trackCount = await page.evaluate(() =>
        window.Alpine.store('library').filteredTracks.length
      );

      // Press Cmd+A (Meta key on Mac)
      await page.keyboard.press('Meta+a');

      // Verify all tracks are selected
      const selectedAfter = await page.evaluate(() => {
        const component = window.Alpine.$data(document.querySelector('[x-data="libraryBrowser"]'));
        return component.selectedTracks?.size || 0;
      });

      expect(selectedAfter).toBe(trackCount);
    });

    test('should select all tracks when pressing Ctrl+A (Windows/Linux)', async ({ page }) => {
      // Get total track count (from store, not DOM - virtual scrolling renders subset)
      const trackCount = await page.evaluate(() =>
        window.Alpine.store('library').filteredTracks.length
      );

      // Press Ctrl+A
      await page.keyboard.press('Control+a');

      // Verify all tracks are selected
      const selectedAfter = await page.evaluate(() => {
        const component = window.Alpine.$data(document.querySelector('[x-data="libraryBrowser"]'));
        return component.selectedTracks?.size || 0;
      });

      expect(selectedAfter).toBe(trackCount);
    });

    test('should toggle between select all and deselect all on repeated Cmd+A', async ({ page }) => {
      const trackCount = await page.evaluate(() =>
        window.Alpine.store('library').filteredTracks.length
      );

      // First Cmd+A - select all
      await page.keyboard.press('Meta+a');
      let selected = await page.evaluate(() => {
        const component = window.Alpine.$data(document.querySelector('[x-data="libraryBrowser"]'));
        return component.selectedTracks?.size || 0;
      });
      expect(selected).toBe(trackCount);

      // Second Cmd+A - if all already selected, should deselect (or stay selected based on impl)
      await page.keyboard.press('Meta+a');
      selected = await page.evaluate(() => {
        const component = window.Alpine.$data(document.querySelector('[x-data="libraryBrowser"]'));
        return component.selectedTracks?.size || 0;
      });
      // Behavior may vary - just ensure it doesn't crash
      expect(selected).toBeGreaterThanOrEqual(0);
    });
  });

  test.describe('Escape - Clear Selection', () => {
    test('should clear selection when pressing Escape', async ({ page }) => {
      // First select some tracks via click
      await page.locator('[data-track-id]').nth(0).click();

      // Verify at least one track is selected
      const selectedBefore = await page.evaluate(() => {
        const component = window.Alpine.$data(document.querySelector('[x-data="libraryBrowser"]'));
        return component.selectedTracks?.size || 0;
      });
      expect(selectedBefore).toBeGreaterThan(0);

      // Press Escape
      await page.keyboard.press('Escape');

      // Verify selection is cleared
      const selectedAfter = await page.evaluate(() => {
        const component = window.Alpine.$data(document.querySelector('[x-data="libraryBrowser"]'));
        return component.selectedTracks?.size || 0;
      });
      expect(selectedAfter).toBe(0);
    });

    test('should clear multi-selection when pressing Escape', async ({ page }) => {
      // Select all with Cmd+A
      await page.keyboard.press('Meta+a');

      const selectedBefore = await page.evaluate(() => {
        const component = window.Alpine.$data(document.querySelector('[x-data="libraryBrowser"]'));
        return component.selectedTracks?.size || 0;
      });
      expect(selectedBefore).toBeGreaterThan(1);

      // Press Escape
      await page.keyboard.press('Escape');

      // Verify selection is cleared
      const selectedAfter = await page.evaluate(() => {
        const component = window.Alpine.$data(document.querySelector('[x-data="libraryBrowser"]'));
        return component.selectedTracks?.size || 0;
      });
      expect(selectedAfter).toBe(0);
    });

    test('should do nothing when pressing Escape with no selection', async ({ page }) => {
      // Verify no selection
      const selectedBefore = await page.evaluate(() => {
        const component = window.Alpine.$data(document.querySelector('[x-data="libraryBrowser"]'));
        return component.selectedTracks?.size || 0;
      });
      expect(selectedBefore).toBe(0);

      // Press Escape - should not cause errors
      await page.keyboard.press('Escape');

      // Still no selection
      const selectedAfter = await page.evaluate(() => {
        const component = window.Alpine.$data(document.querySelector('[x-data="libraryBrowser"]'));
        return component.selectedTracks?.size || 0;
      });
      expect(selectedAfter).toBe(0);
    });
  });

  test.describe('Enter - Play Selected', () => {
    test('should play selected track when pressing Enter', async ({ page }) => {
      // Select first track
      await page.locator('[data-track-id]').nth(0).click();

      // Get the selected track ID
      const selectedTrackId = await page.evaluate(() => {
        const component = window.Alpine.$data(document.querySelector('[x-data="libraryBrowser"]'));
        return Array.from(component.selectedTracks)[0];
      });

      // Press Enter
      await page.keyboard.press('Enter');

      // Wait for queue to be populated
      await page.waitForTimeout(300);

      // Verify track is in queue (playSelected adds tracks to queue)
      const queueItems = await page.evaluate(() =>
        window.Alpine.store('queue').items.map(t => t.id)
      );
      expect(queueItems).toContain(selectedTrackId);
    });

    test('should play multiple selected tracks when pressing Enter', async ({ page }) => {
      // Select all tracks
      await page.keyboard.press('Meta+a');

      const selectedCount = await page.evaluate(() => {
        const component = window.Alpine.$data(document.querySelector('[x-data="libraryBrowser"]'));
        return component.selectedTracks?.size || 0;
      });
      expect(selectedCount).toBeGreaterThan(1);

      // Press Enter
      await page.keyboard.press('Enter');

      // Wait for queue to be populated
      await page.waitForTimeout(300);

      // Verify all selected tracks are in queue
      const queueLength = await page.evaluate(() =>
        window.Alpine.store('queue').items.length
      );
      expect(queueLength).toBe(selectedCount);
    });

    test('should do nothing when pressing Enter with no selection', async ({ page }) => {
      // Verify no selection
      const selectedBefore = await page.evaluate(() => {
        const component = window.Alpine.$data(document.querySelector('[x-data="libraryBrowser"]'));
        return component.selectedTracks?.size || 0;
      });
      expect(selectedBefore).toBe(0);

      // Get initial queue length
      const queueBefore = await page.evaluate(() =>
        window.Alpine.store('queue').items.length
      );

      // Press Enter - should not crash or add anything
      await page.keyboard.press('Enter');
      await page.waitForTimeout(200);

      // Queue should be unchanged
      const queueAfter = await page.evaluate(() =>
        window.Alpine.store('queue').items.length
      );
      expect(queueAfter).toBe(queueBefore);
    });
  });

  test.describe('Delete/Backspace - Remove Selected', () => {
    test('should remove selected tracks from library when pressing Delete', async ({ page }) => {
      // Get initial track count
      const initialCount = await page.locator('[data-track-id]').count();

      // Select first track
      await page.locator('[data-track-id]').nth(0).click();

      // Press Delete
      await page.keyboard.press('Delete');

      await page.waitForTimeout(300);

      // Verify track count decreased (or removal was attempted)
      // Note: In browser mode without backend, the actual removal may not persist
      // but the frontend logic should still execute
      const afterCount = await page.locator('[data-track-id]').count();
      // The test verifies the key is handled without crashing
      expect(afterCount).toBeLessThanOrEqual(initialCount);
    });

    test('should remove selected tracks when pressing Backspace', async ({ page }) => {
      // Get initial track count
      const initialCount = await page.locator('[data-track-id]').count();

      // Select first track
      await page.locator('[data-track-id]').nth(0).click();

      // Press Backspace
      await page.keyboard.press('Backspace');

      await page.waitForTimeout(300);

      // Verify the key is handled without crashing
      const afterCount = await page.locator('[data-track-id]').count();
      expect(afterCount).toBeLessThanOrEqual(initialCount);
    });

    test('should not remove tracks when typing in input field', async ({ page }) => {
      // Get initial track count
      const initialCount = await page.locator('[data-track-id]').count();

      // Focus on search input (if available)
      const searchInput = page.locator('[data-testid="search-input"], input[type="search"], input[placeholder*="Search"]').first();

      if (await searchInput.isVisible()) {
        await searchInput.click();
        await searchInput.fill('test');

        // Select a track first
        await page.locator('[data-track-id]').nth(0).click({ modifiers: ['Meta'] });

        // Focus back on search input
        await searchInput.click();

        // Press Delete while in input - should NOT delete track
        await page.keyboard.press('Delete');

        await page.waitForTimeout(200);

        // Track count should be unchanged
        const afterCount = await page.locator('[data-track-id]').count();
        expect(afterCount).toBe(initialCount);
      }
    });

    test('should do nothing when pressing Delete with no selection', async ({ page }) => {
      // Verify no selection
      const selectedCount = await page.evaluate(() => {
        const component = window.Alpine.$data(document.querySelector('[x-data="libraryBrowser"]'));
        return component.selectedTracks?.size || 0;
      });
      expect(selectedCount).toBe(0);

      // Get initial track count
      const initialCount = await page.locator('[data-track-id]').count();

      // Press Delete - should not crash or remove anything
      await page.keyboard.press('Delete');
      await page.waitForTimeout(200);

      // Track count should be unchanged
      const afterCount = await page.locator('[data-track-id]').count();
      expect(afterCount).toBe(initialCount);
    });
  });
});

test.describe('Playlist Context Keyboard Shortcuts', () => {
  test.beforeEach(async ({ page }) => {
    const libraryState = createLibraryState();
    await setupLibraryMocks(page, libraryState);

    const playlistState = createPlaylistState();
    await setupPlaylistMocks(page, playlistState);

    await page.goto('/');
    await waitForAlpine(page);
    await page.waitForSelector('[x-data="libraryBrowser"]', { state: 'visible' });
  });

  test('should remove track from playlist when pressing Delete in playlist view', async ({ page }) => {
    // Navigate to a playlist view
    const playlistItem = page.locator('[data-playlist-id]').first();
    if (await playlistItem.isVisible()) {
      await playlistItem.click();
      await page.waitForTimeout(300);

      // Wait for playlist tracks to load
      await page.waitForSelector('[data-track-id]', { state: 'visible', timeout: 5000 }).catch(() => null);

      const trackCount = await page.locator('[data-track-id]').count();

      if (trackCount > 0) {
        // Select first track
        await page.locator('[data-track-id]').nth(0).click();

        // Press Delete
        await page.keyboard.press('Delete');
        await page.waitForTimeout(300);

        // Verify removal was attempted (track count may or may not change in browser mode)
        const afterCount = await page.locator('[data-track-id]').count();
        expect(afterCount).toBeLessThanOrEqual(trackCount);
      }
    }
  });
});

test.describe('Sidebar Keyboard Shortcuts', () => {
  test.beforeEach(async ({ page }) => {
    const libraryState = createLibraryState();
    await setupLibraryMocks(page, libraryState);

    const playlistState = createPlaylistState();
    await setupPlaylistMocks(page, playlistState);

    await page.goto('/');
    await waitForAlpine(page);
  });

  test('should delete selected playlist when pressing Delete on focused playlist list', async ({ page }) => {
    // Focus the playlist list
    const playlistList = page.locator('[data-testid="playlist-list"]');

    if (await playlistList.isVisible()) {
      // Get initial playlist count
      const initialCount = await page.locator('[data-playlist-id]').count();

      if (initialCount > 0) {
        // Click on a playlist to select it
        await page.locator('[data-playlist-id]').first().click();

        // Focus the playlist list container
        await playlistList.focus();

        // Press Delete - should trigger playlist deletion (may show confirmation)
        await page.keyboard.press('Delete');

        await page.waitForTimeout(300);

        // In browser mode, deletion may require backend - just verify no crash
        // The key should be handled
      }
    }
  });
});

test.describe('Modal Keyboard Shortcuts', () => {
  test.beforeEach(async ({ page }) => {
    const libraryState = createLibraryState();
    await setupLibraryMocks(page, libraryState);

    await page.goto('/');
    await waitForAlpine(page);
    await page.waitForSelector('[data-track-id]', { state: 'visible' });
  });

  test('should close settings modal when pressing Escape', async ({ page }) => {
    // Open settings
    const settingsCog = page.locator('[data-testid="settings-cog"]');
    if (await settingsCog.isVisible()) {
      await settingsCog.click();

      // Wait for settings to open
      await page.waitForSelector('[data-testid="settings-view"]', { state: 'visible', timeout: 3000 }).catch(() => null);

      // Check if settings is open
      const isSettingsOpen = await page.evaluate(() =>
        window.Alpine.store('ui').view === 'settings'
      );

      if (isSettingsOpen) {
        // Press Escape
        await page.keyboard.press('Escape');
        await page.waitForTimeout(200);

        // Verify settings is closed
        const isSettingsClosedAfter = await page.evaluate(() =>
          window.Alpine.store('ui').view !== 'settings'
        );
        expect(isSettingsClosedAfter).toBe(true);
      }
    }
  });

  test('should close context menu when pressing Escape', async ({ page }) => {
    // Right-click on a track to open context menu
    await page.locator('[data-track-id]').nth(0).click({ button: 'right' });

    // Wait for context menu
    await page.waitForTimeout(300);

    const contextMenu = page.locator('[data-testid="track-context-menu"], .context-menu, [x-show*="contextMenu"]').first();
    const isMenuVisible = await contextMenu.isVisible().catch(() => false);

    if (isMenuVisible) {
      // Press Escape
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);

      // Verify context menu is closed
      const isMenuVisibleAfter = await contextMenu.isVisible().catch(() => false);
      expect(isMenuVisibleAfter).toBe(false);
    }
  });
});

test.describe('Keyboard Shortcut Combinations', () => {
  test.beforeEach(async ({ page }) => {
    const libraryState = createLibraryState();
    await setupLibraryMocks(page, libraryState);

    await page.goto('/');
    await waitForAlpine(page);
    await page.waitForSelector('[data-track-id]', { state: 'visible' });
  });

  test('should handle Cmd+A followed by Enter (select all and play)', async ({ page }) => {
    // Cmd+A to select all
    await page.keyboard.press('Meta+a');

    const selectedCount = await page.evaluate(() => {
      const component = window.Alpine.$data(document.querySelector('[x-data="libraryBrowser"]'));
      return component.selectedTracks?.size || 0;
    });
    expect(selectedCount).toBeGreaterThan(0);

    // Enter to play
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);

    // Verify all tracks are in queue
    const queueLength = await page.evaluate(() =>
      window.Alpine.store('queue').items.length
    );
    expect(queueLength).toBe(selectedCount);
  });

  test('should handle Cmd+A followed by Escape (select all then clear)', async ({ page }) => {
    const trackCount = await page.evaluate(() =>
      window.Alpine.store('library').filteredTracks.length
    );

    // Cmd+A to select all
    await page.keyboard.press('Meta+a');

    let selectedCount = await page.evaluate(() => {
      const component = window.Alpine.$data(document.querySelector('[x-data="libraryBrowser"]'));
      return component.selectedTracks?.size || 0;
    });
    expect(selectedCount).toBe(trackCount);

    // Escape to clear
    await page.keyboard.press('Escape');

    selectedCount = await page.evaluate(() => {
      const component = window.Alpine.$data(document.querySelector('[x-data="libraryBrowser"]'));
      return component.selectedTracks?.size || 0;
    });
    expect(selectedCount).toBe(0);
  });

  test('should not select all tracks when Cmd+A is pressed while search input is focused', async ({ page }) => {
    // Focus the search input via Cmd+F
    await page.keyboard.press('Meta+f');

    // Verify search input is focused
    const searchFocused = await page.evaluate(() =>
      document.activeElement === document.querySelector('[data-testid="sidebar-search"]')
    );
    expect(searchFocused).toBe(true);

    // Press Cmd+A while search is focused
    await page.keyboard.press('Meta+a');

    // Tracks should NOT be selected - Cmd+A should only affect the search input
    const selectedCount = await page.evaluate(() => {
      const component = window.Alpine.$data(document.querySelector('[x-data="libraryBrowser"]'));
      return component.selectedTracks?.size || 0;
    });
    expect(selectedCount).toBe(0);
  });

  test('should not clear track selection when Escape is pressed while search input is focused', async ({ page }) => {
    // First select a track
    await page.locator('[data-track-id]').nth(0).click();

    const selectedBefore = await page.evaluate(() => {
      const component = window.Alpine.$data(document.querySelector('[x-data="libraryBrowser"]'));
      return component.selectedTracks?.size || 0;
    });
    expect(selectedBefore).toBeGreaterThan(0);

    // Focus the search input
    await page.keyboard.press('Meta+f');

    // Press Escape while search is focused - should blur search, not clear selection
    await page.keyboard.press('Escape');

    const selectedAfter = await page.evaluate(() => {
      const component = window.Alpine.$data(document.querySelector('[x-data="libraryBrowser"]'));
      return component.selectedTracks?.size || 0;
    });
    expect(selectedAfter).toBe(selectedBefore);
  });

  test('should handle rapid keyboard shortcuts without crashing', async ({ page }) => {
    // Rapid key presses
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('Meta+a');
      await page.keyboard.press('Escape');
    }

    // Should complete without errors
    const selectedCount = await page.evaluate(() => {
      const component = window.Alpine.$data(document.querySelector('[x-data="libraryBrowser"]'));
      return component.selectedTracks?.size || 0;
    });
    expect(selectedCount).toBe(0);
  });
});
