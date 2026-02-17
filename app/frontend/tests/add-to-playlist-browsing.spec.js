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

// --- Albums View Tests ---

test.describe('Add to Playlist - Albums View (task-275)', () => {
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

    // Navigate to Albums view
    await setAlpineStoreProperty(page, 'ui', 'view', 'albums');
    await page.waitForSelector('[data-testid="albums-view"]', { state: 'visible' });
  });

  test('AC#1: album context menu includes Add to Playlist', async ({ page }) => {
    const albumCard = page.locator('[data-testid="album-card"]').first();
    await albumCard.click({ button: 'right' });

    const menu = page.locator('[data-testid="albums-context-menu"]');
    await expect(menu).toBeVisible();

    const addToPlaylistItem = menu.locator('.context-menu-item:has-text("Add to Playlist")');
    await expect(addToPlaylistItem).toBeVisible();
  });

  test('AC#4: hovering Add to Playlist shows playlist submenu on album', async ({ page }) => {
    const albumCard = page.locator('[data-testid="album-card"]').first();
    await albumCard.click({ button: 'right' });

    const addToPlaylistItem = page.locator(
      '[data-testid="albums-context-menu"] .context-menu-item:has-text("Add to Playlist")',
    );
    await addToPlaylistItem.hover();
    await page.waitForTimeout(300);

    const submenu = page.locator('[data-testid="albums-playlist-submenu"]');
    await expect(submenu).toBeVisible();

    // Should show existing playlists from mock data
    await expect(submenu.locator('text=Test Playlist 1')).toBeVisible();
    await expect(submenu.locator('text=Test Playlist 2')).toBeVisible();
  });

  test('AC#4: submenu includes New Playlist option on album', async ({ page }) => {
    const albumCard = page.locator('[data-testid="album-card"]').first();
    await albumCard.click({ button: 'right' });

    const addToPlaylistItem = page.locator(
      '[data-testid="albums-context-menu"] .context-menu-item:has-text("Add to Playlist")',
    );
    await addToPlaylistItem.hover();
    await page.waitForTimeout(300);

    const submenu = page.locator('[data-testid="albums-playlist-submenu"]');
    await expect(submenu.locator('text=New Playlist...')).toBeVisible();
  });

  test('AC#5: clicking playlist adds album tracks via API', async ({ page }) => {
    const albumCard = page.locator('[data-testid="album-card"]').first();
    await albumCard.click({ button: 'right' });

    const addToPlaylistItem = page.locator(
      '[data-testid="albums-context-menu"] .context-menu-item:has-text("Add to Playlist")',
    );
    await addToPlaylistItem.hover();
    await page.waitForTimeout(300);

    const submenu = page.locator('[data-testid="albums-playlist-submenu"]');
    await submenu.locator('text=Test Playlist 1').click();

    // Context menu should close
    await expect(page.locator('[data-testid="albums-context-menu"]')).not.toBeVisible();

    // Verify API was called to add tracks
    const addCalls = findApiCalls(playlistState, 'POST', /\/tracks$/);
    expect(addCalls.length).toBeGreaterThan(0);
    expect(addCalls[0].body.track_ids.length).toBeGreaterThan(0);
  });

  test('AC#2: track context menu in album detail includes Add to Playlist', async ({ page }) => {
    // Open album detail
    const albumCard = page.locator('[data-testid="album-card"]').first();
    await albumCard.click();
    await page.waitForSelector('[data-testid="album-detail-track"]', { state: 'visible' });

    // Right-click a track
    const track = page.locator('[data-testid="album-detail-track"]').first();
    await track.click({ button: 'right' });

    const menu = page.locator('[data-testid="albums-context-menu"]');
    await expect(menu).toBeVisible();

    const addToPlaylistItem = menu.locator('.context-menu-item:has-text("Add to Playlist")');
    await expect(addToPlaylistItem).toBeVisible();
  });

  test('AC#4: hovering Add to Playlist shows submenu on track', async ({ page }) => {
    // Open album detail
    const albumCard = page.locator('[data-testid="album-card"]').first();
    await albumCard.click();
    await page.waitForSelector('[data-testid="album-detail-track"]', { state: 'visible' });

    // Right-click a track
    const track = page.locator('[data-testid="album-detail-track"]').first();
    await track.click({ button: 'right' });

    const addToPlaylistItem = page.locator(
      '[data-testid="albums-context-menu"] .context-menu-item:has-text("Add to Playlist")',
    );
    await addToPlaylistItem.hover();
    await page.waitForTimeout(300);

    const submenu = page.locator('[data-testid="albums-playlist-submenu"]');
    await expect(submenu).toBeVisible();
    await expect(submenu.locator('text=Test Playlist 1')).toBeVisible();
  });

  test('clicking playlist on track adds single track via API', async ({ page }) => {
    // Open album detail
    const albumCard = page.locator('[data-testid="album-card"]').first();
    await albumCard.click();
    await page.waitForSelector('[data-testid="album-detail-track"]', { state: 'visible' });

    const track = page.locator('[data-testid="album-detail-track"]').first();
    await track.click({ button: 'right' });

    const addToPlaylistItem = page.locator(
      '[data-testid="albums-context-menu"] .context-menu-item:has-text("Add to Playlist")',
    );
    await addToPlaylistItem.hover();
    await page.waitForTimeout(300);

    const submenu = page.locator('[data-testid="albums-playlist-submenu"]');
    await submenu.locator('text=Test Playlist 1').click();

    // Verify API was called with exactly 1 track
    const addCalls = findApiCalls(playlistState, 'POST', /\/tracks$/);
    expect(addCalls.length).toBeGreaterThan(0);
    const lastCall = addCalls[addCalls.length - 1];
    expect(lastCall.body.track_ids).toHaveLength(1);
  });

  test('albums view resets to grid when navigating away and back', async ({ page }) => {
    // Open album detail
    const albumCard = page.locator('[data-testid="album-card"]').first();
    await albumCard.click();
    await page.waitForSelector('[data-testid="album-detail-track"]', { state: 'visible' });

    // Navigate away to library
    await setAlpineStoreProperty(page, 'ui', 'view', 'library');
    await page.waitForTimeout(100);

    // Navigate back to albums
    await setAlpineStoreProperty(page, 'ui', 'view', 'albums');
    await page.waitForSelector('[data-testid="albums-view"]', { state: 'visible' });

    // Should be back to grid view, not detail
    await expect(page.locator('[data-testid="album-card"]').first()).toBeVisible();
  });
});

