import { expect, test } from '@playwright/test';
import { clickTrackRow, getAlpineStore, waitForAlpine } from './fixtures/helpers.js';
import { createLibraryState, setupLibraryMocks } from './fixtures/mock-library.js';

test.describe('Sorting', () => {
  test.beforeEach(async ({ page }) => {
    const libraryState = createLibraryState();
    await setupLibraryMocks(page, libraryState);
    await page.goto('/');
    await waitForAlpine(page);
    await page.waitForSelector('[x-data="libraryBrowser"]', { state: 'visible' });
    await page.waitForSelector('[data-track-id]', { state: 'visible' });
  });

  test('should sort tracks by column when clicking header', async ({ page }) => {
    // Find a sortable column header (Title, Artist, Album, etc.)
    const titleHeader = page.locator('text=Title').first();

    // Click to sort
    await titleHeader.click();

    // Wait for sort to complete
    await page.waitForTimeout(300);

    // Verify sort indicator appears
    const libraryStore = await getAlpineStore(page, 'library');
    expect(libraryStore.sortBy).toBeTruthy();
  });

  test('should toggle sort direction on second click', async ({ page }) => {
    const titleHeader = page.locator('text=Title').first();

    // First click - sort ascending
    await titleHeader.click();
    await page.waitForTimeout(300);

    const firstSort = await getAlpineStore(page, 'library');
    const firstDirection = firstSort.sortOrder;

    // Second click - sort descending
    await titleHeader.click();
    await page.waitForTimeout(300);

    const secondSort = await getAlpineStore(page, 'library');
    expect(secondSort.sortOrder).not.toBe(firstDirection);
  });

  test('should show sort indicator on active column', async ({ page }) => {
    const titleHeaderCell = page.locator('[data-testid="library-header"] > div').filter({
      hasText: 'Title',
    }).first();
    await titleHeaderCell.click();
    await page.waitForTimeout(300);

    const headerText = await titleHeaderCell.textContent();
    const hasSortIndicator = headerText.includes('\u25B2') || headerText.includes('\u25BC') ||
      headerText.includes('\u2191') || headerText.includes('\u2193');
    expect(hasSortIndicator).toBe(true);
  });
});

