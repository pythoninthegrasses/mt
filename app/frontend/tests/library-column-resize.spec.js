import { expect, test } from '@playwright/test';
import { waitForAlpine } from './fixtures/helpers.js';
import { createLibraryState, setupLibraryMocks } from './fixtures/mock-library.js';
import { clearColumnSettings, setColumnSettings } from './fixtures/column-settings.js';

test.describe('Column Resize and Layout', () => {
  test.beforeEach(async ({ page }) => {
    const libraryState = createLibraryState();
    await setupLibraryMocks(page, libraryState);
    await page.goto('/');
    await waitForAlpine(page);
    await page.waitForSelector('[x-data="libraryBrowser"]', { state: 'visible' });
    await page.waitForSelector('[data-track-id]', { state: 'visible' });

    await clearColumnSettings(page);
  });

  test('should show resize cursor on column header edge', async ({ page }) => {
    const resizeHandle = page.locator('[data-testid="col-resizer-right-artist"]');

    await expect(resizeHandle).toBeVisible();

    const cursor = await resizeHandle.evaluate((el) => window.getComputedStyle(el).cursor);
    expect(cursor).toBe('col-resize');
  });

  test('should resize column by dragging', async ({ page }) => {
    const resizeHandle = page.locator('[data-testid="col-resizer-right-artist"]');

    await expect(resizeHandle).toBeVisible();
    const handleBox = await resizeHandle.boundingBox();

    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(handleBox.x + 50, handleBox.y + handleBox.height / 2);
    await page.mouse.up();

    await page.waitForTimeout(100);

    const componentData = await page.evaluate(() => {
      const el = document.querySelector('[x-data="libraryBrowser"]');
      return window.Alpine.$data(el);
    });

    expect(componentData.columnWidths.artist).toBeDefined();
  });

  test('should auto-fit column width on double-click', async ({ page }) => {
    const resizeHandle = page.locator('[data-testid="col-resizer-right-artist"]');

    await expect(resizeHandle).toBeVisible();
    await resizeHandle.dblclick();
    await page.waitForTimeout(100);

    const componentData = await page.evaluate(() => {
      const el = document.querySelector('[x-data="libraryBrowser"]');
      return window.Alpine.$data(el);
    });

    expect(componentData.columnWidths.artist).toBeDefined();
  });

  test('should auto-fit column to content width and adjust neighbor', async ({ page }) => {
    await setColumnSettings(page, {
      widths: { title: 200, artist: 300, album: 300 },
      visibility: {},
      order: ['index', 'title', 'artist', 'album', 'duration'],
    });
    await page.reload();
    await waitForAlpine(page);
    await page.waitForSelector('[data-track-id]', { state: 'visible' });

    const initialBaseWidths = await page.evaluate(() => {
      const el = document.querySelector('[x-data="libraryBrowser"]');
      const data = window.Alpine.$data(el);
      return { title: data._baseColumnWidths.title, artist: data._baseColumnWidths.artist };
    });

    const resizer = page.locator('[data-testid="col-resizer-right-title"]');
    await resizer.dblclick();
    await page.waitForTimeout(150);

    const afterBaseWidths = await page.evaluate(() => {
      const el = document.querySelector('[x-data="libraryBrowser"]');
      const data = window.Alpine.$data(el);
      return { title: data._baseColumnWidths.title, artist: data._baseColumnWidths.artist };
    });

    // Auto-fit changes the title width to match content (could increase or decrease)
    expect(afterBaseWidths.title).not.toEqual(initialBaseWidths.title);
    // Title width should be reasonable (between min width and some max)
    expect(afterBaseWidths.title).toBeGreaterThanOrEqual(120); // Minimum column width
    expect(afterBaseWidths.title).toBeLessThanOrEqual(800); // Reasonable maximum
  });

  test('should auto-fit Artist column to content width', async ({ page }) => {
    await setColumnSettings(page, {
      widths: { artist: 50, album: 400 },
      visibility: {},
      order: ['index', 'title', 'artist', 'album', 'duration'],
    });
    await page.reload();
    await waitForAlpine(page);
    await page.waitForSelector('[data-track-id]', { state: 'visible' });

    const artistHeader = page.locator('[data-testid="library-header"] > div').filter({
      hasText: 'Artist',
    }).first();

    // Double-click to auto-fit
    const resizer = page.locator('[data-testid="col-resizer-right-artist"]');
    await resizer.dblclick();
    await page.waitForTimeout(150);

    // Verify width changed to match content (could increase or decrease depending on redistribution)
    const afterWidth = await artistHeader.evaluate((el) => el.getBoundingClientRect().width);
    // Auto-fit should set width based on content - verify it's within reasonable bounds
    expect(afterWidth).toBeGreaterThanOrEqual(120); // Minimum column width
    expect(afterWidth).toBeLessThanOrEqual(600); // Reasonable maximum for artist names
  });

  test('should auto-fit Album column to content width', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 600 });
    await setColumnSettings(page, {
      widths: { album: 50, duration: 100 },
      visibility: {},
      order: ['index', 'title', 'artist', 'album', 'duration'],
    });
    await page.reload();
    await waitForAlpine(page);
    await page.waitForSelector('[data-track-id]', { state: 'visible' });

    const albumHeader = page.locator('[data-testid="library-header"] > div').filter({
      hasText: 'Album',
    }).first();

    const resizer = page.locator('[data-testid="col-resizer-right-album"]');
    await resizer.dblclick();
    await page.waitForTimeout(150);

    // Verify auto-fit sets width based on content (within reasonable bounds)
    const afterWidth = await albumHeader.evaluate((el) => el.getBoundingClientRect().width);
    expect(afterWidth).toBeGreaterThanOrEqual(30); // Minimum visible width
    expect(afterWidth).toBeLessThanOrEqual(400); // Reasonable maximum for album names
  });

  test('should reduce text overflow on auto-fit when possible', async ({ page }) => {
    // Set up very narrow Artist with very wide Album (plenty of space to take)
    await setColumnSettings(page, {
      widths: { artist: 30, album: 500 },
      visibility: {},
      order: ['index', 'title', 'artist', 'album', 'duration'],
    });
    await page.reload();
    await waitForAlpine(page);
    await page.waitForSelector('[data-track-id]', { state: 'visible' });

    const artistCell = page.locator('[data-column="artist"]').first();

    // Get overflow amount before (scrollWidth - clientWidth)
    const beforeOverflowAmount = await artistCell.evaluate((el) => {
      return el.scrollWidth - el.clientWidth;
    });

    // Double-click to auto-fit
    const resizer = page.locator('[data-testid="col-resizer-right-artist"]');
    await resizer.dblclick();
    await page.waitForTimeout(150);

    // Get overflow amount after
    const afterOverflowAmount = await artistCell.evaluate((el) => {
      return el.scrollWidth - el.clientWidth;
    });

    // Overflow should be reduced (ideally to 0, but at minimum less than before)
    expect(afterOverflowAmount).toBeLessThanOrEqual(beforeOverflowAmount);
  });

  test('no horizontal scroll when vertical scrollbar is present @1800x1259', async ({ page }) => {
    await page.setViewportSize({ width: 1800, height: 1259 });
    await clearColumnSettings(page);
    await page.reload();
    await waitForAlpine(page);
    await page.waitForSelector('[data-track-id]', { state: 'visible' });
    await page.waitForTimeout(300);

    const overflow = await page.evaluate(() => {
      const container = document.querySelector('[x-ref="scrollContainer"]');
      return {
        overflow: container.scrollWidth - container.clientWidth,
        hasVerticalScroll: container.scrollHeight > container.clientHeight,
      };
    });

    expect(overflow.hasVerticalScroll).toBe(true);
    expect(overflow.overflow).toBeLessThanOrEqual(2);
  });

  test('no horizontal scroll when vertical scrollbar is present @2400x1260', async ({ page }) => {
    await page.setViewportSize({ width: 2400, height: 1260 });
    await clearColumnSettings(page);
    await page.reload();
    await waitForAlpine(page);
    await page.waitForSelector('[data-track-id]', { state: 'visible' });
    await page.waitForTimeout(300);

    const overflow = await page.evaluate(() => {
      const container = document.querySelector('[x-ref="scrollContainer"]');
      return {
        overflow: container.scrollWidth - container.clientWidth,
        hasVerticalScroll: container.scrollHeight > container.clientHeight,
      };
    });

    expect(overflow.hasVerticalScroll).toBe(true);
    expect(overflow.overflow).toBeLessThanOrEqual(2);
  });

  test('no horizontal scroll after window resize @2400x1260 -> @1800x1260', async ({ page }) => {
    await page.setViewportSize({ width: 2400, height: 1260 });
    await clearColumnSettings(page);
    await page.reload();
    await waitForAlpine(page);
    await page.waitForSelector('[data-track-id]', { state: 'visible' });
    await page.waitForTimeout(300);

    await page.setViewportSize({ width: 1800, height: 1260 });
    await page.waitForTimeout(500);

    const overflow = await page.evaluate(() => {
      const container = document.querySelector('[x-ref="scrollContainer"]');
      return container.scrollWidth - container.clientWidth;
    });

    expect(overflow).toBeLessThanOrEqual(2);
  });

  test('no horizontal scroll when base widths exceed container', async ({ page }) => {
    await page.setViewportSize({ width: 1800, height: 1259 });
    await setColumnSettings(page, {
      widths: { title: 800, artist: 500, album: 500 },
      visibility: {},
      order: ['index', 'title', 'artist', 'album', 'duration'],
    });
    await page.reload();
    await waitForAlpine(page);
    await page.waitForSelector('[data-track-id]', { state: 'visible' });
    await page.waitForTimeout(300);

    const overflow = await page.evaluate(() => {
      const container = document.querySelector('[x-ref="scrollContainer"]');
      return container.scrollWidth - container.clientWidth;
    });

    expect(overflow).toBeLessThanOrEqual(2);
  });

  test('no horizontal scroll with Tauri fractional pixel widths', async ({ page }) => {
    await page.setViewportSize({ width: 1800, height: 1259 });
    await setColumnSettings(page, {
      widths: {
        index: 40.0625,
        title: 344.69921875,
        artist: 377.8193359375,
        album: 390.845703125,
        lastPlayed: 120,
        dateAdded: 120,
        playCount: 60,
        duration: 405.5732421875,
      },
      visibility: {
        index: true,
        title: true,
        artist: true,
        album: true,
        lastPlayed: true,
        dateAdded: true,
        playCount: true,
        duration: true,
      },
      order: [
        'index',
        'title',
        'artist',
        'album',
        'lastPlayed',
        'dateAdded',
        'playCount',
        'duration',
      ],
    });
    await page.reload();
    await waitForAlpine(page);
    await page.waitForSelector('[data-track-id]', { state: 'visible' });
    await page.waitForTimeout(300);

    const overflow = await page.evaluate(() => {
      const container = document.querySelector('[x-ref="scrollContainer"]');
      return container.scrollWidth - container.clientWidth;
    });

    expect(overflow).toBeLessThanOrEqual(2);
  });

  test('columns should fill container width on initial load (RTC-style distribution)', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });

    await clearColumnSettings(page);
    await page.reload();
    await waitForAlpine(page);
    await page.waitForSelector('[data-track-id]', { state: 'visible' });

    // Wait for any distribution to complete
    await page.waitForTimeout(300);

    // Get container width
    const containerWidth = await page.evaluate(() => {
      const container = document.querySelector('[x-ref="scrollContainer"]');
      return container.clientWidth;
    });

    // Get sum of all column widths from the component state
    const columnData = await page.evaluate(() => {
      const el = document.querySelector('[x-data="libraryBrowser"]');
      const data = window.Alpine.$data(el);
      const columns = data.columns;
      let totalWidth = 0;
      columns.forEach((col) => {
        const width = data.columnWidths[col.key] || 100;
        totalWidth += width;
      });
      return { totalWidth, columnWidths: data.columnWidths, containerWidth: data.containerWidth };
    });

    // The total column width should be at least the container width (no gap)
    // Allow 2px tolerance for rounding
    expect(columnData.totalWidth).toBeGreaterThanOrEqual(containerWidth - 2);

    // Also verify visually: header should span the container
    const header = page.locator('[data-testid="library-header"]');
    const headerBox = await header.boundingBox();
    const scrollContainer = page.locator('[x-ref="scrollContainer"]');
    const containerBox = await scrollContainer.boundingBox();

    // Header width should be >= container width (accounting for scrollbar ~15px)
    expect(headerBox.width).toBeGreaterThanOrEqual(containerBox.width - 20);
  });

  test('auto-fit Artist should persist width (no flash-and-revert)', async ({ page }) => {
    await setColumnSettings(page, {
      widths: { artist: 80, album: 300 },
      visibility: {},
      order: ['index', 'title', 'artist', 'album', 'duration'],
    });
    await page.reload();
    await waitForAlpine(page);
    await page.waitForSelector('[data-track-id]', { state: 'visible' });

    const artistHeader = page.locator('[data-testid="library-header"] > div').filter({
      hasText: 'Artist',
    }).first();

    await page.locator('[data-testid="col-resizer-right-artist"]').dblclick();
    await page.waitForTimeout(500);

    // Get width after auto-fit
    const afterWidth = await artistHeader.evaluate((el) => el.getBoundingClientRect().width);
    // Auto-fit should produce a reasonable width
    expect(afterWidth).toBeGreaterThanOrEqual(120); // Minimum column width
    expect(afterWidth).toBeLessThanOrEqual(600); // Reasonable maximum

    // Wait a bit more and verify width is stable (no flash-and-revert)
    await page.waitForTimeout(300);
    const stableWidth = await artistHeader.evaluate((el) => el.getBoundingClientRect().width);
    // Width should remain the same (no revert)
    expect(stableWidth).toBeCloseTo(afterWidth, 0);
  });

  test('auto-fit Album should persist width (no flash-and-revert)', async ({ page }) => {
    await setColumnSettings(page, {
      widths: { album: 80, duration: 100 },
      visibility: {},
      order: ['index', 'title', 'artist', 'album', 'duration'],
    });
    await page.reload();
    await waitForAlpine(page);
    await page.waitForSelector('[data-track-id]', { state: 'visible' });

    const albumHeader = page.locator('[data-testid="library-header"] > div').filter({
      hasText: 'Album',
    }).first();

    await page.locator('[data-testid="col-resizer-right-album"]').dblclick();
    await page.waitForTimeout(500);

    // Get width after auto-fit
    const afterWidth = await albumHeader.evaluate((el) => el.getBoundingClientRect().width);
    // Auto-fit should produce a reasonable width
    expect(afterWidth).toBeGreaterThanOrEqual(30); // Minimum visible width
    expect(afterWidth).toBeLessThanOrEqual(400); // Reasonable maximum for album names

    // Wait a bit more and verify width is stable (no flash-and-revert)
    await page.waitForTimeout(300);
    const stableWidth = await albumHeader.evaluate((el) => el.getBoundingClientRect().width);
    // Width should remain the same (no revert)
    expect(stableWidth).toBeCloseTo(afterWidth, 0);
  });

  test('manual resize Artist should not expand Title temporarily', async ({ page }) => {
    await setColumnSettings(page, {
      widths: { title: 320, artist: 180, album: 180 },
      visibility: {},
      order: ['index', 'title', 'artist', 'album', 'duration'],
    });
    await page.reload();
    await waitForAlpine(page);
    await page.waitForSelector('[data-track-id]', { state: 'visible' });

    const getBaseTitleWidth = () =>
      page.evaluate(() => {
        const el = document.querySelector('[x-data="libraryBrowser"]');
        return window.Alpine.$data(el)._baseColumnWidths.title;
      });

    const initialTitleWidth = await getBaseTitleWidth();

    const handle = page.locator('[data-testid="col-resizer-right-artist"]');
    const box = await handle.boundingBox();

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();

    await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2);

    const titleWidthDuringDrag = await getBaseTitleWidth();
    expect(titleWidthDuringDrag).toBe(initialTitleWidth);

    await page.mouse.up();
    await page.waitForTimeout(150);

    const titleWidthAfterDrag = await getBaseTitleWidth();
    expect(titleWidthAfterDrag).toBe(initialTitleWidth);
  });

  test('manual resize Album from right border should grow Album base width', async ({ page }) => {
    await setColumnSettings(page, {
      widths: { title: 320, artist: 180, album: 180, duration: 40 },
      visibility: {},
      order: ['index', 'title', 'artist', 'album', 'duration'],
    });
    await page.reload();
    await waitForAlpine(page);
    await page.waitForSelector('[data-track-id]', { state: 'visible' });

    const getBaseWidths = () =>
      page.evaluate(() => {
        const el = document.querySelector('[x-data="libraryBrowser"]');
        const data = window.Alpine.$data(el);
        return { title: data._baseColumnWidths.title, album: data._baseColumnWidths.album };
      });

    const before = await getBaseWidths();

    const handle = page.locator('[data-testid="col-resizer-right-album"]');
    const box = await handle.boundingBox();

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2);
    await page.mouse.up();
    await page.waitForTimeout(150);

    const after = await getBaseWidths();

    expect(after.title).toBe(before.title);
    expect(after.album).toBeGreaterThan(before.album);
  });

  test('table rows should span full container width (no gap before scrollbar)', async ({ page }) => {
    await clearColumnSettings(page);
    await page.reload();
    await waitForAlpine(page);
    await page.waitForSelector('[data-track-id]', { state: 'visible' });

    const scrollContainer = page.locator('[x-ref="scrollContainer"]');
    const header = page.locator('[data-testid="library-header"]');
    const firstRow = page.locator('[data-track-id]').first();

    const containerWidth = await scrollContainer.evaluate((el) => el.clientWidth);
    const headerWidth = await header.evaluate((el) => el.scrollWidth);
    const rowWidth = await firstRow.evaluate((el) => el.scrollWidth);

    expect(headerWidth).toBeGreaterThanOrEqual(containerWidth);
    expect(rowWidth).toBeGreaterThanOrEqual(containerWidth);
  });

  test('table rows should span full width after auto-fit narrows columns', async ({ page }) => {
    await setColumnSettings(page, {
      widths: { title: 500, artist: 300, album: 300 },
      visibility: {},
      order: ['index', 'title', 'artist', 'album', 'duration'],
    });
    await page.reload();
    await waitForAlpine(page);
    await page.waitForSelector('[data-track-id]', { state: 'visible' });

    // Auto-fit Title (should shrink it to content width)
    await page.locator('[data-testid="col-resizer-right-title"]').dblclick();
    await page.waitForTimeout(200);

    // Auto-fit Artist
    await page.locator('[data-testid="col-resizer-right-artist"]').dblclick();
    await page.waitForTimeout(200);

    const scrollContainer = page.locator('[x-ref="scrollContainer"]');
    const header = page.locator('[data-testid="library-header"]');
    const firstRow = page.locator('[data-track-id]').first();

    const containerWidth = await scrollContainer.evaluate((el) => el.clientWidth);
    const headerWidth = await header.evaluate((el) => el.scrollWidth);
    const rowWidth = await firstRow.evaluate((el) => el.scrollWidth);

    // Even after auto-fit shrinks columns, they should still span container
    expect(headerWidth).toBeGreaterThanOrEqual(containerWidth);
    expect(rowWidth).toBeGreaterThanOrEqual(containerWidth);
  });

  test('should not flash column drag state on single click', async ({ page }) => {
    const titleHeader = page.locator('[data-testid="library-header"] > div').filter({
      hasText: 'Title',
    }).first();

    const hasDraggingBefore = await page.evaluate(() => {
      const el = document.querySelector('[x-data="libraryBrowser"]');
      return window.Alpine.$data(el).draggingColumnKey;
    });
    expect(hasDraggingBefore).toBeNull();

    await titleHeader.click();
    await page.waitForTimeout(50);

    const hasDraggingAfter = await page.evaluate(() => {
      const el = document.querySelector('[x-data="libraryBrowser"]');
      return window.Alpine.$data(el).draggingColumnKey;
    });
    expect(hasDraggingAfter).toBeNull();
  });

  test('should not trigger sort when resizing column', async ({ page }) => {
    const resizeHandle = page.locator('[data-testid="col-resizer-right-artist"]');

    await expect(resizeHandle).toBeVisible();
    const handleBox = await resizeHandle.boundingBox();

    const initialSortBy = await page.evaluate(() => {
      return window.Alpine.store('library').sortBy;
    });

    // Use dispatchEvent to trigger mousedown on the resizer element
    await resizeHandle.dispatchEvent('mousedown', { bubbles: true });

    // Verify resizingColumn is set during drag
    const resizingDuringDrag = await page.evaluate(() => {
      const el = document.querySelector('[x-data="libraryBrowser"]');
      return window.Alpine.$data(el).resizingColumn;
    });
    expect(resizingDuringDrag).toBe('artist');

    // Move mouse to simulate drag (into Album column area)
    await page.mouse.move(handleBox.x + 50, handleBox.y + handleBox.height / 2);

    // Trigger mouseup on document (simulates releasing mouse)
    await page.evaluate(() => {
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });

    await page.waitForTimeout(150);

    const finalSortBy = await page.evaluate(() => {
      return window.Alpine.store('library').sortBy;
    });

    expect(finalSortBy).toBe(initialSortBy);
  });

  test('should resize previous column when dragging left border (Excel behavior)', async ({ page }) => {
    const leftResizer = page.locator('[data-testid="col-resizer-left-artist"]');

    await expect(leftResizer).toBeVisible();

    const initialTitleWidth = await page.evaluate(() => {
      const el = document.querySelector('[x-data="libraryBrowser"]');
      return window.Alpine.$data(el).columnWidths.title;
    });

    const handleBox = await leftResizer.boundingBox();

    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(handleBox.x - 50, handleBox.y + handleBox.height / 2);
    await page.mouse.up();

    await page.waitForTimeout(100);

    const componentData = await page.evaluate(() => {
      const el = document.querySelector('[x-data="libraryBrowser"]');
      return window.Alpine.$data(el);
    });

    expect(componentData._baseColumnWidths.title).toBeLessThan(initialTitleWidth);
  });
});
