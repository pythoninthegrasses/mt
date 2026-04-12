import { test, expect } from '@playwright/test';
import {
  waitForAlpine,
  getAlpineStore,
  getQueueItems,
  waitForPlaying,
  doubleClickTrackRow,
} from './fixtures/helpers.js';

// Reduced from 38 tests to 5 genuine E2E interaction tests.
// Queue logic (shuffle, history, loop, reorder) is covered by Vitest:
//   __tests__/queue.store.test.js  (unit tests)
//   __tests__/queue.props.test.js  (property-based tests)

test.describe('Queue E2E @tauri', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForAlpine(page);
    await page.waitForSelector('[x-data="libraryBrowser"]', { state: 'visible' });
  });

  test('double-click track populates queue and starts playback', async ({ page }) => {
    const initialQueueItems = await getQueueItems(page);
    const initialLength = initialQueueItems.length;

    await page.waitForSelector('[data-track-id]', { state: 'visible' });
    await doubleClickTrackRow(page, 0);
    await waitForPlaying(page);

    const updatedQueueItems = await getQueueItems(page);
    expect(updatedQueueItems.length).toBeGreaterThan(initialLength);
  });

  test('next/prev buttons navigate the queue', async ({ page }) => {
    await page.waitForSelector('[data-track-id]', { state: 'visible' });
    await page.locator('[data-track-id]').nth(0).click();
    await page.keyboard.down('Shift');
    await page.locator('[data-track-id]').nth(2).click();
    await page.keyboard.up('Shift');

    await doubleClickTrackRow(page, 0);
    await waitForPlaying(page);

    let queueStore = await getAlpineStore(page, 'queue');
    const initialIndex = queueStore.currentIndex;

    await page.click('[data-testid="player-next"]');
    await page.waitForFunction(
      (index) => window.Alpine.store('queue').currentIndex !== index,
      initialIndex,
      { timeout: 5000 }
    );

    queueStore = await getAlpineStore(page, 'queue');
    expect(queueStore.currentIndex).toBe(initialIndex + 1);

    await page.click('[data-testid="player-prev"]');
    await page.waitForFunction(
      (index) => window.Alpine.store('queue').currentIndex === index,
      initialIndex,
      { timeout: 5000 }
    );

    queueStore = await getAlpineStore(page, 'queue');
    expect(queueStore.currentIndex).toBe(initialIndex);
  });

  test('shuffle button toggles shuffle state', async ({ page }) => {
    const initialQueueStore = await getAlpineStore(page, 'queue');
    const initialShuffle = initialQueueStore.shuffle;

    const shuffleButton = page.locator('[data-testid="player-shuffle"]');
    await shuffleButton.click();

    await page.waitForFunction(
      (initial) => window.Alpine.store('queue').shuffle !== initial,
      initialShuffle,
      { timeout: 5000 }
    );

    const updatedQueueStore = await getAlpineStore(page, 'queue');
    expect(updatedQueueStore.shuffle).toBe(!initialShuffle);

    const buttonClasses = await shuffleButton.getAttribute('class');
    if (!initialShuffle) {
      expect(buttonClasses).toContain('text-primary');
    } else {
      expect(buttonClasses).not.toContain('text-primary');
    }
  });

  test('context menu Add to Queue appends track', async ({ page }) => {
    await page.waitForSelector('[data-track-id]', { state: 'visible' });

    await doubleClickTrackRow(page, 0);
    await waitForPlaying(page);

    const initialQueueLength = await page.evaluate(() =>
      window.Alpine.store('queue').items.length
    );

    await page.locator('[data-track-id]').nth(3).click({ button: 'right' });
    await page.waitForSelector('text=Add', { state: 'visible' });
    await page.click('text=/Add.*to Queue/');

    await page.waitForFunction(
      (initial) => window.Alpine.store('queue').items.length > initial,
      initialQueueLength,
      { timeout: 5000 }
    );

    const newQueueLength = await page.evaluate(() =>
      window.Alpine.store('queue').items.length
    );
    expect(newQueueLength).toBe(initialQueueLength + 1);
  });

  test('context menu Play Next inserts track after current', async ({ page }) => {
    await page.waitForSelector('[data-track-id]', { state: 'visible' });

    await doubleClickTrackRow(page, 0);
    await waitForPlaying(page);

    const currentIndex = await page.evaluate(() =>
      window.Alpine.store('queue').currentIndex
    );

    const trackToInsert = await page.evaluate(() => {
      const tracks = window.Alpine.store('library').tracks;
      return tracks[5];
    });

    await page.locator('[data-track-id]').nth(5).click({ button: 'right' });
    await page.waitForSelector('text=Play Next', { state: 'visible' });
    await page.click('text=Play Next');

    await page.waitForTimeout(300);

    const queueItems = await page.evaluate(() =>
      window.Alpine.store('queue').items
    );
    const insertedTrack = queueItems[currentIndex + 1];
    expect(insertedTrack.id).toBe(trackToInsert.id);
  });
});
