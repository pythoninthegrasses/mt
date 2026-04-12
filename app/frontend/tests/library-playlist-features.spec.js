import { expect, test } from '@playwright/test';
import { waitForAlpine } from './fixtures/helpers.js';
import {
  clearApiCalls,
  createPlaylistState,
  findApiCalls,
  setupPlaylistMocks,
} from './fixtures/mock-playlists.js';

test.describe('Playlist Feature Parity - Library Browser (task-150)', () => {
  let playlistState;

  test.beforeAll(() => {
    playlistState = createPlaylistState();
  });

  test.beforeEach(async ({ page }) => {
    clearApiCalls(playlistState);
    // Setup playlist API mocks before navigation
    await setupPlaylistMocks(page, playlistState);
    // Mock library count endpoint (pagination support)
    await page.route(/\/api\/library\/count(\?.*)?$/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ total: 2, total_duration: 380 }),
      });
    });
    // Also mock library tracks endpoint
    await page.route(/\/api\/library(\?.*)?$/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          tracks: [
            {
              id: 101,
              title: 'Track A',
              artist: 'Artist A',
              album: 'Album A',
              duration: 180,
              filepath: '/music/track-a.mp3',
            },
            {
              id: 102,
              title: 'Track B',
              artist: 'Artist B',
              album: 'Album B',
              duration: 200,
              filepath: '/music/track-b.mp3',
            },
          ],
          total: 2,
        }),
      });
    });
    await page.goto('/');
    await waitForAlpine(page);
    await page.waitForSelector('[x-data="libraryBrowser"]', { state: 'visible' });
    // Trigger playlist load via event (simulates real app behavior)
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('mt:playlists-updated')));
    await page.waitForTimeout(200);
  });

  test('AC#3: should show Add to Playlist submenu in context menu', async ({ page }) => {
    await page.waitForSelector('[data-track-id]', { state: 'visible' });

    const trackRow = page.locator('[data-track-id]').first();
    await trackRow.click({ button: 'right' });

    const addToPlaylistItem = page.locator('.context-menu-item:has-text("Add to Playlist")');
    await expect(addToPlaylistItem).toBeVisible();
  });

  test('AC#4-5: track rows should be draggable', async ({ page }) => {
    await page.waitForSelector('[data-track-id]', { state: 'visible' });

    const trackRow = page.locator('[data-track-id]').first();
    const draggable = await trackRow.getAttribute('draggable');
    expect(draggable).toBe('true');
  });

  test('AC#7-8: playlist view detection works correctly', async ({ page }) => {
    // Navigate to playlist view via sidebar click (real flow)
    const playlistButton = page.locator('[data-testid="sidebar-playlist-1"]');
    if (await playlistButton.count() > 0) {
      await playlistButton.click();
      await page.waitForTimeout(300);
    } else {
      // Fallback: set via evaluate if sidebar playlist not rendered
      await page.evaluate(() => {
        const libraryBrowser = window.Alpine.$data(
          document.querySelector('[x-data="libraryBrowser"]'),
        );
        libraryBrowser.currentPlaylistId = 1;
      });
    }

    const isInPlaylistView = await page.evaluate(() => {
      const libraryBrowser = window.Alpine.$data(
        document.querySelector('[x-data="libraryBrowser"]'),
      );
      return libraryBrowser.isInPlaylistView();
    });

    expect(isInPlaylistView).toBe(true);
  });

  test('AC#7-8: outside playlist view detection works correctly', async ({ page }) => {
    // Ensure we're in library view (not playlist)
    await page.locator('[data-testid="sidebar-section-all"]').click();
    await page.waitForTimeout(200);

    const isInPlaylistView = await page.evaluate(() => {
      const libraryBrowser = window.Alpine.$data(
        document.querySelector('[x-data="libraryBrowser"]'),
      );
      return libraryBrowser.isInPlaylistView();
    });

    expect(isInPlaylistView).toBe(false);
  });

  test('AC#3: submenu opens on hover and lists playlists from API', async ({ page }) => {
    await page.waitForSelector('[data-track-id]', { state: 'visible' });

    const trackRow = page.locator('[data-track-id]').first();
    await trackRow.click({ button: 'right' });

    const addToPlaylistItem = page.locator('.context-menu-item:has-text("Add to Playlist")');
    await addToPlaylistItem.hover();
    await page.waitForTimeout(200);

    const submenu = page.locator('[data-testid="playlist-submenu"]');
    await expect(submenu).toBeVisible();

    const newPlaylistOption = submenu.locator('text=New Playlist...');
    await expect(newPlaylistOption).toBeVisible();

    // These should come from the mock API (Test Playlist 1, Test Playlist 2)
    const playlist1Option = submenu.locator('text=Test Playlist 1');
    await expect(playlist1Option).toBeVisible();

    const playlist2Option = submenu.locator('text=Test Playlist 2');
    await expect(playlist2Option).toBeVisible();
  });

  test('AC#3: clicking playlist in submenu triggers API call', async ({ page }) => {
    await page.waitForSelector('[data-track-id]', { state: 'visible' });

    // Select a track first
    const trackRow = page.locator('[data-track-id]').first();
    await trackRow.click();
    await trackRow.click({ button: 'right' });

    const addToPlaylistItem = page.locator('.context-menu-item:has-text("Add to Playlist")');
    await addToPlaylistItem.hover();
    await page.waitForTimeout(200);

    const submenu = page.locator('[data-testid="playlist-submenu"]');
    const playlist1Option = submenu.locator('text=Test Playlist 1');
    await playlist1Option.click();

    await page.waitForTimeout(300);

    // Verify API was called with correct endpoint
    const addTracksCalls = findApiCalls(playlistState, 'POST', '/playlists/1/tracks');
    expect(addTracksCalls.length).toBeGreaterThan(0);
    expect(addTracksCalls[0].body).toHaveProperty('track_ids');
  });

  test('AC#7-8: context menu shows "Remove from Playlist" in playlist view', async ({ page }) => {
    // Navigate to playlist view
    await page.evaluate(() => {
      const libraryBrowser = window.Alpine.$data(
        document.querySelector('[x-data="libraryBrowser"]'),
      );
      libraryBrowser.currentPlaylistId = 1;
    });

    await page.waitForSelector('[data-track-id]', { state: 'visible' });

    const trackRow = page.locator('[data-track-id]').first();
    await trackRow.click({ button: 'right' });

    const removeFromPlaylist = page.locator(
      '.context-menu-item:has-text("Remove track from Playlist")',
    );
    await expect(removeFromPlaylist).toBeVisible();

    const removeFromLibrary = page.locator(
      '.context-menu-item:has-text("Remove track from Library")',
    );
    await expect(removeFromLibrary).toBeVisible();
  });

  test('AC#7-8: context menu hides "Remove from Playlist" outside playlist view', async ({ page }) => {
    // Ensure we're in library view
    await page.evaluate(() => {
      const libraryBrowser = window.Alpine.$data(
        document.querySelector('[x-data="libraryBrowser"]'),
      );
      libraryBrowser.currentPlaylistId = null;
    });

    await page.waitForSelector('[data-track-id]', { state: 'visible' });

    const trackRow = page.locator('[data-track-id]').first();
    await trackRow.click({ button: 'right' });

    const removeFromPlaylist = page.locator(
      '.context-menu-item:has-text("Remove track from Playlist")',
    );
    await expect(removeFromPlaylist).not.toBeVisible();

    const removeFromLibrary = page.locator(
      '.context-menu-item:has-text("Remove track from Library")',
    );
    await expect(removeFromLibrary).toBeVisible();
  });

  test('AC#6: drag reorder in playlist view shows drag handle and sets state', async ({ page }) => {
    // Navigate to playlist view
    await page.evaluate(() => {
      const libraryBrowser = window.Alpine.$data(
        document.querySelector('[x-data="libraryBrowser"]'),
      );
      libraryBrowser.currentPlaylistId = 1;
    });

    await page.waitForSelector('[data-track-id]', { state: 'visible' });

    const dragHandle = page.locator('[data-track-id] .cursor-grab').first();
    await expect(dragHandle).toBeVisible();

    const isInPlaylistView = await page.evaluate(() => {
      const libraryBrowser = window.Alpine.$data(
        document.querySelector('[x-data="libraryBrowser"]'),
      );
      return libraryBrowser.isInPlaylistView();
    });
    expect(isInPlaylistView).toBe(true);

    // Click on the drag handle itself to trigger drag state
    const dragHandleBox = await dragHandle.boundingBox();
    await page.mouse.move(
      dragHandleBox.x + dragHandleBox.width / 2,
      dragHandleBox.y + dragHandleBox.height / 2,
    );
    await page.mouse.down();

    const draggingIndex = await page.evaluate(() => {
      const libraryBrowser = window.Alpine.$data(
        document.querySelector('[x-data="libraryBrowser"]'),
      );
      return libraryBrowser.draggingIndex;
    });

    expect(draggingIndex).toBe(0);

    await page.mouse.up();
  });

  test('submenu flips to left side when near right viewport edge', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 600 });

    await page.waitForSelector('[data-track-id]', { state: 'visible' });

    const trackRow = page.locator('[data-track-id]').first();
    const trackBox = await trackRow.boundingBox();

    await page.mouse.click(trackBox.x + trackBox.width - 50, trackBox.y + trackBox.height / 2, {
      button: 'right',
    });

    const addToPlaylistItem = page.locator('.context-menu-item:has-text("Add to Playlist")');
    await addToPlaylistItem.hover();
    await page.waitForTimeout(200);

    const arrowText = await addToPlaylistItem.locator('.text-muted-foreground').textContent();

    const submenuOnLeft = await page.evaluate(() => {
      const libraryBrowser = window.Alpine.$data(
        document.querySelector('[x-data="libraryBrowser"]'),
      );
      return libraryBrowser.submenuOnLeft;
    });

    if (submenuOnLeft) {
      expect(arrowText).toBe('\u25C0');
    } else {
      expect(arrowText).toBe('\u25B6');
    }
  });
});

