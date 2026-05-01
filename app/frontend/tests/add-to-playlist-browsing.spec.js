/**
 * E2E tests for "Add to Playlist" context menu in Albums and Artists browsing views.
 * Covers task-275 acceptance criteria.
 */

import { expect, test } from '@playwright/test';
import { setAlpineStoreProperty, waitForAlpine } from './fixtures/helpers.js';
import {
  clearApiCalls,
  createPlaylistState,
  findApiCalls,
  setupPlaylistMocks,
} from './fixtures/mock-playlists.js';
import { createLibraryState, setupLibraryMocks } from './fixtures/mock-library.js';

// {view, viewSelector, menuTestId, submenuTestId, openContextMenu, expectSingleTrack}
const variants = [
  {
    label: 'album card in Albums view',
    view: 'albums',
    viewSelector: '[data-testid="albums-view"]',
    menuTestId: 'albums-context-menu',
    submenuTestId: 'albums-playlist-submenu',
    async openContextMenu(page) {
      await page.locator('[data-testid="album-card"]').first().click({ button: 'right' });
    },
    expectSingleTrack: false,
  },
  {
    label: 'track in album detail (Albums view)',
    view: 'albums',
    viewSelector: '[data-testid="albums-view"]',
    menuTestId: 'albums-context-menu',
    submenuTestId: 'albums-playlist-submenu',
    async openContextMenu(page) {
      await page.locator('[data-testid="album-card"]').first().click();
      await page.waitForSelector('[data-testid="album-detail-track"]', { state: 'visible' });
      await page.locator('[data-testid="album-detail-track"]').first().click({ button: 'right' });
    },
    expectSingleTrack: true,
  },
  {
    label: 'track in Artists view',
    view: 'artists',
    viewSelector: '[data-testid="artists-view"]',
    menuTestId: 'artists-track-context-menu',
    submenuTestId: 'artists-playlist-submenu',
    async openContextMenu(page) {
      await page.waitForSelector('[data-testid^="artist-item-"]', { state: 'visible' });
      await page.locator('[data-testid^="artist-item-"]').first().click();
      await page.waitForSelector('[data-testid^="artist-track-"]', { state: 'visible' });
      await page.locator('[data-testid^="artist-track-"]').first().click({ button: 'right' });
    },
    expectSingleTrack: true,
  },
];

test.describe.parallel('Add to Playlist - browsing views (task-275)', () => {
  for (const variant of variants) {
    test.describe(variant.label, () => {
      let playlistState;
      let libraryState;

      test.beforeAll(() => {
        playlistState = createPlaylistState();
        libraryState = createLibraryState({ trackCount: 20 });
      });

      test.beforeEach(async ({ page }) => {
        clearApiCalls(playlistState);
        await setupPlaylistMocks(page, playlistState);
        await setupLibraryMocks(page, libraryState);
        await page.goto('/');
        await waitForAlpine(page);
        await setAlpineStoreProperty(page, 'ui', 'view', variant.view);
        await page.waitForSelector(variant.viewSelector, { state: 'visible' });
      });

      test('context menu includes Add to Playlist', async ({ page }) => {
        await variant.openContextMenu(page);
        const menu = page.locator(`[data-testid="${variant.menuTestId}"]`);
        await expect(menu).toBeVisible();
        await expect(menu.locator('.context-menu-item:has-text("Add to Playlist")')).toBeVisible();
      });

      test('hovering Add to Playlist shows submenu with playlists', async ({ page }) => {
        await variant.openContextMenu(page);
        const addToPlaylistItem = page.locator(
          `[data-testid="${variant.menuTestId}"] .context-menu-item:has-text("Add to Playlist")`,
        );
        await addToPlaylistItem.hover();
        await page.waitForTimeout(300);
        const submenu = page.locator(`[data-testid="${variant.submenuTestId}"]`);
        await expect(submenu).toBeVisible();
        await expect(submenu.locator('text=Test Playlist 1')).toBeVisible();
        await expect(submenu.locator('text=Test Playlist 2')).toBeVisible();
      });

      test('submenu includes New Playlist option', async ({ page }) => {
        await variant.openContextMenu(page);
        const addToPlaylistItem = page.locator(
          `[data-testid="${variant.menuTestId}"] .context-menu-item:has-text("Add to Playlist")`,
        );
        await addToPlaylistItem.hover();
        await page.waitForTimeout(300);
        const submenu = page.locator(`[data-testid="${variant.submenuTestId}"]`);
        await expect(submenu.locator('text=New Playlist...')).toBeVisible();
      });

      test('clicking playlist adds tracks via API', async ({ page }) => {
        await variant.openContextMenu(page);
        const addToPlaylistItem = page.locator(
          `[data-testid="${variant.menuTestId}"] .context-menu-item:has-text("Add to Playlist")`,
        );
        await addToPlaylistItem.hover();
        await page.waitForTimeout(300);
        const submenu = page.locator(`[data-testid="${variant.submenuTestId}"]`);
        await submenu.locator('text=Test Playlist 1').click();
        await expect(page.locator(`[data-testid="${variant.menuTestId}"]`)).not.toBeVisible();
        const addCalls = findApiCalls(playlistState, 'POST', /\/tracks$/);
        expect(addCalls.length).toBeGreaterThan(0);
        const lastCall = addCalls[addCalls.length - 1];
        if (variant.expectSingleTrack) {
          expect(lastCall.body.track_ids).toHaveLength(1);
        } else {
          expect(lastCall.body.track_ids.length).toBeGreaterThan(0);
        }
      });
    });
  }
});

// Standalone: albums-specific navigation behavior not shared with other views
test.describe('Add to Playlist - Albums View navigation', () => {
  let playlistState;
  let libraryState;

  test.beforeAll(() => {
    playlistState = createPlaylistState();
    libraryState = createLibraryState({ trackCount: 20 });
  });

  test.beforeEach(async ({ page }) => {
    clearApiCalls(playlistState);
    await setupPlaylistMocks(page, playlistState);
    await setupLibraryMocks(page, libraryState);
    await page.goto('/');
    await waitForAlpine(page);
    await setAlpineStoreProperty(page, 'ui', 'view', 'albums');
    await page.waitForSelector('[data-testid="albums-view"]', { state: 'visible' });
  });

  test('albums view resets to grid when navigating away and back', async ({ page }) => {
    await page.locator('[data-testid="album-card"]').first().click();
    await page.waitForSelector('[data-testid="album-detail-track"]', { state: 'visible' });
    await setAlpineStoreProperty(page, 'ui', 'view', 'library');
    await page.waitForTimeout(100);
    await setAlpineStoreProperty(page, 'ui', 'view', 'albums');
    await page.waitForSelector('[data-testid="albums-view"]', { state: 'visible' });
    await expect(page.locator('[data-testid="album-card"]').first()).toBeVisible();
  });
});
