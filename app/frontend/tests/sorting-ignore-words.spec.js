import { expect, test } from '@playwright/test';
import { waitForAlpine } from './fixtures/helpers.js';
import { createLibraryState, setupLibraryMocks } from './fixtures/mock-library.js';

/**
 * Sorting Ignore Words — UI Integration Tests (reduced set)
 *
 * Pure sorting logic (prefix stripping, sort key mapping, custom word lists)
 * is covered by Vitest in __tests__/sorting-ignore-words.test.js.
 * These tests verify the Settings UI navigation and toggle interaction.
 */

test.describe('Sorting - Ignore Words Settings UI', () => {
  test.beforeEach(async ({ page }) => {
    const libraryState = createLibraryState();
    await setupLibraryMocks(page, libraryState);
    await page.setViewportSize({ width: 1624, height: 1057 });
    await page.goto('/');
    await waitForAlpine(page);
    await page.waitForSelector('[x-data="libraryBrowser"]', { state: 'visible' });
    await page.waitForSelector('[data-track-id]', { state: 'visible' });
  });

  test('should have Sorting section with toggle and input in settings', async ({ page }) => {
    await page.click('[data-testid="sidebar-settings"]');
    await page.waitForSelector('[data-testid="settings-section-general"]', { state: 'visible' });

    const sortingNav = page.locator('[data-testid="settings-nav-sorting"]');
    await expect(sortingNav).toBeVisible();
    await expect(sortingNav).toHaveText('Sorting');

    await sortingNav.click();
    await page.waitForSelector('[data-testid="settings-section-sorting"]', { state: 'visible' });

    const toggle = page.locator('[data-testid="settings-sort-ignore-words-toggle"]');
    await expect(toggle).toBeVisible();
    await expect(toggle).toBeChecked();

    const input = page.locator('[data-testid="settings-sort-ignore-words-input"]');
    await expect(input).toBeVisible();
  });

  test('should disable input when toggle is unchecked', async ({ page }) => {
    await page.click('[data-testid="sidebar-settings"]');
    await page.click('[data-testid="settings-nav-sorting"]');
    await page.waitForSelector('[data-testid="settings-section-sorting"]', { state: 'visible' });

    const toggle = page.locator('[data-testid="settings-sort-ignore-words-toggle"]');
    await toggle.click();
    await page.waitForTimeout(200);

    const input = page.locator('[data-testid="settings-sort-ignore-words-input"]');
    await expect(input).toBeDisabled();
  });

  test('should persist settings changes within session', async ({ page }) => {
    await page.click('[data-testid="sidebar-settings"]');
    await page.click('[data-testid="settings-nav-sorting"]');
    await page.waitForSelector('[data-testid="settings-section-sorting"]', { state: 'visible' });

    const input = page.locator('[data-testid="settings-sort-ignore-words-input"]');
    await input.fill('der, die, das, el, la');
    await page.waitForTimeout(300);

    // Navigate away and back
    await page.click('[data-testid="sidebar-section-all"]');
    await page.waitForTimeout(200);
    await page.click('[data-testid="sidebar-settings"]');
    await page.click('[data-testid="settings-nav-sorting"]');
    await page.waitForSelector('[data-testid="settings-section-sorting"]', { state: 'visible' });

    const inputAfter = page.locator('[data-testid="settings-sort-ignore-words-input"]');
    const valueAfter = await inputAfter.inputValue();
    expect(valueAfter).toBe('der, die, das, el, la');
  });
});
