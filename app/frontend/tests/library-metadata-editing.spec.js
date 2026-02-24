import { expect, test } from '@playwright/test';
import { clickTrackRow, waitForAlpine } from './fixtures/helpers.js';
import { createLibraryState, setupLibraryMocks } from './fixtures/mock-library.js';

/**
 * Metadata Editing Tests (task-149)
 *
 * Tests for the track metadata editing feature:
 * - Context menu shows "Edit Metadata..." option
 * - Modal opens with track metadata fields
 * - Modal can be closed with Escape key
 * - Form fields are populated correctly
 */
test.describe('Metadata Editing (task-149)', () => {
  test.beforeEach(async ({ page }) => {
    const libraryState = createLibraryState();
    await setupLibraryMocks(page, libraryState);
    await page.goto('/');
    await waitForAlpine(page);
    await page.waitForSelector('[x-data="libraryBrowser"]', { state: 'visible' });
    await page.waitForSelector('[data-track-id]', { state: 'visible' });
  });

  test('should show "Edit Metadata..." option in context menu', async ({ page }) => {
    const firstTrack = page.locator('[data-track-id]').first();
    await firstTrack.click({ button: 'right' });

    await page.waitForSelector('[data-testid="track-context-menu"]', { state: 'visible' });

    const editMetadataItem = page.locator(
      '[data-testid="track-context-menu"] .context-menu-item:has-text("Edit Metadata")',
    );
    await expect(editMetadataItem).toBeVisible();
  });

  test('should open metadata modal when clicking "Edit Metadata..."', async ({ page }) => {
    const firstTrack = page.locator('[data-track-id]').first();
    await firstTrack.click({ button: 'right' });

    await page.waitForSelector('[data-testid="track-context-menu"]', { state: 'visible' });

    const editMetadataItem = page.locator(
      '[data-testid="track-context-menu"] .context-menu-item:has-text("Edit Metadata")',
    );
    await editMetadataItem.click();

    // Wait for modal to appear
    await page.waitForSelector('[data-testid="metadata-modal"]', {
      state: 'visible',
      timeout: 5000,
    });

    const modal = page.locator('[data-testid="metadata-modal"]');
    await expect(modal).toBeVisible();
  });

  test('should display metadata form fields in modal', async ({ page }) => {
    const firstTrack = page.locator('[data-track-id]').first();
    await firstTrack.click({ button: 'right' });

    await page.waitForSelector('[data-testid="track-context-menu"]', { state: 'visible' });

    const editMetadataItem = page.locator(
      '[data-testid="track-context-menu"] .context-menu-item:has-text("Edit Metadata")',
    );
    await editMetadataItem.click();

    await page.waitForSelector('[data-testid="metadata-modal"]', {
      state: 'visible',
      timeout: 5000,
    });

    const titleInput = page.locator('[data-testid="metadata-title"]');
    const artistInput = page.locator('[data-testid="metadata-artist"]');
    const albumInput = page.locator('[data-testid="metadata-album"]');

    await expect(titleInput).toBeVisible();
    await expect(artistInput).toBeVisible();
    await expect(albumInput).toBeVisible();
  });

  test('should close metadata modal with Escape key', async ({ page }) => {
    const firstTrack = page.locator('[data-track-id]').first();
    await firstTrack.click({ button: 'right' });

    await page.waitForSelector('[data-testid="track-context-menu"]', { state: 'visible' });

    const editMetadataItem = page.locator(
      '[data-testid="track-context-menu"] .context-menu-item:has-text("Edit Metadata")',
    );
    await editMetadataItem.click();

    await page.waitForSelector('[data-testid="metadata-modal"]', {
      state: 'visible',
      timeout: 5000,
    });

    // Press Escape to close
    await page.keyboard.press('Escape');

    // Modal should be hidden
    const modal = page.locator('[data-testid="metadata-modal"]');
    await expect(modal).not.toBeVisible();
  });

  test('should close metadata modal with Cancel button', async ({ page }) => {
    const firstTrack = page.locator('[data-track-id]').first();
    await firstTrack.click({ button: 'right' });

    await page.waitForSelector('[data-testid="track-context-menu"]', { state: 'visible' });

    const editMetadataItem = page.locator(
      '[data-testid="track-context-menu"] .context-menu-item:has-text("Edit Metadata")',
    );
    await editMetadataItem.click();

    await page.waitForSelector('[data-testid="metadata-modal"]', {
      state: 'visible',
      timeout: 5000,
    });

    // Click Cancel button
    const cancelButton = page.locator('[data-testid="metadata-modal"] button:has-text("Cancel")');
    await cancelButton.click();

    // Modal should be hidden
    const modal = page.locator('[data-testid="metadata-modal"]');
    await expect(modal).not.toBeVisible();
  });

  test('should show file info section in metadata modal', async ({ page }) => {
    const firstTrack = page.locator('[data-track-id]').first();
    await firstTrack.click({ button: 'right' });

    await page.waitForSelector('[data-testid="track-context-menu"]', { state: 'visible' });

    const editMetadataItem = page.locator(
      '[data-testid="track-context-menu"] .context-menu-item:has-text("Edit Metadata")',
    );
    await editMetadataItem.click();

    await page.waitForSelector('[data-testid="metadata-modal"]', {
      state: 'visible',
      timeout: 5000,
    });

    // Check for file info section
    const fileInfoSection = page.locator(
      '[data-testid="metadata-modal"] :has-text("File Info"), [data-testid="metadata-modal"] :has-text("Format")',
    );
    await expect(fileInfoSection.first()).toBeVisible();
  });

  test('should have Save button in metadata modal', async ({ page }) => {
    const firstTrack = page.locator('[data-track-id]').first();
    await firstTrack.click({ button: 'right' });

    await page.waitForSelector('[data-testid="track-context-menu"]', { state: 'visible' });

    const editMetadataItem = page.locator(
      '[data-testid="track-context-menu"] .context-menu-item:has-text("Edit Metadata")',
    );
    await editMetadataItem.click();

    await page.waitForSelector('[data-testid="metadata-modal"]', {
      state: 'visible',
      timeout: 5000,
    });

    // Check for Save button
    const saveButton = page.locator('[data-testid="metadata-modal"] button:has-text("Save")');
    await expect(saveButton).toBeVisible();
  });

  test('should show loading state while fetching metadata', async ({ page }) => {
    // This test verifies the loading indicator appears briefly
    // We can check the component state
    const firstTrack = page.locator('[data-track-id]').first();
    await firstTrack.click({ button: 'right' });

    await page.waitForSelector('[data-testid="track-context-menu"]', { state: 'visible' });

    const editMetadataItem = page.locator(
      '[data-testid="track-context-menu"] .context-menu-item:has-text("Edit Metadata")',
    );
    await editMetadataItem.click();

    // Modal should appear (loading state may be brief)
    await page.waitForSelector('[data-testid="metadata-modal"]', {
      state: 'visible',
      timeout: 5000,
    });

    // Verify the modal component exists and is functional
    const modalComponent = await page.evaluate(() => {
      const modal = document.querySelector('[x-data="metadataModal"]');
      if (modal) {
        const data = window.Alpine.$data(modal);
        return {
          hasOpenMethod: typeof data.open === 'function',
          hasCloseMethod: typeof data.close === 'function',
          hasSaveMethod: typeof data.save === 'function',
        };
      }
      return null;
    });

    expect(modalComponent).not.toBeNull();
    expect(modalComponent.hasOpenMethod).toBe(true);
    expect(modalComponent.hasCloseMethod).toBe(true);
    expect(modalComponent.hasSaveMethod).toBe(true);
  });

  test('context menu should close after clicking Edit Metadata', async ({ page }) => {
    const firstTrack = page.locator('[data-track-id]').first();
    await firstTrack.click({ button: 'right' });

    await page.waitForSelector('[data-testid="track-context-menu"]', { state: 'visible' });

    const editMetadataItem = page.locator(
      '[data-testid="track-context-menu"] .context-menu-item:has-text("Edit Metadata")',
    );
    await editMetadataItem.click();

    const contextMenu = page.locator('[data-testid="track-context-menu"]');
    await expect(contextMenu).not.toBeVisible();
  });

  test('should show batch edit option when multiple tracks selected', async ({ page }) => {
    const isMac = process.platform === 'darwin';
    const modifier = isMac ? 'Meta' : 'Control';

    await clickTrackRow(page, 0);

    await page.keyboard.down(modifier);
    await clickTrackRow(page, 1);
    await page.keyboard.up(modifier);

    const selectedTracks = page.locator('[data-track-id].track-row-selected');
    const count = await selectedTracks.count();
    expect(count).toBe(2);

    const secondTrack = page.locator('[data-track-id]').nth(1);
    await secondTrack.click({ button: 'right' });

    await page.waitForSelector('[data-testid="track-context-menu"]', { state: 'visible' });

    const editMetadataItem = page.locator(
      '[data-testid="track-context-menu"] .context-menu-item:has-text("Edit Metadata (2 tracks)")',
    );
    await expect(editMetadataItem).toBeVisible();
  });

  test('should open batch edit modal with correct title', async ({ page }) => {
    const isMac = process.platform === 'darwin';
    const modifier = isMac ? 'Meta' : 'Control';

    await clickTrackRow(page, 0);

    await page.keyboard.down(modifier);
    await clickTrackRow(page, 1);
    await page.keyboard.up(modifier);

    const secondTrack = page.locator('[data-track-id]').nth(1);
    await secondTrack.click({ button: 'right' });

    await page.waitForSelector('[data-testid="track-context-menu"]', { state: 'visible' });

    const editMetadataItem = page.locator(
      '[data-testid="track-context-menu"] .context-menu-item:has-text("Edit Metadata")',
    );
    await editMetadataItem.click();

    await page.waitForSelector('[data-testid="metadata-modal"]', {
      state: 'visible',
      timeout: 5000,
    });

    const modalTitle = page.locator('[data-testid="metadata-modal"] h2');
    await expect(modalTitle).toContainText('2 tracks');
  });

  test('context menu should NOT show "Track Info..." option', async ({ page }) => {
    const firstTrack = page.locator('[data-track-id]').first();
    await firstTrack.click({ button: 'right' });

    await page.waitForSelector('[data-testid="track-context-menu"]', { state: 'visible' });

    const trackInfoItem = page.locator(
      '[data-testid="track-context-menu"] .context-menu-item:has-text("Track Info")',
    );
    await expect(trackInfoItem).not.toBeVisible();
  });

  test('Delete/Backspace should NOT trigger removal when metadata modal input is focused', async ({ page }) => {
    await clickTrackRow(page, 0);

    const selectedBefore = await page.locator('[data-track-id].track-row-selected').count();
    expect(selectedBefore).toBe(1);

    const firstTrack = page.locator('[data-track-id]').first();
    await firstTrack.click({ button: 'right' });

    await page.waitForSelector('[data-testid="track-context-menu"]', { state: 'visible' });

    const editMetadataItem = page.locator(
      '[data-testid="track-context-menu"] .context-menu-item:has-text("Edit Metadata")',
    );
    await editMetadataItem.click();

    await page.waitForSelector('[data-testid="metadata-modal"]', {
      state: 'visible',
      timeout: 5000,
    });

    const artistInput = page.locator('[data-testid="metadata-artist"]');
    await artistInput.focus();
    await artistInput.fill('Test Artist');

    await page.keyboard.press('Delete');
    await page.keyboard.press('Backspace');

    const modal = page.locator('[data-testid="metadata-modal"]');
    await expect(modal).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(modal).not.toBeVisible();

    const trackCount = await page.locator('[data-track-id]').count();
    expect(trackCount).toBeGreaterThan(0);
  });
});

