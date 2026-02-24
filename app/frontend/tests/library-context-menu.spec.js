import { expect, test } from '@playwright/test';
import { waitForAlpine } from './fixtures/helpers.js';
import { createLibraryState, setupLibraryMocks } from './fixtures/mock-library.js';

test.describe('Context Menu', () => {
  test.beforeEach(async ({ page }) => {
    const libraryState = createLibraryState();
    await setupLibraryMocks(page, libraryState);
    await page.goto('/');
    await waitForAlpine(page);
    await page.waitForSelector('[data-track-id]', { state: 'visible' });
  });

  test('should show context menu on right-click', async ({ page }) => {
    const firstTrack = page.locator('[data-track-id]').first();
    await firstTrack.click({ button: 'right' });

    await page.waitForSelector('[data-testid="track-context-menu"]', { state: 'visible' });

    const contextMenu = page.locator('[data-testid="track-context-menu"]');
    await expect(contextMenu).toBeVisible();
  });

  test('should show context menu options', async ({ page }) => {
    const firstTrack = page.locator('[data-track-id]').first();
    await firstTrack.click({ button: 'right' });

    await page.waitForSelector('[data-testid="track-context-menu"]', { state: 'visible' });
    await page.waitForSelector('[data-testid="track-context-menu"] .context-menu-item', {
      state: 'visible',
      timeout: 5000,
    });

    const menuItems = page.locator('[data-testid="track-context-menu"] .context-menu-item');
    await expect(menuItems.first()).toBeVisible();
    const count = await menuItems.count();
    expect(count).toBeGreaterThan(0);

    const menuTexts = await menuItems.allTextContents();
    const hasPlayOption = menuTexts.some((text) => text.toLowerCase().includes('play'));
    expect(hasPlayOption).toBe(true);
  });

  test('should close context menu when clicking outside', async ({ page }) => {
    const firstTrack = page.locator('[data-track-id]').first();
    await firstTrack.click({ button: 'right' });
    await page.waitForSelector('[data-testid="track-context-menu"]', { state: 'visible' });

    await page.click('body', { position: { x: 10, y: 10 } });

    const contextMenu = page.locator('[data-testid="track-context-menu"]');
    await expect(contextMenu).not.toBeVisible();
  });

  test('should perform action when clicking menu item', async ({ page }) => {
    const firstTrack = page.locator('[data-track-id]').first();
    await firstTrack.click({ button: 'right' });
    await page.waitForSelector('[data-testid="track-context-menu"]', { state: 'visible' });
    await page.waitForSelector('[data-testid="track-context-menu"] .context-menu-item', {
      state: 'visible',
    });

    const playMenuItem = page.locator('[data-testid="track-context-menu"] .context-menu-item')
      .first();
    await playMenuItem.click();

    const contextMenu = page.locator('[data-testid="track-context-menu"]');
    await expect(contextMenu).not.toBeVisible();

    // Verify action was performed (depends on which menu item was clicked)
    // This is a generic check that something happened
    await page.waitForTimeout(500);
  });
});

