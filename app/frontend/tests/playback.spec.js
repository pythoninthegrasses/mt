import { test, expect } from '@playwright/test';
import {
  waitForAlpine,
  getAlpineStore,
  waitForPlaying,
  waitForPaused,
  doubleClickTrackRow,
} from './fixtures/helpers.js';

/**
 * Hardware-dependent playback tests requiring Tauri audio backend.
 *
 * State-only tests (play/pause toggle, queue clear, shuffle, now-playing display)
 * are covered by Vitest in __tests__/playback-regression.test.js and
 * __tests__/shortcuts.test.js.
 */

test.describe('Volume Controls @tauri', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForAlpine(page);
  });

  test('should adjust volume when clicking volume slider', async ({ page }) => {
    const volumeBar = page.locator('[data-testid="player-volume"]');
    const boundingBox = await volumeBar.boundingBox();

    const clickX = boundingBox.x + boundingBox.width * 0.75;
    const clickY = boundingBox.y + boundingBox.height / 2;
    await page.mouse.click(clickX, clickY);

    await page.waitForTimeout(300);

    const playerStore = await getAlpineStore(page, 'player');
    expect(playerStore.volume).toBeGreaterThan(60);
    expect(playerStore.volume).toBeLessThan(90);
  });

  test('should smoothly adjust volume when dragging slider', async ({ page }) => {
    const volumeBar = page.locator('[data-testid="player-volume"]');
    const boundingBox = await volumeBar.boundingBox();

    const initialStore = await getAlpineStore(page, 'player');
    const initialVolume = initialStore.volume;

    const startX = boundingBox.x + boundingBox.width * 0.2;
    const endX = boundingBox.x + boundingBox.width * 0.8;
    const centerY = boundingBox.y + boundingBox.height / 2;

    await page.mouse.move(startX, centerY);
    await page.mouse.down();

    const steps = 10;
    for (let i = 1; i <= steps; i++) {
      const x = startX + ((endX - startX) * i) / steps;
      await page.mouse.move(x, centerY);
      await page.waitForTimeout(10);
    }

    await page.mouse.up();
    await page.waitForTimeout(300);

    const finalStore = await getAlpineStore(page, 'player');
    expect(finalStore.volume).toBeGreaterThan(initialVolume);
    expect(finalStore.volume).toBeGreaterThan(70);
    expect(finalStore.volume).toBeLessThan(90);

    // Verify thumb is visible on hover
    await page.mouse.move(boundingBox.x + boundingBox.width * 0.5, centerY);
    const thumbElement = volumeBar.locator('.absolute.top-1\\/2.-translate-y-1\\/2.w-2\\.5.h-2\\.5');
    await expect(thumbElement).toBeVisible();
  });

  test('should not bounce back when rapidly clicking volume slider', async ({ page }) => {
    const volumeBar = page.locator('[data-testid="player-volume"]');
    const boundingBox = await volumeBar.boundingBox();
    const centerY = boundingBox.y + boundingBox.height / 2;

    const positions = [0.2, 0.8, 0.5, 0.9, 0.3];

    for (const pos of positions) {
      const clickX = boundingBox.x + boundingBox.width * pos;
      await page.mouse.click(clickX, centerY);
      await page.waitForTimeout(50);

      const store = await getAlpineStore(page, 'player');
      const expectedVolume = Math.round(pos * 100);
      expect(store.volume).toBeGreaterThan(expectedVolume - 10);
      expect(store.volume).toBeLessThan(expectedVolume + 10);
    }
  });

  test('should handle rapid drag direction changes without bounce-back', async ({ page }) => {
    const volumeBar = page.locator('[data-testid="player-volume"]');
    const boundingBox = await volumeBar.boundingBox();
    const centerY = boundingBox.y + boundingBox.height / 2;

    const midX = boundingBox.x + boundingBox.width * 0.5;
    await page.mouse.move(midX, centerY);
    await page.mouse.down();

    const positions = [0.8, 0.3, 0.9, 0.2, 0.7];
    for (const pos of positions) {
      const x = boundingBox.x + boundingBox.width * pos;
      await page.mouse.move(x, centerY);
      await page.waitForTimeout(5);
    }

    await page.mouse.up();
    await page.waitForTimeout(100);

    const finalStore = await getAlpineStore(page, 'player');
    expect(finalStore.volume).toBeGreaterThan(60);
    expect(finalStore.volume).toBeLessThan(80);
  });
});