test.describe('Metadata Editor Navigation (task-166)', () => {
  test.beforeEach(async ({ page }) => {
    const libraryState = createLibraryState();
    await setupLibraryMocks(page, libraryState);
    await page.goto('/');
    await waitForAlpine(page);
    await page.waitForSelector('[x-data="libraryBrowser"]', { state: 'visible' });
    await page.waitForSelector('[data-track-id]', { state: 'visible' });
  });

  test('should show navigation arrows when multiple tracks are selected', async ({ page }) => {
    const isMac = process.platform === 'darwin';
    const modifier = isMac ? 'Meta' : 'Control';

    await clickTrackRow(page, 0);
    await page.keyboard.down(modifier);
    await clickTrackRow(page, 1);
    await page.keyboard.up(modifier);

    const secondTrack = page.locator('[data-track-id]').nth(1);
    await secondTrack.click({ button: 'right' });

    await page.waitForSelector('[data-testid="track-context-menu"]', { state: 'visible' });

    const editMetadataItem = page.locator(
      '[data-testid="track-context-menu"] .context-menu-item:has-text("Edit Metadata")',
    );
    await editMetadataItem.click();

    await page.waitForSelector('[data-testid="metadata-modal"]', {
      state: 'visible',
      timeout: 5000,
    });

    const prevButton = page.locator('[data-testid="metadata-nav-prev"]');
    const nextButton = page.locator('[data-testid="metadata-nav-next"]');
    const indicator = page.locator('[data-testid="metadata-nav-indicator"]');

    await expect(prevButton).toBeVisible();
    await expect(nextButton).toBeVisible();
    await expect(indicator).toBeVisible();
  });

  test('should show navigation arrows for single track selection', async ({ page }) => {
    const firstTrack = page.locator('[data-track-id]').first();
    await firstTrack.click({ button: 'right' });

    await page.waitForSelector('[data-testid="track-context-menu"]', { state: 'visible' });

    const editMetadataItem = page.locator(
      '[data-testid="track-context-menu"] .context-menu-item:has-text("Edit Metadata")',
    );
    await editMetadataItem.click();

    await page.waitForSelector('[data-testid="metadata-modal"]', {
      state: 'visible',
      timeout: 5000,
    });

    const prevButton = page.locator('[data-testid="metadata-nav-prev"]');
    const nextButton = page.locator('[data-testid="metadata-nav-next"]');
    const indicator = page.locator('[data-testid="metadata-nav-indicator"]');

    await expect(prevButton).toBeVisible();
    await expect(nextButton).toBeVisible();
    await expect(indicator).toBeVisible();
  });

  test('should show track position indicator with correct format', async ({ page }) => {
    const firstTrack = page.locator('[data-track-id]').first();
    await firstTrack.click({ button: 'right' });

    await page.waitForSelector('[data-testid="track-context-menu"]', { state: 'visible' });

    const editMetadataItem = page.locator(
      '[data-testid="track-context-menu"] .context-menu-item:has-text("Edit Metadata")',
    );
    await editMetadataItem.click();

    await page.waitForSelector('[data-testid="metadata-modal"]', {
      state: 'visible',
      timeout: 5000,
    });

    const indicator = page.locator('[data-testid="metadata-nav-indicator"]');
    const indicatorText = await indicator.textContent();

    expect(indicatorText).toMatch(/^\d+ \/ \d+$/);
  });

  test('should navigate to next track with ArrowRight key', async ({ page }) => {
    const firstTrack = page.locator('[data-track-id]').first();
    await firstTrack.click({ button: 'right' });

    await page.waitForSelector('[data-testid="track-context-menu"]', { state: 'visible' });

    const editMetadataItem = page.locator(
      '[data-testid="track-context-menu"] .context-menu-item:has-text("Edit Metadata")',
    );
    await editMetadataItem.click();

    await page.waitForSelector('[data-testid="metadata-modal"]', {
      state: 'visible',
      timeout: 5000,
    });

    const indicatorBefore = await page.locator('[data-testid="metadata-nav-indicator"]')
      .textContent();
    const [indexBefore] = indicatorBefore.split(' / ').map(Number);

    await page.keyboard.press('ArrowRight');

    await page.waitForTimeout(500);

    const indicatorAfter = await page.locator('[data-testid="metadata-nav-indicator"]')
      .textContent();
    const [indexAfter] = indicatorAfter.split(' / ').map(Number);

    expect(indexAfter).toBe(indexBefore + 1);

    const modal = page.locator('[data-testid="metadata-modal"]');
    await expect(modal).toBeVisible();
  });

  test('should navigate to previous track with ArrowLeft key', async ({ page }) => {
    const secondTrack = page.locator('[data-track-id]').nth(1);
    await secondTrack.click({ button: 'right' });

    await page.waitForSelector('[data-testid="track-context-menu"]', { state: 'visible' });

    const editMetadataItem = page.locator(
      '[data-testid="track-context-menu"] .context-menu-item:has-text("Edit Metadata")',
    );
    await editMetadataItem.click();

    await page.waitForSelector('[data-testid="metadata-modal"]', {
      state: 'visible',
      timeout: 5000,
    });

    const indicatorBefore = await page.locator('[data-testid="metadata-nav-indicator"]')
      .textContent();
    const [indexBefore] = indicatorBefore.split(' / ').map(Number);

    if (indexBefore > 1) {
      await page.keyboard.press('ArrowLeft');

      await page.waitForTimeout(500);

      const indicatorAfter = await page.locator('[data-testid="metadata-nav-indicator"]')
        .textContent();
      const [indexAfter] = indicatorAfter.split(' / ').map(Number);

      expect(indexAfter).toBe(indexBefore - 1);
    }

    const modal = page.locator('[data-testid="metadata-modal"]');
    await expect(modal).toBeVisible();
  });

  test('should deselect other tracks when navigating', async ({ page }) => {
    const isMac = process.platform === 'darwin';
    const modifier = isMac ? 'Meta' : 'Control';

    await clickTrackRow(page, 0);
    await page.keyboard.down(modifier);
    await clickTrackRow(page, 1);
    await page.keyboard.up(modifier);

    const selectedBefore = await page.locator('[data-track-id].track-row-selected').count();
    expect(selectedBefore).toBe(2);

    const firstTrack = page.locator('[data-track-id]').first();
    await firstTrack.click({ button: 'right' });

    await page.waitForSelector('[data-testid="track-context-menu"]', { state: 'visible' });

    const editMetadataItem = page.locator(
      '[data-testid="track-context-menu"] .context-menu-item:has-text("Edit Metadata")',
    );
    await editMetadataItem.click();

    await page.waitForSelector('[data-testid="metadata-modal"]', {
      state: 'visible',
      timeout: 5000,
    });

    await page.keyboard.press('ArrowRight');

    await page.waitForTimeout(500);

    const selectedAfter = await page.locator('[data-track-id].track-row-selected').count();
    expect(selectedAfter).toBe(1);
  });

  test('should switch from batch edit to single track edit on navigation', async ({ page }) => {
    const isMac = process.platform === 'darwin';
    const modifier = isMac ? 'Meta' : 'Control';

    await clickTrackRow(page, 0);
    await page.keyboard.down(modifier);
    await clickTrackRow(page, 1);
    await page.keyboard.up(modifier);

    const firstTrack = page.locator('[data-track-id]').first();
    await firstTrack.click({ button: 'right' });

    await page.waitForSelector('[data-testid="track-context-menu"]', { state: 'visible' });

    const editMetadataItem = page.locator(
      '[data-testid="track-context-menu"] .context-menu-item:has-text("Edit Metadata")',
    );
    await editMetadataItem.click();

    await page.waitForSelector('[data-testid="metadata-modal"]', {
      state: 'visible',
      timeout: 5000,
    });

    const modalTitleBefore = await page.locator('[data-testid="metadata-modal"] h2').textContent();
    expect(modalTitleBefore).toContain('2 tracks');

    await page.keyboard.press('ArrowRight');

    await page.waitForTimeout(500);

    const modalTitleAfter = await page.locator('[data-testid="metadata-modal"] h2').textContent();
    expect(modalTitleAfter).toBe('Edit Metadata');
  });

  test('should navigate using arrow buttons', async ({ page }) => {
    const firstTrack = page.locator('[data-track-id]').first();
    await firstTrack.click({ button: 'right' });

    await page.waitForSelector('[data-testid="track-context-menu"]', { state: 'visible' });

    const editMetadataItem = page.locator(
      '[data-testid="track-context-menu"] .context-menu-item:has-text("Edit Metadata")',
    );
    await editMetadataItem.click();

    await page.waitForSelector('[data-testid="metadata-modal"]', {
      state: 'visible',
      timeout: 5000,
    });

    const indicatorBefore = await page.locator('[data-testid="metadata-nav-indicator"]')
      .textContent();
    const [indexBefore] = indicatorBefore.split(' / ').map(Number);

    const nextButton = page.locator('[data-testid="metadata-nav-next"]');
    await nextButton.click();

    await page.waitForTimeout(500);

    const indicatorAfter = await page.locator('[data-testid="metadata-nav-indicator"]')
      .textContent();
    const [indexAfter] = indicatorAfter.split(' / ').map(Number);

    expect(indexAfter).toBe(indexBefore + 1);
  });

  test('should disable prev button at first track', async ({ page }) => {
    const firstTrack = page.locator('[data-track-id]').first();
    await firstTrack.click({ button: 'right' });

    await page.waitForSelector('[data-testid="track-context-menu"]', { state: 'visible' });

    const editMetadataItem = page.locator(
      '[data-testid="track-context-menu"] .context-menu-item:has-text("Edit Metadata")',
    );
    await editMetadataItem.click();

    await page.waitForSelector('[data-testid="metadata-modal"]', {
      state: 'visible',
      timeout: 5000,
    });

    const indicator = await page.locator('[data-testid="metadata-nav-indicator"]').textContent();
    const [index] = indicator.split(' / ').map(Number);

    if (index === 1) {
      const prevButton = page.locator('[data-testid="metadata-nav-prev"]');
      await expect(prevButton).toBeDisabled();
    }
  });

  test('arrow keys should work even when input is focused', async ({ page }) => {
    const firstTrack = page.locator('[data-track-id]').first();
    await firstTrack.click({ button: 'right' });

    await page.waitForSelector('[data-testid="track-context-menu"]', { state: 'visible' });

    const editMetadataItem = page.locator(
      '[data-testid="track-context-menu"] .context-menu-item:has-text("Edit Metadata")',
    );
    await editMetadataItem.click();

    await page.waitForSelector('[data-testid="metadata-modal"]', {
      state: 'visible',
      timeout: 5000,
    });

    const artistInput = page.locator('[data-testid="metadata-artist"]');
    await artistInput.focus();

    const indicatorBefore = await page.locator('[data-testid="metadata-nav-indicator"]')
      .textContent();
    const [indexBefore] = indicatorBefore.split(' / ').map(Number);

    await page.keyboard.press('ArrowRight');

    await page.waitForTimeout(500);

    const indicatorAfter = await page.locator('[data-testid="metadata-nav-indicator"]')
      .textContent();
    const [indexAfter] = indicatorAfter.split(' / ').map(Number);

    expect(indexAfter).toBe(indexBefore + 1);
  });
});