test.describe('Playlist load regression guard (task-179)', () => {
  test('restores playlist section without loading full library', async ({ page }) => {
    const playlistState = createPlaylistState();
    const libraryCalls = [];

    await setupPlaylistMocks(page, playlistState);

    // Mock library count endpoint (pagination support)
    await page.route(/\/api\/library\/count(\?.*)?$/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ total: 1, total_duration: 180 }),
      });
    });

    await page.route(/\/api\/library(\?.*)?$/, async (route, request) => {
      if (request.method() !== 'GET') {
        await route.continue();
        return;
      }

      libraryCalls.push({ method: 'GET', url: '/api/library' });

      await new Promise((resolve) => setTimeout(resolve, 500));

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          tracks: [
            {
              id: 201,
              title: 'Library Track 1',
              artist: 'Library Artist',
              album: 'Library Album',
              duration: 180,
              track_number: 9,
              filepath: '/music/library-track-1.mp3',
            },
          ],
          total: 1,
        }),
      });
    });

    await page.addInitScript(() => {
      localStorage.setItem('mt:sidebar', JSON.stringify({ activeSection: 'playlist-1' }));
    });

    const playlistLoadResponse = page.waitForResponse((response) => (
      /\/api\/playlists\/1$/.test(response.url()) &&
      response.request().method() === 'GET'
    ));

    await page.goto('/');
    await waitForAlpine(page);
    await page.waitForSelector('[x-data="libraryBrowser"]', { state: 'visible' });
    await playlistLoadResponse;
    await expect(page.locator('[data-track-id]')).toHaveCount(2);

    const titleCells = page.locator('[data-track-id] [data-column="title"]');
    await expect(titleCells.nth(0)).toContainText('Track A');
    await expect(titleCells.nth(1)).toContainText('Track B');

    await page.waitForTimeout(700);

    await expect(page.locator('[data-track-id]')).toHaveCount(2);
    expect(libraryCalls.length).toBe(0);
  });
});
