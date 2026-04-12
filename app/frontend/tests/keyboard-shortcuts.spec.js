import { test, expect } from '@playwright/test';
import { waitForAlpine } from './fixtures/helpers.js';
import { createLibraryState, setupLibraryMocks } from './fixtures/mock-library.js';

/**
 * Keyboard Shortcuts — UI Integration Tests (reduced set)
 *
 * Pure shortcut logic (modifier keys, input suppression, volume/seek,
 * escape context handling) is covered by Vitest in __tests__/shortcuts.test.js.
 * These tests verify keyboard events work through the real browser event pipeline.
 */

test.describe('Keyboard Shortcuts Integration', () => {
  test.beforeEach(async ({ page }) => {
    const libraryState = createLibraryState();
    await setupLibraryMocks(page, libraryState);

    await page.goto('/');
    await waitForAlpine(page);
    await page.waitForSelector('[x-data="libraryBrowser"]', { state: 'visible' });
    await page.waitForSelector('[data-track-id]', { state: 'visible' });
  });

  test('should select all tracks with Cmd+A and clear with Escape', async ({ page }) => {
    const trackCount = await page.evaluate(() =>
      window.Alpine.store('library').filteredTracks.length
    );

    // Cmd+A to select all
    await page.keyboard.press('Meta+a');

    const selectedCount = await page.evaluate(() => {
      const component = window.Alpine.$data(document.querySelector('[x-data="libraryBrowser"]'));
      return component.selectedTracks?.size || 0;
    });
    expect(selectedCount).toBe(trackCount);

    // Escape to clear
    await page.keyboard.press('Escape');

    const selectedAfter = await page.evaluate(() => {
      const component = window.Alpine.$data(document.querySelector('[x-data="libraryBrowser"]'));
      return component.selectedTracks?.size || 0;
    });
    expect(selectedAfter).toBe(0);
  });

  test('should not trigger shortcuts when search input is focused', async ({ page }) => {
    // Select a track first
    await page.locator('[data-track-id]').nth(0).click();
    await page.waitForTimeout(100);

    const selectedBefore = await page.evaluate(() => {
      const component = window.Alpine.$data(document.querySelector('[x-data="libraryBrowser"]'));
      return component.selectedTracks?.size || 0;
    });
    expect(selectedBefore).toBeGreaterThan(0);

    // Focus search input via Cmd+F
    await page.keyboard.press('Meta+f');

    // Cmd+A while search is focused should NOT select library tracks
    await page.keyboard.press('Meta+a');

    const selectedAfterCmdA = await page.evaluate(() => {
      const component = window.Alpine.$data(document.querySelector('[x-data="libraryBrowser"]'));
      return component.selectedTracks?.size || 0;
    });
    // Selection unchanged (Cmd+A acted on search input text, not library)
    expect(selectedAfterCmdA).toBe(selectedBefore);
  });
});
