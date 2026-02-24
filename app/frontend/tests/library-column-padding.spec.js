import { expect, test } from '@playwright/test';
import { waitForAlpine } from './fixtures/helpers.js';
import { createLibraryState, setupLibraryMocks } from './fixtures/mock-library.js';
import { clearColumnSettings } from './fixtures/column-settings.js';

/**
 * Regression tests for task-135: Column padding consistency fix
 *
 * These tests ensure:
 * - Duration column has correct asymmetric padding (pl-[3px] pr-[10px])
 * - Other non-index columns have consistent px-4 padding
 * - Index column has px-2 padding
 * - Duration column maintains 40px width
 * - Title column fills remaining space without excessive whitespace
 * - Headers remain sticky when scrolling
 */
test.describe('Column Padding Consistency (task-135)', () => {
  test.beforeEach(async ({ page }) => {
    const libraryState = createLibraryState();
    await setupLibraryMocks(page, libraryState);
    await page.goto('/');
    await waitForAlpine(page);
    await page.waitForSelector('[x-data="libraryBrowser"]', { state: 'visible' });
    await page.waitForSelector('[data-track-id]', { state: 'visible' });
  });

  test('should have correct duration column padding (asymmetric pl-3px pr-10px)', async ({ page }) => {
    // Check header duration column padding
    const headerDurationCell = page.locator('[data-testid="library-header"] > div').filter({
      hasText: 'Time',
    }).first();

    const headerPadding = await headerDurationCell.evaluate((el) => {
      const style = window.getComputedStyle(el);
      return {
        paddingLeft: style.paddingLeft,
        paddingRight: style.paddingRight,
      };
    });

    // Duration column should have asymmetric padding: pl-[3px] pr-[10px]
    expect(headerPadding.paddingLeft).toBe('3px');
    expect(headerPadding.paddingRight).toBe('10px');

    // Check data row duration column padding
    const dataDurationCell = page.locator('[data-column="duration"]').first();

    const dataPadding = await dataDurationCell.evaluate((el) => {
      const style = window.getComputedStyle(el);
      return {
        paddingLeft: style.paddingLeft,
        paddingRight: style.paddingRight,
      };
    });

    expect(dataPadding.paddingLeft).toBe('3px');
    expect(dataPadding.paddingRight).toBe('10px');
  });

  test('should have consistent px-4 padding for non-duration, non-index columns', async ({ page }) => {
    // Check Artist column padding (should be px-4 = 16px)
    const artistHeader = page.locator('[data-testid="library-header"] > div').filter({
      hasText: 'Artist',
    }).first();

    const artistPadding = await artistHeader.evaluate((el) => {
      const style = window.getComputedStyle(el);
      return {
        paddingLeft: style.paddingLeft,
        paddingRight: style.paddingRight,
      };
    });

    expect(artistPadding.paddingLeft).toBe('16px');
    expect(artistPadding.paddingRight).toBe('16px');

    // Check Album column padding
    const albumHeader = page.locator('[data-testid="library-header"] > div').filter({
      hasText: 'Album',
    }).first();

    const albumPadding = await albumHeader.evaluate((el) => {
      const style = window.getComputedStyle(el);
      return {
        paddingLeft: style.paddingLeft,
        paddingRight: style.paddingRight,
      };
    });

    expect(albumPadding.paddingLeft).toBe('16px');
    expect(albumPadding.paddingRight).toBe('16px');

    // Check Title column padding
    const titleHeader = page.locator('[data-testid="library-header"] > div').filter({
      hasText: 'Title',
    }).first();

    const titlePadding = await titleHeader.evaluate((el) => {
      const style = window.getComputedStyle(el);
      return {
        paddingLeft: style.paddingLeft,
        paddingRight: style.paddingRight,
      };
    });

    expect(titlePadding.paddingLeft).toBe('16px');
    expect(titlePadding.paddingRight).toBe('16px');
  });

  test('should have px-2 padding for index column', async ({ page }) => {
    // Index column uses px-2 = 8px padding
    const indexHeader = page.locator('[data-testid="library-header"] > div').filter({
      hasText: '#',
    }).first();

    const indexPadding = await indexHeader.evaluate((el) => {
      const style = window.getComputedStyle(el);
      return {
        paddingLeft: style.paddingLeft,
        paddingRight: style.paddingRight,
      };
    });

    expect(indexPadding.paddingLeft).toBe('8px');
    expect(indexPadding.paddingRight).toBe('8px');
  });

  test('should have duration column default width of 52px', async ({ page }) => {
    await clearColumnSettings(page);
    await page.reload();
    await waitForAlpine(page);
    await page.waitForSelector('[x-data="libraryBrowser"]', { state: 'visible' });

    const componentData = await page.evaluate(() => {
      const el = document.querySelector('[x-data="libraryBrowser"]');
      const data = window.Alpine.$data(el);
      return {
        durationWidth: data.columnWidths.duration,
      };
    });

    expect(componentData.durationWidth).toBe(52);
  });

  test('should enforce minimum duration column width of 52px', async ({ page }) => {
    // Try to resize duration column below minimum
    const durationResizer = page.locator('[data-testid="col-resizer-left-duration"]');

    if (await durationResizer.count() > 0) {
      const handleBox = await durationResizer.boundingBox();

      // Drag left to try to shrink the column before duration (Album)
      await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(handleBox.x + 100, handleBox.y + handleBox.height / 2);
      await page.mouse.up();

      await page.waitForTimeout(100);
    }

    // Duration width should not go below 52px
    const componentData = await page.evaluate(() => {
      const el = document.querySelector('[x-data="libraryBrowser"]');
      return window.Alpine.$data(el).columnWidths.duration;
    });

    expect(componentData).toBeGreaterThanOrEqual(52);
  });

  test('should have sticky header that remains visible when scrolling', async ({ page }) => {
    // Verify header has sticky positioning
    const header = page.locator('[data-testid="library-header"]');

    const headerClasses = await header.getAttribute('class');
    expect(headerClasses).toContain('sticky');
    expect(headerClasses).toContain('top-0');
    expect(headerClasses).toContain('z-10');

    // Scroll down and verify header is still in view
    const scrollContainer = page.locator('[x-ref="scrollContainer"]');
    await scrollContainer.evaluate((el) => {
      el.scrollTop = 500;
    });

    await page.waitForTimeout(100);

    // Header should still be visible at top of viewport
    const headerBox = await header.boundingBox();
    const containerBox = await scrollContainer.boundingBox();

    // Header top should be at or near the container top (sticky behavior)
    expect(headerBox.y).toBeLessThanOrEqual(containerBox.y + 5);
  });

  test('should not have excessive whitespace between Time column and scrollbar', async ({ page }) => {
    // Get the Time column header bounding box
    const timeHeader = page.locator('[data-testid="library-header"] > div').filter({
      hasText: 'Time',
    }).first();
    const timeHeaderBox = await timeHeader.boundingBox();

    // Get the scroll container bounding box
    const scrollContainer = page.locator('[x-ref="scrollContainer"]');
    const containerBox = await scrollContainer.boundingBox();

    // Time column should extend close to the right edge
    // Allow for scrollbar width (~15-20px) and small margin
    const gap = containerBox.x + containerBox.width - (timeHeaderBox.x + timeHeaderBox.width);

    // Gap should be reasonable (scrollbar width + small buffer)
    // If excessive whitespace bug exists, gap would be much larger (50px+)
    expect(gap).toBeLessThan(30);
  });

  test('should have Title column fill remaining space dynamically', async ({ page }) => {
    // Resize the viewport to trigger Title column recalculation
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.waitForTimeout(200);

    // Title column should have expanded to fill the larger container
    const titleHeader = page.locator('[data-testid="library-header"] > div').filter({
      hasText: 'Title',
    }).first();
    const titleBox = await titleHeader.boundingBox();

    // Title should be at least 320px (minimum) and expanded with the viewport
    expect(titleBox.width).toBeGreaterThanOrEqual(320);
  });

  test('should have same padding on data rows as header rows', async ({ page }) => {
    // Artist header padding
    const artistHeader = page.locator('[data-testid="library-header"] > div').filter({
      hasText: 'Artist',
    }).first();
    const headerPadding = await artistHeader.evaluate((el) => {
      const style = window.getComputedStyle(el);
      return { left: style.paddingLeft, right: style.paddingRight };
    });

    // Artist data cell padding
    const artistDataCell = page.locator('[data-column="artist"]').first();
    const dataPadding = await artistDataCell.evaluate((el) => {
      const style = window.getComputedStyle(el);
      return { left: style.paddingLeft, right: style.paddingRight };
    });

    // Should have matching padding
    expect(dataPadding.left).toBe(headerPadding.left);
    expect(dataPadding.right).toBe(headerPadding.right);
  });
});