test.describe('Playback Parity Tests @tauri', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForAlpine(page);
    await page.waitForSelector('[x-data="libraryBrowser"]', { state: 'visible' });
  });

  test('pause should freeze position (task-141)', async ({ page }) => {
    await page.waitForSelector('[data-track-id]', { state: 'visible' });
    await doubleClickTrackRow(page, 0);
    await waitForPlaying(page);

    await page.waitForFunction(() => window.Alpine.store('player').position > 0.5);

    await page.locator('[data-testid="player-playpause"]').click();
    await waitForPaused(page);

    const pos0 = await page.evaluate(() => window.Alpine.store('player').position);
    await page.waitForTimeout(750);
    const pos1 = await page.evaluate(() => window.Alpine.store('player').position);

    expect(pos1 - pos0).toBeLessThanOrEqual(0.25);
  });

  test('seek should move position and remain stable (task-142)', async ({ page }) => {
    await page.waitForSelector('[data-track-id]', { state: 'visible' });
    await doubleClickTrackRow(page, 0);
    await waitForPlaying(page);

    await page.waitForFunction(() => window.Alpine.store('player').duration > 5);

    const duration = await page.evaluate(() => window.Alpine.store('player').duration);
    const targetFraction = 0.25;
    const expected = duration * targetFraction;
    const tolerance = Math.max(2.0, duration * 0.05);

    const bar = page.locator('[data-testid="player-progressbar"]');
    const box = await bar.boundingBox();
    await page.mouse.click(box.x + box.width * targetFraction, box.y + box.height / 2);

    await page.waitForTimeout(300);
    const posA = await page.evaluate(() => window.Alpine.store('player').position);
    expect(Math.abs(posA - expected)).toBeLessThanOrEqual(tolerance);

    await page.waitForTimeout(400);
    const posB = await page.evaluate(() => window.Alpine.store('player').position);
    expect(Math.abs(posB - expected)).toBeLessThanOrEqual(tolerance);
  });

  test('rapid next should not break playback state (task-143)', async ({ page }) => {
    await page.waitForSelector('[data-track-id]', { state: 'visible' });
    await doubleClickTrackRow(page, 0);
    await waitForPlaying(page);

    const nextBtn = page.locator('[data-testid="player-next"]');
    for (let i = 0; i < 15; i++) {
      await nextBtn.click();
      await page.waitForTimeout(75);
    }

    const player = await page.evaluate(() => window.Alpine.store('player'));
    expect(player.currentTrack).toBeTruthy();
    expect(player.currentTrack.id).toBeTruthy();
    expect(player.isPlaying).toBe(true);
  });

  test('should preserve database duration when Rust returns 0 (task-148)', async ({ page }) => {
    await page.waitForSelector('[data-track-id]', { state: 'visible' });
    await doubleClickTrackRow(page, 0);
    await waitForPlaying(page);

    await page.waitForFunction(() => window.Alpine.store('player').duration > 0);
    const initialDuration = await page.evaluate(() => window.Alpine.store('player').duration);
    expect(initialDuration).toBeGreaterThan(0);

    await page.evaluate((dbDuration) => {
      window.__TAURI__.event.emit('audio://progress', {
        position_ms: 1000,
        duration_ms: 0,
        state: 'Playing',
      });
    }, initialDuration);

    await page.waitForTimeout(100);

    const afterDuration = await page.evaluate(() => window.Alpine.store('player').duration);
    expect(afterDuration).toBe(initialDuration);
  });
});