// --- Artists View Tests ---

test.describe('Add to Playlist - Artists View (task-275)', () => {
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

    // Navigate to Artists view
    await setAlpineStoreProperty(page, 'ui', 'view', 'artists');
    await page.waitForSelector('[data-testid="artists-view"]', { state: 'visible' });
  });

  test('AC#3: track context menu in artist view includes Add to Playlist', async ({ page }) => {
    // Wait for artist list and select first artist
    await page.waitForSelector('[data-testid^="artist-item-"]', { state: 'visible' });
    await page.locator('[data-testid^="artist-item-"]').first().click();

    // Wait for tracks to appear
    await page.waitForSelector('[data-testid^="artist-track-"]', { state: 'visible' });

    // Right-click a track
    const track = page.locator('[data-testid^="artist-track-"]').first();
    await track.click({ button: 'right' });

    const menu = page.locator('[data-testid="artists-track-context-menu"]');
    await expect(menu).toBeVisible();

    const addToPlaylistItem = menu.locator('.context-menu-item:has-text("Add to Playlist")');
    await expect(addToPlaylistItem).toBeVisible();
  });

  test('AC#4: hovering Add to Playlist shows playlist submenu', async ({ page }) => {
    await page.waitForSelector('[data-testid^="artist-item-"]', { state: 'visible' });
    await page.locator('[data-testid^="artist-item-"]').first().click();
    await page.waitForSelector('[data-testid^="artist-track-"]', { state: 'visible' });

    const track = page.locator('[data-testid^="artist-track-"]').first();
    await track.click({ button: 'right' });

    const addToPlaylistItem = page.locator(
      '[data-testid="artists-track-context-menu"] .context-menu-item:has-text("Add to Playlist")',
    );
    await addToPlaylistItem.hover();
    await page.waitForTimeout(300);

    const submenu = page.locator('[data-testid="artists-playlist-submenu"]');
    await expect(submenu).toBeVisible();
    await expect(submenu.locator('text=Test Playlist 1')).toBeVisible();
    await expect(submenu.locator('text=Test Playlist 2')).toBeVisible();
  });

  test('AC#4: submenu includes New Playlist option', async ({ page }) => {
    await page.waitForSelector('[data-testid^="artist-item-"]', { state: 'visible' });
    await page.locator('[data-testid^="artist-item-"]').first().click();
    await page.waitForSelector('[data-testid^="artist-track-"]', { state: 'visible' });

    const track = page.locator('[data-testid^="artist-track-"]').first();
    await track.click({ button: 'right' });

    const addToPlaylistItem = page.locator(
      '[data-testid="artists-track-context-menu"] .context-menu-item:has-text("Add to Playlist")',
    );
    await addToPlaylistItem.hover();
    await page.waitForTimeout(300);

    const submenu = page.locator('[data-testid="artists-playlist-submenu"]');
    await expect(submenu.locator('text=New Playlist...')).toBeVisible();
  });

  test('AC#5: clicking playlist adds track via API', async ({ page }) => {
    await page.waitForSelector('[data-testid^="artist-item-"]', { state: 'visible' });
    await page.locator('[data-testid^="artist-item-"]').first().click();
    await page.waitForSelector('[data-testid^="artist-track-"]', { state: 'visible' });

    const track = page.locator('[data-testid^="artist-track-"]').first();
    await track.click({ button: 'right' });

    const addToPlaylistItem = page.locator(
      '[data-testid="artists-track-context-menu"] .context-menu-item:has-text("Add to Playlist")',
    );
    await addToPlaylistItem.hover();
    await page.waitForTimeout(300);

    const submenu = page.locator('[data-testid="artists-playlist-submenu"]');
    await submenu.locator('text=Test Playlist 1').click();

    // Context menu should close
    await expect(page.locator('[data-testid="artists-track-context-menu"]')).not.toBeVisible();

    // Verify API was called
    const addCalls = findApiCalls(playlistState, 'POST', /\/tracks$/);
    expect(addCalls.length).toBeGreaterThan(0);
    expect(addCalls[0].body.track_ids).toHaveLength(1);
  });
});
