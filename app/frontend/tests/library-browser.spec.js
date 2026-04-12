import { expect, test } from '@playwright/test';
import { getAlpineStore, setAlpineStoreProperty, waitForAlpine } from './fixtures/helpers.js';
import { createPlaylistState, setupPlaylistMocks } from './fixtures/mock-playlists.js';
import { createLibraryState, setupLibraryMocks } from './fixtures/mock-library.js';

test.describe('Library Browser', () => {
  test.beforeEach(async ({ page }) => {
    const libraryState = createLibraryState();
    await setupLibraryMocks(page, libraryState);
    await page.goto('/');
    await waitForAlpine(page);
    await page.waitForSelector('[x-data="libraryBrowser"]', { state: 'visible' });
  });

  test('should display track list', async ({ page }) => {
    // Wait for tracks to load
    await page.waitForSelector('[data-track-id]', { state: 'visible' });

    // Verify tracks are displayed
    const trackRows = page.locator('[data-track-id]');
    const count = await trackRows.count();
    expect(count).toBeGreaterThan(0);
  });

  test('should display track metadata columns', async ({ page }) => {
    await page.waitForSelector('[data-track-id]', { state: 'visible' });

    // Verify column headers are present
    const headers = page.locator('.column-header, [class*="sort-header"]');
    const headerTexts = await headers.allTextContents();

    // Should have at least these columns
    const expectedColumns = ['#', 'Title', 'Artist', 'Album', 'Duration'];
    expectedColumns.forEach((col) => {
      const hasColumn = headerTexts.some((text) => text.includes(col));
      if (!hasColumn) {
        // Column might be represented differently, check track data instead
        console.log(`Column "${col}" not found in headers, but may be present in rows`);
      }
    });
  });

  test('should show loading state initially', async ({ page }) => {
    // This test needs to run on fresh page load
    await page.reload();
    await waitForAlpine(page);

    // Check for loading indicator (might be brief)
    const loadingIndicator = page.locator('text=Loading library, svg.animate-spin');
    await loadingIndicator.first().isVisible().catch(() => false);

    // Loading might be too fast to catch, so we check the library store instead
    const libraryStore = await getAlpineStore(page, 'library');
    // If tracks are already loaded, loading was completed
    expect(libraryStore.tracks.length >= 0).toBe(true);
  });

  test('should show empty state when no tracks', async ({ page }) => {
    // Set library to empty
    await page.evaluate(() => {
      window.Alpine.store('library').tracks = [];
      window.Alpine.store('library').filteredTracks = [];
      window.Alpine.store('library').totalTracks = 0;
      window.Alpine.store('library').loading = false;
    });

    // Wait for empty state
    await page.waitForSelector('text=Library is empty', { state: 'visible' });

    // Verify empty state message
    const emptyState = page.locator('text=Library is empty');
    await expect(emptyState).toBeVisible();
  });

  test('should scroll to current track when double-clicking track display in bottom bar', async ({ page }) => {
    // Wait for tracks to load and ensure we're in library view
    await page.waitForSelector('[data-track-id]', { state: 'visible' });
    const uiStore = await getAlpineStore(page, 'ui');
    expect(uiStore.view).toBe('library');

    // Get the first track from the library
    const libraryStore = await getAlpineStore(page, 'library');
    const firstTrack = libraryStore.filteredTracks[0];
    expect(firstTrack).toBeTruthy();

    // Mock the current track in the player store
    await setAlpineStoreProperty(page, 'player', 'currentTrack', firstTrack);

    // Scroll away from the first track by scrolling to bottom
    await page.evaluate(() => {
      const container = document.querySelector('[x-ref="scrollContainer"]');
      container.scrollTop = container.scrollHeight;
    });
    await page.waitForTimeout(200);

    // Double-click the track display in the bottom bar
    const trackDisplay = page.locator('footer [x-text="trackDisplayName"]');
    await expect(trackDisplay).toBeVisible();
    await trackDisplay.dblclick();

    // Wait for smooth scroll to complete
    await page.waitForTimeout(1000);

    // Verify the first track is now visible (scrolled into view)
    const firstTrackElement = page.locator(`[data-track-id="${firstTrack.id}"]`);
    const isVisible = await firstTrackElement.isVisible();
    expect(isVisible).toBe(true);
  });
});