test.describe('Progress Bar Seeking Tests (task-228) @tauri', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForAlpine(page);
    await page.waitForSelector('[x-data="libraryBrowser"]', { state: 'visible' });
  });

  test('should seek to position when clicking on progress bar at different locations', async ({ page }) => {
    await page.waitForSelector('[data-track-id]', { state: 'visible' });
    await doubleClickTrackRow(page, 0);
    await waitForPlaying(page);

    await page.waitForFunction(() => window.Alpine.store('player').duration > 5);

    const duration = await page.evaluate(() => window.Alpine.store('player').duration);
    const progressBar = page.locator('[data-testid="player-progressbar"]');
    const box = await progressBar.boundingBox();

    const testPositions = [
      { fraction: 0.25, label: '25%' },
      { fraction: 0.5, label: '50%' },
      { fraction: 0.75, label: '75%' },
    ];

    for (const { fraction, label } of testPositions) {
      const clickX = box.x + box.width * fraction;
      const clickY = box.y + box.height / 2;
      await page.mouse.click(clickX, clickY);
      await page.waitForTimeout(300);

      const position = await page.evaluate(() => window.Alpine.store('player').position);
      const expected = duration * fraction;
      const tolerance = Math.max(2.0, duration * 0.05);
      expect(Math.abs(position - expected)).toBeLessThanOrEqual(tolerance);
    }

    const isPlaying = await page.evaluate(() => window.Alpine.store('player').isPlaying);
    expect(isPlaying).toBe(true);
  });

  test('should update position in real-time during drag scrubbing', async ({ page }) => {
    await page.waitForSelector('[data-track-id]', { state: 'visible' });
    await doubleClickTrackRow(page, 0);
    await waitForPlaying(page);

    await page.waitForFunction(() => window.Alpine.store('player').duration > 5);

    const duration = await page.evaluate(() => window.Alpine.store('player').duration);
    const progressBar = page.locator('[data-testid="player-progressbar"]');
    const box = await progressBar.boundingBox();

    const initialPosition = await page.evaluate(() => window.Alpine.store('player').position);

    const startX = box.x + box.width * 0.2;
    const centerY = box.y + box.height / 2;
    await page.mouse.move(startX, centerY);
    await page.mouse.down();

    const dragPositions = [];
    const steps = 5;
    for (let i = 1; i <= steps; i++) {
      const targetFraction = 0.2 + (0.6 * i) / steps;
      const x = box.x + box.width * targetFraction;
      await page.mouse.move(x, centerY);
      await page.waitForTimeout(50);

      const dragPos = await page.evaluate(() => {
        const controls = document.querySelector('[x-data]').__x.$data;
        return controls.isDraggingProgress ? controls.dragPosition : null;
      });

      if (dragPos !== null) {
        dragPositions.push(dragPos);
      }
    }

    expect(dragPositions.length).toBeGreaterThan(0);

    await page.mouse.up();
    await page.waitForTimeout(300);

    const finalPosition = await page.evaluate(() => window.Alpine.store('player').position);
    const expected = duration * 0.8;
    const tolerance = Math.max(2.0, duration * 0.05);
    expect(Math.abs(finalPosition - expected)).toBeLessThanOrEqual(tolerance);
    expect(Math.abs(finalPosition - initialPosition)).toBeGreaterThan(duration * 0.1);

    const isPlaying = await page.evaluate(() => window.Alpine.store('player').isPlaying);
    expect(isPlaying).toBe(true);
  });

  test('should not auto-play when seeking while paused', async ({ page }) => {
    await page.waitForSelector('[data-track-id]', { state: 'visible' });
    await doubleClickTrackRow(page, 0);
    await waitForPlaying(page);

    await page.waitForFunction(() => window.Alpine.store('player').duration > 5);

    const playButton = page.locator('[data-testid="player-playpause"]');
    await playButton.click();
    await waitForPaused(page);

    let isPlaying = await page.evaluate(() => window.Alpine.store('player').isPlaying);
    expect(isPlaying).toBe(false);

    const initialPosition = await page.evaluate(() => window.Alpine.store('player').position);

    const progressBar = page.locator('[data-testid="player-progressbar"]');
    const box = await progressBar.boundingBox();
    const clickX = box.x + box.width * 0.5;
    const clickY = box.y + box.height / 2;
    await page.mouse.click(clickX, clickY);
    await page.waitForTimeout(500);

    const newPosition = await page.evaluate(() => window.Alpine.store('player').position);
    expect(Math.abs(newPosition - initialPosition)).toBeGreaterThan(1);

    isPlaying = await page.evaluate(() => window.Alpine.store('player').isPlaying);
    expect(isPlaying).toBe(false);
  });

  test('should handle rapid seek operations without breaking state', async ({ page }) => {
    await page.waitForSelector('[data-track-id]', { state: 'visible' });
    await doubleClickTrackRow(page, 0);
    await waitForPlaying(page);

    await page.waitForFunction(() => window.Alpine.store('player').duration > 5);

    const progressBar = page.locator('[data-testid="player-progressbar"]');
    const box = await progressBar.boundingBox();
    const centerY = box.y + box.height / 2;

    const positions = [0.2, 0.8, 0.4, 0.9, 0.3, 0.6];
    for (const fraction of positions) {
      const clickX = box.x + box.width * fraction;
      await page.mouse.click(clickX, centerY);
      await page.waitForTimeout(50);
    }

    await page.waitForTimeout(500);

    const playerState = await page.evaluate(() => ({
      isPlaying: window.Alpine.store('player').isPlaying,
      currentTrack: window.Alpine.store('player').currentTrack,
      position: window.Alpine.store('player').position,
      duration: window.Alpine.store('player').duration,
    }));

    expect(playerState.currentTrack).toBeTruthy();
    expect(playerState.position).toBeGreaterThanOrEqual(0);
    expect(playerState.position).toBeLessThanOrEqual(playerState.duration);
    expect(playerState.isPlaying).toBe(true);
  });
});
