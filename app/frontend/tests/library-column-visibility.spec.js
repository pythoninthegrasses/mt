import { expect, test } from '@playwright/test';
import { waitForAlpine } from './fixtures/helpers.js';
import { createLibraryState, setupLibraryMocks } from './fixtures/mock-library.js';
import { clearColumnSettings, setColumnSettings } from './fixtures/column-settings.js';

test.describe('Column Visibility and Settings', () => {
  test.beforeEach(async ({ page }) => {
    const libraryState = createLibraryState();
    await setupLibraryMocks(page, libraryState);
    await page.goto('/');
    await waitForAlpine(page);
    await page.waitForSelector('[x-data="libraryBrowser"]', { state: 'visible' });
    await page.waitForSelector('[data-track-id]', { state: 'visible' });

    await clearColumnSettings(page);
  });

  test('should show header context menu on right-click', async ({ page }) => {
    const headerRow = page.locator('[data-testid="library-header"]');
    await expect(headerRow).toBeVisible();
    await headerRow.click({ button: 'right' });

    await page.waitForSelector('.header-context-menu', { state: 'visible', timeout: 5000 });

    const contextMenu = page.locator('.header-context-menu');
    await expect(contextMenu).toBeVisible();

    const showColumnsText = page.locator('text=Show Columns');
    await expect(showColumnsText).toBeVisible();
  });

  test('should toggle column visibility from context menu', async ({ page }) => {
    const headerRow = page.locator('[data-testid="library-header"]');
    await headerRow.click({ button: 'right' });
    await page.waitForSelector('.header-context-menu', { state: 'visible', timeout: 5000 });

    const albumMenuItem = page.locator('.header-context-menu .context-menu-item:has-text("Album")');
    await albumMenuItem.click();

    await page.waitForTimeout(100);

    const componentData = await page.evaluate(() => {
      const el = document.querySelector('[x-data="libraryBrowser"]');
      return window.Alpine.$data(el);
    });

    expect(componentData.columnVisibility.album).toBe(false);

    const albumColumn = page.locator('[data-column="album"]').first();
    await expect(albumColumn).not.toBeVisible();
  });

  test('should prevent hiding all columns', async ({ page }) => {
    await page.evaluate(() => {
      const el = document.querySelector('[x-data="libraryBrowser"]');
      const data = window.Alpine.$data(el);

      data.columnVisibility.artist = false;
      data.columnVisibility.album = false;
      data.columnVisibility.duration = false;
    });

    const headerRow = page.locator('[data-testid="library-header"]');
    await headerRow.click({ button: 'right' });
    await page.waitForSelector('.header-context-menu', { state: 'visible', timeout: 5000 });

    const visibleColumns = await page.evaluate(() => {
      const el = document.querySelector('[x-data="libraryBrowser"]');
      const data = window.Alpine.$data(el);
      return data.visibleColumnCount;
    });

    expect(visibleColumns).toBeGreaterThanOrEqual(2);
  });

  test('should update column visibility state when hiding via context menu', async ({ page }) => {
    const headerRow = page.locator('[data-testid="library-header"]');
    await headerRow.click({ button: 'right' });
    await page.waitForSelector('.header-context-menu', { state: 'visible', timeout: 5000 });

    const albumMenuItem = page.locator('.header-context-menu .context-menu-item:has-text("Album")');
    await albumMenuItem.click();
    await page.waitForTimeout(100);

    // Verify in-session state update (component stores in memory)
    // Note: In Tauri mode this also persists via window.settings; in browser mode it's in-memory only
    const componentData = await page.evaluate(() => {
      const el = document.querySelector('[x-data="libraryBrowser"]');
      return window.Alpine.$data(el);
    });

    expect(componentData.columnVisibility).toBeTruthy();
    expect(componentData.columnVisibility.album).toBe(false);
  });

  test('should restore column settings on page reload', async ({ page }) => {
    await setColumnSettings(page, {
      widths: { artist: 200 },
      visibility: { album: false },
    });

    await page.reload();
    await waitForAlpine(page);
    await page.waitForSelector('[x-data="libraryBrowser"]', { state: 'visible' });

    const componentData = await page.evaluate(() => {
      const el = document.querySelector('[x-data="libraryBrowser"]');
      return window.Alpine.$data(el);
    });

    expect(componentData.columnWidths.artist).toBeGreaterThanOrEqual(200);
    expect(componentData.columnVisibility.album).toBe(false);
  });

  test('should enforce minimum column width', async ({ page }) => {
    const titleResizer = page.locator('[data-testid="col-resizer-right-title"]');

    await expect(titleResizer).toBeVisible();
    const handleBox = await titleResizer.boundingBox();

    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(handleBox.x - 300, handleBox.y + handleBox.height / 2);
    await page.mouse.up();

    await page.waitForTimeout(100);

    const componentData = await page.evaluate(() => {
      const el = document.querySelector('[x-data="libraryBrowser"]');
      return window.Alpine.$data(el);
    });

    expect(componentData.columnWidths.title).toBeGreaterThanOrEqual(120);
  });

  test('should reset column widths from context menu', async ({ page }) => {
    await setColumnSettings(page, {
      widths: { artist: 300, album: 300 },
      visibility: {},
    });

    await page.reload();
    await waitForAlpine(page);
    await page.waitForSelector('[x-data="libraryBrowser"]', { state: 'visible' });

    const headerRow = page.locator('[data-testid="library-header"]');
    await headerRow.click({ button: 'right' });
    await page.waitForSelector('.header-context-menu', { state: 'visible', timeout: 5000 });

    const resetMenuItem = page.locator(
      '.header-context-menu .context-menu-item:has-text("Reset Columns to Defaults")',
    );
    await resetMenuItem.click();

    await page.waitForTimeout(100);

    const componentData = await page.evaluate(() => {
      const el = document.querySelector('[x-data="libraryBrowser"]');
      return window.Alpine.$data(el);
    });

    expect(componentData.columnWidths.artist).toBeGreaterThanOrEqual(180);
  });

  test('should show all columns from context menu', async ({ page }) => {
    await setColumnSettings(page, {
      widths: {},
      visibility: { album: false, artist: false },
    });

    await page.reload();
    await waitForAlpine(page);
    await page.waitForSelector('[x-data="libraryBrowser"]', { state: 'visible' });

    const headerRow = page.locator('[data-testid="library-header"]');
    await headerRow.click({ button: 'right' });
    await page.waitForSelector('.header-context-menu', { state: 'visible', timeout: 5000 });

    const showAllMenuItem = page.locator(
      '.header-context-menu .context-menu-item:has-text("Show All Columns")',
    );
    await showAllMenuItem.click();

    await page.waitForTimeout(100);

    const componentData = await page.evaluate(() => {
      const el = document.querySelector('[x-data="libraryBrowser"]');
      return window.Alpine.$data(el);
    });

    expect(componentData.columnVisibility.album).toBe(true);
    expect(componentData.columnVisibility.artist).toBe(true);
  });

  test('should reorder columns by dragging', async ({ page }) => {
    const headerRow = page.locator('[data-testid="library-header"]');
    await expect(headerRow).toBeVisible();

    const initialOrder = await page.evaluate(() => {
      const el = document.querySelector('[x-data="libraryBrowser"]');
      return window.Alpine.$data(el).columns.map((c) => c.key);
    });

    expect(initialOrder).toContain('artist');
    expect(initialOrder).toContain('album');
    const artistIdx = initialOrder.indexOf('artist');
    const albumIdx = initialOrder.indexOf('album');
    expect(artistIdx).toBeLessThan(albumIdx);

    const artistHeader = headerRow.locator('div').filter({ hasText: 'Artist' }).first();
    const albumHeader = headerRow.locator('div').filter({ hasText: 'Album' }).first();

    const artistBox = await artistHeader.boundingBox();
    const albumBox = await albumHeader.boundingBox();

    await page.mouse.move(artistBox.x + artistBox.width / 2, artistBox.y + artistBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(albumBox.x + albumBox.width - 10, albumBox.y + albumBox.height / 2, {
      steps: 5,
    });
    await page.mouse.up();

    await page.waitForTimeout(100);

    const newOrder = await page.evaluate(() => {
      const el = document.querySelector('[x-data="libraryBrowser"]');
      return window.Alpine.$data(el).columns.map((c) => c.key);
    });

    const newArtistIdx = newOrder.indexOf('artist');
    const newAlbumIdx = newOrder.indexOf('album');
    expect(newArtistIdx).toBeGreaterThan(newAlbumIdx);
  });

  test('should not overshoot when dragging column back to original position', async ({ page }) => {
    const headerRow = page.locator('[data-testid="library-header"]');
    await expect(headerRow).toBeVisible();

    // Get initial order: [#, Title, Artist, Album, Time]
    const initialOrder = await page.evaluate(() => {
      const el = document.querySelector('[x-data="libraryBrowser"]');
      return window.Alpine.$data(el).columns.map((c) => c.key);
    });

    const initialArtistIdx = initialOrder.indexOf('artist');
    const initialAlbumIdx = initialOrder.indexOf('album');
    expect(initialArtistIdx).toBeLessThan(initialAlbumIdx);

    // Step 1: Drag Album left to swap with Artist
    const albumHeader1 = headerRow.locator('div').filter({ hasText: 'Album' }).first();
    const artistHeader1 = headerRow.locator('div').filter({ hasText: 'Artist' }).first();

    const albumBox1 = await albumHeader1.boundingBox();
    const artistBox1 = await artistHeader1.boundingBox();

    await page.mouse.move(albumBox1.x + albumBox1.width / 2, albumBox1.y + albumBox1.height / 2);
    await page.mouse.down();
    await page.mouse.move(artistBox1.x + 10, artistBox1.y + artistBox1.height / 2, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(100);

    // Verify Album is now before Artist: [#, Title, Album, Artist, Time]
    const orderAfterStep1 = await page.evaluate(() => {
      const el = document.querySelector('[x-data="libraryBrowser"]');
      return window.Alpine.$data(el).columns.map((c) => c.key);
    });
    const albumIdxStep1 = orderAfterStep1.indexOf('album');
    const artistIdxStep1 = orderAfterStep1.indexOf('artist');
    expect(albumIdxStep1).toBeLessThan(artistIdxStep1);

    // Step 2: Drag Album back right to swap with Artist (return to original position)
    // This tests the bug fix - Album should not overshoot and jump over Time
    const albumHeader2 = headerRow.locator('div').filter({ hasText: 'Album' }).first();
    const artistHeader2 = headerRow.locator('div').filter({ hasText: 'Artist' }).first();

    const albumBox2 = await albumHeader2.boundingBox();
    const artistBox2 = await artistHeader2.boundingBox();

    await page.mouse.move(albumBox2.x + albumBox2.width / 2, albumBox2.y + albumBox2.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      artistBox2.x + artistBox2.width - 10,
      artistBox2.y + artistBox2.height / 2,
      { steps: 5 },
    );
    await page.mouse.up();
    await page.waitForTimeout(100);

    // Verify we're back to original order: [#, Title, Artist, Album, Time]
    // Album should be right after Artist, NOT after Time (which would be overshooting)
    const finalOrder = await page.evaluate(() => {
      const el = document.querySelector('[x-data="libraryBrowser"]');
      return window.Alpine.$data(el).columns.map((c) => c.key);
    });

    const finalArtistIdx = finalOrder.indexOf('artist');
    const finalAlbumIdx = finalOrder.indexOf('album');
    const finalDurationIdx = finalOrder.indexOf('duration');

    // Artist should be before Album
    expect(finalArtistIdx).toBeLessThan(finalAlbumIdx);
    // Album should be before Time/Duration (not after it - that would be overshooting)
    expect(finalAlbumIdx).toBeLessThan(finalDurationIdx);
    // Verify exact positions: Artist at original-1, Album at original (since we moved left then right)
    expect(finalAlbumIdx - finalArtistIdx).toBe(1);
  });

  test('should persist column order to localStorage', async ({ page }) => {
    await setColumnSettings(page, {
      widths: {},
      visibility: {},
      order: ['index', 'title', 'album', 'artist', 'duration'],
    });

    await page.reload();
    await waitForAlpine(page);
    await page.waitForSelector('[x-data="libraryBrowser"]', { state: 'visible' });

    const columnOrder = await page.evaluate(() => {
      const el = document.querySelector('[x-data="libraryBrowser"]');
      return window.Alpine.$data(el).columns.map((c) => c.key);
    });

    const albumIdx = columnOrder.indexOf('album');
    const artistIdx = columnOrder.indexOf('artist');
    expect(albumIdx).toBeLessThan(artistIdx);
  });

  test('should reset column order when using Reset Columns to Defaults', async ({ page }) => {
    // Set custom column order (album before artist)
    await setColumnSettings(page, {
      widths: {},
      visibility: {},
      order: ['index', 'title', 'album', 'artist', 'duration'],
    });

    await page.reload();
    await waitForAlpine(page);
    await page.waitForSelector('[x-data="libraryBrowser"]', { state: 'visible' });

    // Verify custom order is applied
    const customOrder = await page.evaluate(() => {
      const el = document.querySelector('[x-data="libraryBrowser"]');
      return window.Alpine.$data(el).columns.map((c) => c.key);
    });
    const albumIdxBefore = customOrder.indexOf('album');
    const artistIdxBefore = customOrder.indexOf('artist');
    expect(albumIdxBefore).toBeLessThan(artistIdxBefore);

    // Open context menu and click Reset Columns to Defaults
    page.on('dialog', (dialog) => dialog.accept());

    const headerRow = page.locator('[data-testid="library-header"]');
    await headerRow.click({ button: 'right' });
    await page.waitForSelector('.header-context-menu', { state: 'visible', timeout: 5000 });

    const resetMenuItem = page.locator(
      '.header-context-menu .context-menu-item:has-text("Reset Columns to Defaults")',
    );
    await resetMenuItem.click();
    await page.waitForTimeout(100);

    // Verify order is reset to default (artist before album)
    const resetOrder = await page.evaluate(() => {
      const el = document.querySelector('[x-data="libraryBrowser"]');
      return window.Alpine.$data(el).columns.map((c) => c.key);
    });
    const albumIdxAfter = resetOrder.indexOf('album');
    const artistIdxAfter = resetOrder.indexOf('artist');
    expect(artistIdxAfter).toBeLessThan(albumIdxAfter);
  });

  test('should show visual feedback during column drag', async ({ page }) => {
    const headerRow = page.locator('[data-testid="library-header"]');
    await expect(headerRow).toBeVisible();

    // Get artist header element
    const artistHeader = headerRow.locator('div.column-header-cell').filter({ hasText: 'Artist' })
      .first();
    const albumHeader = headerRow.locator('div.column-header-cell').filter({ hasText: 'Album' })
      .first();

    const artistBox = await artistHeader.boundingBox();

    // Verify no drag state initially
    const initialDragState = await page.evaluate(() => {
      const el = document.querySelector('[x-data="libraryBrowser"]');
      return window.Alpine.$data(el).draggingColumnKey;
    });
    expect(initialDragState).toBeNull();

    // Start drag (mousedown + move to trigger drag state)
    await page.mouse.move(artistBox.x + artistBox.width / 2, artistBox.y + artistBox.height / 2);
    await page.mouse.down();
    // Move more than 5px to trigger drag state
    await page.mouse.move(
      artistBox.x + artistBox.width / 2 + 50,
      artistBox.y + artistBox.height / 2,
      { steps: 3 },
    );

    // Verify dragging state is set
    const draggingKey = await page.evaluate(() => {
      const el = document.querySelector('[x-data="libraryBrowser"]');
      return window.Alpine.$data(el).draggingColumnKey;
    });
    expect(draggingKey).toBe('artist');

    // Verify visual feedback class is applied to dragging column
    const hasDraggingClass = await artistHeader.evaluate((el) =>
      el.classList.contains('dragging-column')
    );
    expect(hasDraggingClass).toBe(true);

    // Verify other columns have other-dragging class
    const hasOtherDraggingClass = await albumHeader.evaluate((el) =>
      el.classList.contains('other-dragging')
    );
    expect(hasOtherDraggingClass).toBe(true);

    // Release mouse
    await page.mouse.up();

    // Verify drag state is cleared
    await page.waitForTimeout(50);
    const finalDragState = await page.evaluate(() => {
      const el = document.querySelector('[x-data="libraryBrowser"]');
      return window.Alpine.$data(el).draggingColumnKey;
    });
    expect(finalDragState).toBeNull();

    // Verify dragging-column class is removed
    const hasDraggingClassAfter = await artistHeader.evaluate((el) =>
      el.classList.contains('dragging-column')
    );
    expect(hasDraggingClassAfter).toBe(false);
  });
});