test.describe('Track Selection', () => {
  test.beforeEach(async ({ page }) => {
    const libraryState = createLibraryState();
    await setupLibraryMocks(page, libraryState);
    await page.goto('/');
    await waitForAlpine(page);
    await page.waitForSelector('[data-track-id]', { state: 'visible' });
  });

  test('should select single track on click', async ({ page }) => {
    // Click first track
    await clickTrackRow(page, 0);

    // Verify track is selected (has track-row-selected class)
    const firstTrack = page.locator('[data-track-id]').first();
    const classes = await firstTrack.getAttribute('class');
    expect(classes).toContain('track-row-selected');
  });

  test('should deselect track when clicking elsewhere', async ({ page }) => {
    // Select first track
    await clickTrackRow(page, 0);

    // Click second track (without Cmd/Ctrl)
    await clickTrackRow(page, 1);

    // Verify first track is no longer selected
    const firstTrack = page.locator('[data-track-id]').first();
    const classes = await firstTrack.getAttribute('class');
    expect(classes).not.toContain('track-row-selected');
  });

  test('should select multiple tracks with Cmd+click (Mac) or Ctrl+click', async ({ page }) => {
    // Detect platform
    const isMac = process.platform === 'darwin';
    const modifier = isMac ? 'Meta' : 'Control';

    // Select first track
    await clickTrackRow(page, 0);

    // Cmd/Ctrl+click second track
    await page.keyboard.down(modifier);
    await clickTrackRow(page, 1);
    await page.keyboard.up(modifier);

    // Verify both tracks are selected
    const selectedTracks = page.locator('[data-track-id].track-row-selected');
    const count = await selectedTracks.count();
    expect(count).toBe(2);
  });

  test('should select range with Shift+click', async ({ page }) => {
    // Click first track
    await clickTrackRow(page, 0);

    // Shift+click fourth track
    await page.keyboard.down('Shift');
    await clickTrackRow(page, 3);
    await page.keyboard.up('Shift');

    // Verify tracks 0-3 are selected (4 tracks)
    const selectedTracks = page.locator('[data-track-id].track-row-selected');
    const count = await selectedTracks.count();
    expect(count).toBe(4);
  });

  test('should highlight selected tracks visually', async ({ page }) => {
    await clickTrackRow(page, 0);

    // Verify selected track has different background
    const selectedTrack = page.locator('[data-track-id].track-row-selected').first();
    const backgroundColor = await selectedTrack.evaluate((el) => {
      return window.getComputedStyle(el).backgroundColor;
    });

    // Should have a background color set
    expect(backgroundColor).toBeTruthy();
    expect(backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
  });

  test('should select range with Shift+click in reverse direction', async ({ page }) => {
    // Click fourth track first
    await clickTrackRow(page, 3);

    // Shift+click first track (selecting backwards)
    await page.keyboard.down('Shift');
    await clickTrackRow(page, 0);
    await page.keyboard.up('Shift');

    // Verify tracks 0-3 are selected (4 tracks)
    const selectedTracks = page.locator('[data-track-id].track-row-selected');
    const count = await selectedTracks.count();
    expect(count).toBe(4);
  });

  test('should toggle individual track selection with Cmd+click', async ({ page }) => {
    // Click first track
    await clickTrackRow(page, 0);
    let selectedCount = await page.locator('[data-track-id].track-row-selected').count();
    expect(selectedCount).toBe(1);

    // Cmd+click to add second track
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    await page.keyboard.down(modifier);
    await clickTrackRow(page, 1);
    await page.keyboard.up(modifier);

    selectedCount = await page.locator('[data-track-id].track-row-selected').count();
    expect(selectedCount).toBe(2);

    // Cmd+click first track again to deselect it
    await page.keyboard.down(modifier);
    await clickTrackRow(page, 0);
    await page.keyboard.up(modifier);

    selectedCount = await page.locator('[data-track-id].track-row-selected').count();
    expect(selectedCount).toBe(1);
  });

  test('should handle Shift+click after Cmd+click selection', async ({ page }) => {
    // Cmd+click to select second track (index 1)
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    await page.keyboard.down(modifier);
    await clickTrackRow(page, 1);
    await page.keyboard.up(modifier);

    // Shift+click to select range from track 1 to track 4 (index 3)
    await page.keyboard.down('Shift');
    await clickTrackRow(page, 3);
    await page.keyboard.up('Shift');

    // Should select tracks 1, 2, 3 (3 tracks)
    const selectedTracks = page.locator('[data-track-id].track-row-selected');
    const count = await selectedTracks.count();
    expect(count).toBe(3);
  });

  test('should clear selection on plain click after multi-selection', async ({ page }) => {
    // Select multiple tracks with Cmd+click
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    await clickTrackRow(page, 0);
    await page.keyboard.down(modifier);
    await clickTrackRow(page, 1);
    await clickTrackRow(page, 2);
    await page.keyboard.up(modifier);

    let selectedCount = await page.locator('[data-track-id].track-row-selected').count();
    expect(selectedCount).toBe(3);

    // Plain click on a different track should clear selection and select only that track
    await clickTrackRow(page, 4);

    selectedCount = await page.locator('[data-track-id].track-row-selected').count();
    expect(selectedCount).toBe(1);
  });

  test('should select first track when clicking at start boundary', async ({ page }) => {
    await clickTrackRow(page, 0);

    const selectedTracks = page.locator('[data-track-id].track-row-selected');
    const count = await selectedTracks.count();
    expect(count).toBe(1);

    // Verify it's the first track
    const firstTrackId = await page.locator('[data-track-id]').first().getAttribute(
      'data-track-id',
    );
    const selectedTrackId = await selectedTracks.first().getAttribute('data-track-id');
    expect(selectedTrackId).toBe(firstTrackId);
  });

  test('should deselect one track from select-all with Cmd+click', async ({ page }) => {
    // Select all with Cmd+A
    await page.keyboard.press('Meta+a');

    const totalTracks = await page.locator('[data-track-id]').count();
    let selectedCount = await page.locator('[data-track-id].track-row-selected').count();
    expect(selectedCount).toBe(totalTracks);

    // Cmd+click first track to deselect it
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    await page.keyboard.down(modifier);
    await clickTrackRow(page, 0);
    await page.keyboard.up(modifier);

    selectedCount = await page.locator('[data-track-id].track-row-selected').count();
    expect(selectedCount).toBe(totalTracks - 1);
  });

  test('should maintain selection state across scroll', async ({ page }) => {
    // Select first track
    await clickTrackRow(page, 0);

    // Scroll down
    await page.evaluate(() => {
      const container = document.querySelector('[x-ref="scrollContainer"]');
      if (container) container.scrollTop = container.scrollHeight;
    });
    await page.waitForTimeout(200);

    // Scroll back up
    await page.evaluate(() => {
      const container = document.querySelector('[x-ref="scrollContainer"]');
      if (container) container.scrollTop = 0;
    });
    await page.waitForTimeout(200);

    // Verify first track is still selected
    const selectedCount = await page.locator('[data-track-id].track-row-selected').count();
    expect(selectedCount).toBeGreaterThanOrEqual(1);
  });

  test('should handle non-contiguous selection with multiple Cmd+clicks', async ({ page }) => {
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';

    // Select tracks 0, 2, 4 (non-contiguous)
    await clickTrackRow(page, 0);
    await page.keyboard.down(modifier);
    await clickTrackRow(page, 2);
    await clickTrackRow(page, 4);
    await page.keyboard.up(modifier);

    const selectedCount = await page.locator('[data-track-id].track-row-selected').count();
    expect(selectedCount).toBe(3);
  });
});