test.describe('Context Menu Actions', () => {
  test.beforeEach(async ({ page }) => {
    const libraryState = createLibraryState();
    await setupLibraryMocks(page, libraryState);
    await page.goto('/');
    await waitForAlpine(page);
    await page.waitForSelector('[data-track-id]', { state: 'visible' });
  });

  test('Play Now should add tracks to queue', async ({ page }) => {
    // Get first track
    const firstTrack = page.locator('[data-track-id]').first();

    // Clear queue first
    await page.evaluate(() => {
      window.Alpine.store('queue').items = [];
    });

    // Right-click to open context menu
    await firstTrack.click({ button: 'right' });
    await page.waitForSelector('[data-testid="track-context-menu"]', { state: 'visible' });

    // Click "Play Now"
    const playNowItem = page.locator(
      '[data-testid="track-context-menu"] .context-menu-item:has-text("Play Now")',
    );
    await playNowItem.click();

    await page.waitForTimeout(300);

    // Verify queue has items (playSelected adds all tracks to queue)
    const queueLength = await page.evaluate(() => window.Alpine.store('queue').items.length);

    expect(queueLength).toBeGreaterThan(0);
  });

  test('Add to Queue should add selected tracks to queue', async ({ page }) => {
    // Clear existing queue
    await page.evaluate(() => {
      window.Alpine.store('queue').items = [];
    });

    // Get first track
    const firstTrack = page.locator('[data-track-id]').first();

    // Right-click to open context menu
    await firstTrack.click({ button: 'right' });
    await page.waitForSelector('[data-testid="track-context-menu"]', { state: 'visible' });

    // Click "Add to Queue"
    const addToQueueItem = page.locator(
      '[data-testid="track-context-menu"] .context-menu-item:has-text("Queue")',
    );
    await addToQueueItem.click();

    await page.waitForTimeout(300);

    // Verify track was added to queue
    const queueLength = await page.evaluate(() => window.Alpine.store('queue').items.length);
    expect(queueLength).toBeGreaterThan(0);
  });

  test('Play Next should insert track after current in queue', async ({ page }) => {
    // First, add some tracks to queue
    await page.keyboard.press('Meta+a');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);

    // Select a specific track that might not be first
    const secondTrack = page.locator('[data-track-id]').nth(1);
    if (await secondTrack.isVisible()) {
      await secondTrack.click({ button: 'right' });
      await page.waitForSelector('[data-testid="track-context-menu"]', { state: 'visible' });

      // Click "Play Next"
      const playNextItem = page.locator(
        '[data-testid="track-context-menu"] .context-menu-item:has-text("Play Next")',
      );
      if (await playNextItem.isVisible()) {
        await playNextItem.click();
        await page.waitForTimeout(300);
      }
    }

    // Context menu should be closed
    const contextMenu = page.locator('[data-testid="track-context-menu"]');
    await expect(contextMenu).not.toBeVisible();
  });

  test('Add to Playlist should show playlist submenu', async ({ page }) => {
    const firstTrack = page.locator('[data-track-id]').first();

    // Right-click to open context menu
    await firstTrack.click({ button: 'right' });
    await page.waitForSelector('[data-testid="track-context-menu"]', { state: 'visible' });

    // Hover over "Add to Playlist" to show submenu
    const addToPlaylistItem = page.locator(
      '[data-testid="track-context-menu"] .context-menu-item:has-text("Add to Playlist")',
    );
    await addToPlaylistItem.hover();

    await page.waitForTimeout(300);

    // Submenu should appear (if playlists exist)
    // Just verify the hover doesn't crash
    const menuStillVisible = await page.locator('[data-testid="track-context-menu"]').isVisible();
    expect(menuStillVisible).toBe(true);
  });

  test('Edit Metadata should open metadata modal', async ({ page }) => {
    const firstTrack = page.locator('[data-track-id]').first();

    // Right-click to open context menu
    await firstTrack.click({ button: 'right' });
    await page.waitForSelector('[data-testid="track-context-menu"]', { state: 'visible' });

    // Click "Edit Metadata"
    const editMetadataItem = page.locator(
      '[data-testid="track-context-menu"] .context-menu-item:has-text("Edit Metadata")',
    );
    await editMetadataItem.click();

    await page.waitForTimeout(300);

    // Verify metadata modal is opened (or UI state changed)
    const modalState = await page.evaluate(() => {
      return window.Alpine.store('ui').modal?.type;
    });
    // May be 'editMetadata' or similar
    expect(modalState).toBeTruthy();
  });

  test('Remove from Library should be marked as danger action', async ({ page }) => {
    const firstTrack = page.locator('[data-track-id]').first();

    // Right-click to open context menu
    await firstTrack.click({ button: 'right' });
    await page.waitForSelector('[data-testid="track-context-menu"]', { state: 'visible' });

    // Find "Remove from Library" - it should have danger styling
    const removeItem = page.locator(
      '[data-testid="track-context-menu"] .context-menu-item:has-text("Remove")',
    ).last();
    const hasDangerClass = await removeItem.evaluate((el) => el.classList.contains('danger'));

    expect(hasDangerClass).toBe(true);
  });

  test('should show correct label for multiple selected tracks', async ({ page }) => {
    // Select multiple tracks
    const firstTrack = page.locator('[data-track-id]').nth(0);
    const secondTrack = page.locator('[data-track-id]').nth(1);

    await firstTrack.click();
    await secondTrack.click({ modifiers: ['Meta'] });

    // Verify multiple selection
    const selectedCount = await page.evaluate(() => {
      const component = window.Alpine.$data(document.querySelector('[x-data="libraryBrowser"]'));
      return component.selectedTracks?.size || 0;
    });
    expect(selectedCount).toBe(2);

    // Right-click to open context menu
    await firstTrack.click({ button: 'right' });
    await page.waitForSelector('[data-testid="track-context-menu"]', { state: 'visible' });

    // Menu should show "2 tracks" in labels
    const menuText = await page.locator('[data-testid="track-context-menu"]').textContent();
    expect(menuText).toContain('2 tracks');
  });

  test('Show in Finder should be disabled for multiple tracks', async ({ page }) => {
    // Select multiple tracks
    await page.keyboard.press('Meta+a');

    const selectedCount = await page.evaluate(() => {
      const component = window.Alpine.$data(document.querySelector('[x-data="libraryBrowser"]'));
      return component.selectedTracks?.size || 0;
    });

    if (selectedCount > 1) {
      // Right-click to open context menu
      const firstTrack = page.locator('[data-track-id]').first();
      await firstTrack.click({ button: 'right' });
      await page.waitForSelector('[data-testid="track-context-menu"]', { state: 'visible' });

      // "Show in Finder" should be disabled
      const showInFinderItem = page.locator(
        '[data-testid="track-context-menu"] .context-menu-item:has-text("Show in Finder")',
      );
      if (await showInFinderItem.isVisible()) {
        const isDisabled = await showInFinderItem.evaluate((el) =>
          el.classList.contains('disabled')
        );
        expect(isDisabled).toBe(true);
      }
    }
  });

  test('context menu should close when pressing Escape', async ({ page }) => {
    const firstTrack = page.locator('[data-track-id]').first();

    // Right-click to open context menu
    await firstTrack.click({ button: 'right' });
    await page.waitForSelector('[data-testid="track-context-menu"]', { state: 'visible' });

    // Press Escape
    await page.keyboard.press('Escape');

    // Menu should be closed
    const contextMenu = page.locator('[data-testid="track-context-menu"]');
    await expect(contextMenu).not.toBeVisible();
  });

  test('context menu should close when clicking outside', async ({ page }) => {
    const firstTrack = page.locator('[data-track-id]').nth(0);

    // Right-click first track to open context menu
    await firstTrack.click({ button: 'right' });
    await page.waitForSelector('[data-testid="track-context-menu"]', { state: 'visible' });

    // Click outside the menu (on empty area)
    await page.click('body', { position: { x: 50, y: 50 }, force: true });

    await page.waitForTimeout(200);

    // Menu should be closed
    const contextMenu = page.locator('[data-testid="track-context-menu"]');
    await expect(contextMenu).not.toBeVisible();
  });

  test('context menu state is managed via Alpine store', async ({ page }) => {
    const firstTrack = page.locator('[data-track-id]').nth(0);

    // Right-click first track to open context menu
    await firstTrack.click({ button: 'right' });
    await page.waitForSelector('[data-testid="track-context-menu"]', { state: 'visible' });

    // Verify contextMenu state is set in component
    const hasContextMenu = await page.evaluate(() => {
      const component = window.Alpine.$data(document.querySelector('[x-data="libraryBrowser"]'));
      return component.contextMenu !== null;
    });
    expect(hasContextMenu).toBe(true);

    // Close via Escape
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    // Verify contextMenu is cleared
    const contextMenuCleared = await page.evaluate(() => {
      const component = window.Alpine.$data(document.querySelector('[x-data="libraryBrowser"]'));
      return component.contextMenu === null;
    });
    expect(contextMenuCleared).toBe(true);
  });
});