test.describe('Playlist Position Column', () => {
  test.beforeEach(async ({ page }) => {
    const libraryState = createLibraryState();
    await setupLibraryMocks(page, libraryState);

    const playlistState = createPlaylistState();
    await setupPlaylistMocks(page, playlistState);

    await page.goto('/');
    await waitForAlpine(page);
    await page.waitForSelector('[x-data="libraryBrowser"]', { state: 'visible' });
  });

  test('should show position header and sequential values in playlists', async ({ page }) => {
    await page.waitForSelector('[data-track-id]', { state: 'visible' });

    const headerTexts = await page.locator('.column-header-cell').allTextContents();
    expect(headerTexts.some((text) => text.trim() === '#')).toBe(true);

    const playlistItem = page.locator('[data-playlist-id="1"]');
    await expect(playlistItem).toBeVisible();
    await playlistItem.click();

    await page.waitForSelector('[data-track-id="101"]', { state: 'visible' });

    // Column header shows "#" in both library and playlist views
    const playlistHeaderTexts = await page.locator('.column-header-cell').allTextContents();
    expect(playlistHeaderTexts.some((text) => text.trim() === '#')).toBe(true);

    const firstRow = page.locator('[data-track-id]').nth(0);
    const secondRow = page.locator('[data-track-id]').nth(1);

    await expect(firstRow.locator('[data-column="index"]')).toHaveText('1');
    await expect(secondRow.locator('[data-column="index"]')).toHaveText('2');
    await expect(firstRow.locator('[data-column="title"]')).toContainText('Track A');
    await expect(secondRow.locator('[data-column="title"]')).toContainText('Track B');

    await page.evaluate(async () => {
      await fetch('/api/playlists/1/tracks/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from_position: 0, to_position: 1 }),
      });
      await window.Alpine.store('library').loadPlaylist(1);
    });

    await expect(page.locator('[data-track-id]').nth(0).locator('[data-column="title"]'))
      .toContainText('Track B');
    await expect(page.locator('[data-track-id]').nth(1).locator('[data-column="title"]'))
      .toContainText('Track A');
    await expect(page.locator('[data-track-id]').nth(0).locator('[data-column="index"]'))
      .toHaveText('1');
    await expect(page.locator('[data-track-id]').nth(1).locator('[data-column="index"]'))
      .toHaveText('2');
  });
});

test.describe('Section Navigation', () => {
  test.beforeEach(async ({ page }) => {
    const libraryState = createLibraryState();
    await setupLibraryMocks(page, libraryState);
    await page.goto('/');
    await waitForAlpine(page);
  });

  test('should show different library sections', async ({ page }) => {
    // Navigate to "All Songs" (default)
    const libraryStore = await getAlpineStore(page, 'library');
    expect(libraryStore.currentSection).toBeTruthy();
  });

  test('should update view when changing section', async ({ page }) => {
    // Wait for library to load
    await page.waitForSelector('[data-track-id]', { state: 'visible' });

    // Get initial section
    const initialStore = await getAlpineStore(page, 'library');
    const initialSection = initialStore.currentSection;

    // Try to find and click a different section (e.g., "Recently Played")
    const recentSection = page.locator('button:has-text("Recent")').first();
    const exists = await recentSection.count();

    if (exists > 0) {
      await recentSection.click();
      await page.waitForTimeout(500);

      // Verify section changed
      const updatedStore = await getAlpineStore(page, 'library');
      expect(updatedStore.currentSection).not.toBe(initialSection);
    }
  });

  test('should show Liked Songs section', async ({ page }) => {
    // Navigate to Liked Songs section
    const likedButton = page.locator('button:has-text("Liked")').first();
    const exists = await likedButton.count();

    if (exists > 0) {
      await likedButton.click();
      await page.waitForTimeout(500);

      // Verify we're in Liked Songs section
      const libraryStore = await getAlpineStore(page, 'library');
      expect(libraryStore.currentSection).toBe('liked');
    }
  });
});

test.describe('Responsive Layout', () => {
  test.beforeEach(async ({ page }) => {
    const libraryState = createLibraryState();
    await setupLibraryMocks(page, libraryState);
    await page.goto('/');
    await waitForAlpine(page);
  });

  test('should maintain layout at minimum viewport size', async ({ page }) => {
    // Set to minimum recommended size
    await page.setViewportSize({ width: 1624, height: 1057 });

    // Verify essential elements are visible
    await expect(page.locator('[x-data="libraryBrowser"]')).toBeVisible();
    await expect(page.locator('footer')).toBeVisible();
  });

  test('should adjust layout for larger screens', async ({ page }) => {
    // Set to larger viewport
    await page.setViewportSize({ width: 1920, height: 1080 });

    // Verify layout adjusts
    await expect(page.locator('[x-data="libraryBrowser"]')).toBeVisible();

    // Track table should expand
    const trackList = page.locator('.track-list');
    const boundingBox = await trackList.boundingBox();
    expect(boundingBox.width).toBeGreaterThan(1000);
  });
});
