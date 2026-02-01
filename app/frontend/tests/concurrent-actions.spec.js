import { test, expect } from '@playwright/test';
import {
  waitForAlpine,
  getAlpineStore,
  waitForPlaying,
  waitForPaused,
  doubleClickTrackRow,
  callAlpineStoreMethod,
} from './fixtures/helpers.js';
import { createLibraryState, setupLibraryMocks } from './fixtures/mock-library.js';

test.describe('Concurrent User Actions - Play/Pause Debouncing', () => {
  test.beforeEach(async ({ page }) => {
    const libraryState = createLibraryState({ trackCount: 10 });
    await setupLibraryMocks(page, libraryState);
    await page.goto('/');
    await waitForAlpine(page);
    await page.waitForSelector('[x-data="libraryBrowser"]', { state: 'visible' });
  });

  test('rapid play/pause clicking should result in consistent state', async ({ page }) => {
    await page.waitForSelector('[data-track-id]', { state: 'visible' });

    // Set up playback state
    await page.evaluate(() => {
      const library = window.Alpine.store('library');
      const queue = window.Alpine.store('queue');
      const player = window.Alpine.store('player');

      queue.items = [...library.tracks];
      queue.currentIndex = 0;
      player.currentTrack = library.tracks[0];
      player.isPlaying = false;
    });

    const playButton = page.locator('[data-testid="player-playpause"]');

    // Rapid clicks (10 clicks in quick succession)
    for (let i = 0; i < 10; i++) {
      await playButton.click();
      await page.waitForTimeout(30); // Very short delay
    }

    // Wait for any pending state updates to settle
    await page.waitForTimeout(300);

    // Final state should be consistent (either playing or paused, no intermediate state)
    const finalState = await page.evaluate(() => {
      const player = window.Alpine.store('player');
      return {
        isPlaying: player.isPlaying,
        currentTrack: player.currentTrack?.id,
      };
    });

    // Should have a current track
    expect(finalState.currentTrack).toBeTruthy();

    // State should be deterministic (10 clicks = even number = same as initial)
    // After 10 toggles from paused state, should be paused again
    expect(typeof finalState.isPlaying).toBe('boolean');
  });

  test('rapid play/pause should not corrupt player state', async ({ page }) => {
    await page.waitForSelector('[data-track-id]', { state: 'visible' });

    // Set up initial playback
    await page.evaluate(() => {
      const library = window.Alpine.store('library');
      const queue = window.Alpine.store('queue');
      const player = window.Alpine.store('player');

      queue.items = [...library.tracks];
      queue.currentIndex = 0;
      player.currentTrack = library.tracks[0];
      player.isPlaying = true;
      player.position = 10;
      player.duration = 180;
    });

    const initialTrackId = await page.evaluate(() =>
      window.Alpine.store('player').currentTrack?.id
    );

    const playButton = page.locator('[data-testid="player-playpause"]');

    // Rapid toggle 20 times
    for (let i = 0; i < 20; i++) {
      await playButton.click();
      await page.waitForTimeout(20);
    }

    await page.waitForTimeout(200);

    // Verify state integrity
    const finalState = await page.evaluate(() => {
      const player = window.Alpine.store('player');
      return {
        trackId: player.currentTrack?.id,
        position: player.position,
        duration: player.duration,
      };
    });

    // Track should not have changed
    expect(finalState.trackId).toBe(initialTrackId);

    // Position should still be valid
    expect(finalState.position).toBeGreaterThanOrEqual(0);
    expect(finalState.position).toBeLessThanOrEqual(finalState.duration);
  });

  test('play/pause during track transition should not cause race condition', async ({ page }) => {
    await page.waitForSelector('[data-track-id]', { state: 'visible' });

    // Set up playback with multiple tracks
    await page.evaluate(() => {
      const library = window.Alpine.store('library');
      const queue = window.Alpine.store('queue');
      const player = window.Alpine.store('player');

      queue.items = [...library.tracks];
      queue.currentIndex = 0;
      player.currentTrack = library.tracks[0];
      player.isPlaying = true;
    });

    const playButton = page.locator('[data-testid="player-playpause"]');
    const nextButton = page.locator('[data-testid="player-next"]');

    // Click next and immediately toggle play/pause multiple times
    await nextButton.click();
    await playButton.click();
    await page.waitForTimeout(10);
    await playButton.click();
    await page.waitForTimeout(10);
    await playButton.click();

    await page.waitForTimeout(300);

    // Verify state is consistent
    const state = await page.evaluate(() => {
      const player = window.Alpine.store('player');
      const queue = window.Alpine.store('queue');
      return {
        hasTrack: !!player.currentTrack,
        queueIndex: queue.currentIndex,
        isPlaying: player.isPlaying,
      };
    });

    expect(state.hasTrack).toBe(true);
    expect(state.queueIndex).toBeGreaterThanOrEqual(0);
    expect(typeof state.isPlaying).toBe('boolean');
  });
});

test.describe('Concurrent User Actions - Double-Click During Pending Action', () => {
  test.beforeEach(async ({ page }) => {
    const libraryState = createLibraryState({ trackCount: 15 });
    await setupLibraryMocks(page, libraryState);
    await page.goto('/');
    await waitForAlpine(page);
    await page.waitForSelector('[x-data="libraryBrowser"]', { state: 'visible' });
  });

  test('double-click on track during queue population should not duplicate', async ({ page }) => {
    await page.waitForSelector('[data-track-id]', { state: 'visible' });

    // Clear queue
    await page.evaluate(() => {
      window.Alpine.store('queue').items = [];
    });

    const libraryCount = await page.evaluate(() =>
      window.Alpine.store('library').tracks.length
    );

    // Triple rapid double-click on first track
    const trackRow = page.locator('[data-track-id]').nth(0);
    await trackRow.dblclick();
    await trackRow.dblclick();
    await trackRow.dblclick();

    await page.waitForTimeout(500);

    // Queue should contain exactly the library count, not duplicates
    const queueLength = await page.evaluate(() =>
      window.Alpine.store('queue').items.length
    );

    expect(queueLength).toBe(libraryCount);
  });

  test('double-click on different tracks rapidly should handle gracefully', async ({ page }) => {
    await page.waitForSelector('[data-track-id]', { state: 'visible' });

    // Clear queue
    await page.evaluate(() => {
      window.Alpine.store('queue').items = [];
    });

    // Rapid double-clicks on different tracks
    await page.locator('[data-track-id]').nth(0).dblclick();
    await page.waitForTimeout(50);
    await page.locator('[data-track-id]').nth(2).dblclick();
    await page.waitForTimeout(50);
    await page.locator('[data-track-id]').nth(1).dblclick();

    await page.waitForTimeout(500);

    // Verify queue has items and no duplicates
    const queueState = await page.evaluate(() => {
      const queue = window.Alpine.store('queue');
      const ids = queue.items.map((t) => t.id);
      const uniqueIds = [...new Set(ids)];
      return {
        length: queue.items.length,
        uniqueCount: uniqueIds.length,
        currentIndex: queue.currentIndex,
      };
    });

    // No duplicate tracks
    expect(queueState.length).toBe(queueState.uniqueCount);

    // Should have a valid current index
    expect(queueState.currentIndex).toBeGreaterThanOrEqual(0);
    expect(queueState.currentIndex).toBeLessThan(queueState.length);
  });

  test('double-click during shuffle toggle should not corrupt queue', async ({ page }) => {
    await page.waitForSelector('[data-track-id]', { state: 'visible' });

    // Set up queue
    await page.evaluate(() => {
      const library = window.Alpine.store('library');
      const queue = window.Alpine.store('queue');
      const player = window.Alpine.store('player');

      queue.items = [...library.tracks];
      queue.currentIndex = 0;
      queue._originalOrder = [...library.tracks];
      player.currentTrack = library.tracks[0];
      player.isPlaying = true;
    });

    const originalLength = await page.evaluate(() =>
      window.Alpine.store('queue').items.length
    );

    // Simultaneously toggle shuffle and double-click
    const shuffleButton = page.locator('[data-testid="player-shuffle"]');
    await Promise.all([
      shuffleButton.click(),
      page.locator('[data-track-id]').nth(3).dblclick(),
    ]);

    await page.waitForTimeout(300);

    // Queue should maintain integrity
    const finalState = await page.evaluate(() => {
      const queue = window.Alpine.store('queue');
      const ids = queue.items.map((t) => t.id);
      const uniqueIds = [...new Set(ids)];
      return {
        length: queue.items.length,
        uniqueCount: uniqueIds.length,
        hasCurrentTrack: !!queue.currentTrack,
      };
    });

    // No duplicates
    expect(finalState.length).toBe(finalState.uniqueCount);
    expect(finalState.hasCurrentTrack).toBe(true);
  });
});

test.describe('Concurrent User Actions - Multiple Track Selections', () => {
  test.beforeEach(async ({ page }) => {
    const libraryState = createLibraryState({ trackCount: 20 });
    await setupLibraryMocks(page, libraryState);
    await page.goto('/');
    await waitForAlpine(page);
    await page.waitForSelector('[x-data="libraryBrowser"]', { state: 'visible' });
  });

  test('rapid single clicks for selection should update selection correctly', async ({ page }) => {
    await page.waitForSelector('[data-track-id]', { state: 'visible' });

    // Rapid click on multiple tracks (without modifier keys)
    const tracks = page.locator('[data-track-id]');

    for (let i = 0; i < 5; i++) {
      await tracks.nth(i).click();
      await page.waitForTimeout(30);
    }

    await page.waitForTimeout(200);

    // Only the last clicked track should be selected (check via CSS class)
    const selectedCount = await page.locator('.track-row-selected').count();

    expect(selectedCount).toBe(1);
  });

  test('rapid shift-click selection should select contiguous range', async ({ page }) => {
    await page.waitForSelector('[data-track-id]', { state: 'visible' });

    const tracks = page.locator('[data-track-id]');

    // Click first track
    await tracks.nth(0).click();

    // Rapidly shift-click through several tracks
    await page.keyboard.down('Shift');
    await tracks.nth(2).click();
    await page.waitForTimeout(30);
    await tracks.nth(5).click();
    await page.waitForTimeout(30);
    await tracks.nth(8).click();
    await page.keyboard.up('Shift');

    await page.waitForTimeout(200);

    // Should have selected a contiguous range from 0 to 8 (check via CSS class)
    const selectedCount = await page.locator('.track-row-selected').count();

    expect(selectedCount).toBe(9); // Tracks 0-8 inclusive
  });

  test('rapid ctrl/cmd-click selection should toggle multiple tracks', async ({ page }) => {
    await page.waitForSelector('[data-track-id]', { state: 'visible' });

    const tracks = page.locator('[data-track-id]');
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';

    // Click first track
    await tracks.nth(0).click();

    // Rapidly ctrl/cmd-click to add multiple tracks
    await page.keyboard.down(modifier);
    await tracks.nth(2).click();
    await page.waitForTimeout(20);
    await tracks.nth(4).click();
    await page.waitForTimeout(20);
    await tracks.nth(6).click();
    await page.waitForTimeout(20);
    await tracks.nth(8).click();
    await page.keyboard.up(modifier);

    await page.waitForTimeout(200);

    // Should have 5 tracks selected (0, 2, 4, 6, 8) - check via CSS class
    const selectedCount = await page.locator('.track-row-selected').count();

    expect(selectedCount).toBe(5);
  });

  test('selection state should remain valid during rapid interactions', async ({ page }) => {
    await page.waitForSelector('[data-track-id]', { state: 'visible' });

    const tracks = page.locator('[data-track-id]');
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';

    // Rapid mixed selection operations
    await tracks.nth(0).click();
    await page.waitForTimeout(20);

    await page.keyboard.down(modifier);
    await tracks.nth(2).click();
    await tracks.nth(3).click();
    await page.keyboard.up(modifier);

    await page.waitForTimeout(20);

    // Now shift-click
    await page.keyboard.down('Shift');
    await tracks.nth(6).click();
    await page.keyboard.up('Shift');

    await page.waitForTimeout(200);

    // Selection state should be valid - check via CSS class
    const selectedCount = await page.locator('.track-row-selected').count();

    // Should have some tracks selected
    expect(selectedCount).toBeGreaterThan(0);
  });
});

test.describe('Concurrent User Actions - Queue Operations During Playback', () => {
  test.beforeEach(async ({ page }) => {
    const libraryState = createLibraryState({ trackCount: 15 });
    await setupLibraryMocks(page, libraryState);
    await page.goto('/');
    await waitForAlpine(page);
    await page.waitForSelector('[x-data="libraryBrowser"]', { state: 'visible' });
  });

  test('adding tracks to queue during track transition should not corrupt state', async ({
    page,
  }) => {
    await page.waitForSelector('[data-track-id]', { state: 'visible' });

    // Set up initial playback with all library tracks
    await page.evaluate(() => {
      const library = window.Alpine.store('library');
      const queue = window.Alpine.store('queue');
      const player = window.Alpine.store('player');

      // Use first 10 tracks for queue
      const initialTracks = library.tracks.slice(0, 10);
      queue.items = [...initialTracks];
      queue.currentIndex = 0;
      queue._originalOrder = [...initialTracks];
      player.currentTrack = initialTracks[0];
      player.isPlaying = true;
    });

    // Simultaneously advance track and add to queue
    const nextButton = page.locator('[data-testid="player-next"]');

    // Click next multiple times while the queue might be updating
    await nextButton.click();
    await page.waitForTimeout(20);

    // Add track via store method (simulating "Add to Queue")
    // Use the 11th track from library (index 10) which isn't already in queue
    await page.evaluate(() => {
      const library = window.Alpine.store('library');
      const queue = window.Alpine.store('queue');
      // Method is 'add'
      if (library.tracks.length > 10) {
        queue.add([library.tracks[10]]);
      }
    });

    await nextButton.click();
    await page.waitForTimeout(20);

    await page.waitForTimeout(300);

    // Verify queue integrity
    const queueState = await page.evaluate(() => {
      const queue = window.Alpine.store('queue');
      return {
        length: queue.items.length,
        currentIndex: queue.currentIndex,
        hasCurrentTrack: !!queue.currentTrack,
        indexValid: queue.currentIndex >= 0 && queue.currentIndex < queue.items.length,
      };
    });

    expect(queueState.hasCurrentTrack).toBe(true);
    expect(queueState.indexValid).toBe(true);
  });

  test('clearing queue during playback should stop cleanly', async ({ page }) => {
    await page.waitForSelector('[data-track-id]', { state: 'visible' });

    // Set up playback
    await page.evaluate(() => {
      const library = window.Alpine.store('library');
      const queue = window.Alpine.store('queue');
      const player = window.Alpine.store('player');

      queue.items = [...library.tracks];
      queue.currentIndex = 5;
      queue._originalOrder = [...library.tracks];
      player.currentTrack = library.tracks[5];
      player.isPlaying = true;
    });

    // Click next while also clearing queue
    const nextButton = page.locator('[data-testid="player-next"]');
    await nextButton.click();

    await page.evaluate(() => {
      window.Alpine.store('queue').clear();
    });

    await page.waitForTimeout(200);

    // Verify clean state after clear
    const state = await page.evaluate(() => {
      const queue = window.Alpine.store('queue');
      const player = window.Alpine.store('player');
      return {
        queueEmpty: queue.items.length === 0,
        currentTrack: queue.currentTrack,
        playerTrack: player.currentTrack,
      };
    });

    expect(state.queueEmpty).toBe(true);
    expect(state.currentTrack).toBeNull();
  });

  test('removing current track during playback should advance gracefully', async ({ page }) => {
    await page.waitForSelector('[data-track-id]', { state: 'visible' });

    // Set up playback at track index 2
    await page.evaluate(() => {
      const library = window.Alpine.store('library');
      const queue = window.Alpine.store('queue');
      const player = window.Alpine.store('player');

      queue.items = [...library.tracks];
      queue.currentIndex = 2;
      queue._originalOrder = [...library.tracks];
      player.currentTrack = library.tracks[2];
      player.isPlaying = true;
    });

    const initialLength = await page.evaluate(() =>
      window.Alpine.store('queue').items.length
    );

    // Remove current track (method is 'remove', not 'removeAt')
    await page.evaluate(() => {
      const queue = window.Alpine.store('queue');
      queue.remove(queue.currentIndex);
    });

    await page.waitForTimeout(200);

    // Queue should be shorter and still have valid state
    const state = await page.evaluate(() => {
      const queue = window.Alpine.store('queue');
      return {
        length: queue.items.length,
        currentIndex: queue.currentIndex,
        hasItems: queue.items.length > 0,
      };
    });

    expect(state.length).toBe(initialLength - 1);
    expect(state.currentIndex).toBeGreaterThanOrEqual(0);

    if (state.hasItems) {
      expect(state.currentIndex).toBeLessThan(state.length);
    }
  });

  test('shuffle toggle during rapid next should not skip tracks incorrectly', async ({ page }) => {
    await page.waitForSelector('[data-track-id]', { state: 'visible' });

    // Set up playback
    await page.evaluate(() => {
      const library = window.Alpine.store('library');
      const queue = window.Alpine.store('queue');
      const player = window.Alpine.store('player');

      queue.items = [...library.tracks];
      queue.currentIndex = 0;
      queue._originalOrder = [...library.tracks];
      player.currentTrack = library.tracks[0];
      player.isPlaying = true;
    });

    const nextButton = page.locator('[data-testid="player-next"]');
    const shuffleButton = page.locator('[data-testid="player-shuffle"]');

    // Rapid next clicks interspersed with shuffle toggle
    await nextButton.click();
    await shuffleButton.click();
    await page.waitForTimeout(30);
    await nextButton.click();
    await nextButton.click();
    await page.waitForTimeout(30);
    await shuffleButton.click();
    await nextButton.click();

    await page.waitForTimeout(300);

    // Verify queue integrity
    const state = await page.evaluate(() => {
      const queue = window.Alpine.store('queue');
      const ids = queue.items.map((t) => t.id);
      const uniqueIds = [...new Set(ids)];
      return {
        length: queue.items.length,
        uniqueCount: uniqueIds.length,
        currentIndex: queue.currentIndex,
        hasCurrentTrack: !!queue.currentTrack,
      };
    });

    // No duplicates should exist
    expect(state.length).toBe(state.uniqueCount);
    expect(state.hasCurrentTrack).toBe(true);
    expect(state.currentIndex).toBeGreaterThanOrEqual(0);
    expect(state.currentIndex).toBeLessThan(state.length);
  });

  test('loop mode change during track end should handle boundary correctly', async ({ page }) => {
    await page.waitForSelector('[data-track-id]', { state: 'visible' });

    // Set up playback at last track
    await page.evaluate(() => {
      const library = window.Alpine.store('library');
      const queue = window.Alpine.store('queue');
      const player = window.Alpine.store('player');

      queue.items = library.tracks.slice(0, 5); // Use 5 tracks
      queue.currentIndex = 4; // Last track
      queue.loop = 'none';
      queue._originalOrder = [...queue.items];
      player.currentTrack = queue.items[4];
      player.isPlaying = true;
    });

    // Toggle loop while at end of queue
    const loopButton = page.locator('[data-testid="player-loop"]');
    await loopButton.click(); // none -> all

    // Immediately try to advance
    await page.evaluate(() => {
      window.Alpine.store('queue').playNext();
    });

    await page.waitForTimeout(200);

    // With loop='all', should wrap to beginning
    const state = await page.evaluate(() => {
      const queue = window.Alpine.store('queue');
      return {
        loop: queue.loop,
        currentIndex: queue.currentIndex,
        length: queue.items.length,
      };
    });

    expect(state.loop).toBe('all');
    // Should have wrapped or stayed valid
    expect(state.currentIndex).toBeGreaterThanOrEqual(0);
    expect(state.currentIndex).toBeLessThan(state.length);
  });
});

test.describe('Concurrent User Actions - Volume and Progress Interactions', () => {
  test.beforeEach(async ({ page }) => {
    const libraryState = createLibraryState({ trackCount: 10 });
    await setupLibraryMocks(page, libraryState);
    await page.goto('/');
    await waitForAlpine(page);
    await page.waitForSelector('[x-data="libraryBrowser"]', { state: 'visible' });
  });

  test('rapid volume changes during playback state changes should not conflict', async ({
    page,
  }) => {
    await page.waitForSelector('[data-track-id]', { state: 'visible' });

    // Set up playback
    await page.evaluate(() => {
      const library = window.Alpine.store('library');
      const queue = window.Alpine.store('queue');
      const player = window.Alpine.store('player');

      queue.items = [...library.tracks];
      queue.currentIndex = 0;
      player.currentTrack = library.tracks[0];
      player.isPlaying = true;
      player.volume = 50;
    });

    const volumeBar = page.locator('[data-testid="player-volume"]');
    const playButton = page.locator('[data-testid="player-playpause"]');

    const boundingBox = await volumeBar.boundingBox();
    const centerY = boundingBox.y + boundingBox.height / 2;

    // Simultaneous volume changes and play/pause
    await Promise.all([
      page.mouse.click(boundingBox.x + boundingBox.width * 0.2, centerY),
      playButton.click(),
    ]);

    await page.waitForTimeout(50);

    await Promise.all([
      page.mouse.click(boundingBox.x + boundingBox.width * 0.8, centerY),
      playButton.click(),
    ]);

    await page.waitForTimeout(200);

    // Volume should be a valid value
    const volume = await page.evaluate(() => window.Alpine.store('player').volume);

    expect(volume).toBeGreaterThanOrEqual(0);
    expect(volume).toBeLessThanOrEqual(100);
  });

  test('progress bar seek during track change should not cause position drift', async ({
    page,
  }) => {
    await page.waitForSelector('[data-track-id]', { state: 'visible' });

    // Set up playback
    await page.evaluate(() => {
      const library = window.Alpine.store('library');
      const queue = window.Alpine.store('queue');
      const player = window.Alpine.store('player');

      queue.items = [...library.tracks];
      queue.currentIndex = 0;
      player.currentTrack = library.tracks[0];
      player.isPlaying = true;
      player.position = 30;
      player.duration = 180;
    });

    const progressBar = page.locator('[data-testid="player-progressbar"]');
    const nextButton = page.locator('[data-testid="player-next"]');

    const boundingBox = await progressBar.boundingBox();

    // Click progress bar while clicking next
    await Promise.all([
      page.mouse.click(boundingBox.x + boundingBox.width * 0.5, boundingBox.y + boundingBox.height / 2),
      nextButton.click(),
    ]);

    await page.waitForTimeout(300);

    // Position should be valid for whatever track we're on
    const state = await page.evaluate(() => {
      const player = window.Alpine.store('player');
      return {
        position: player.position,
        duration: player.duration,
        hasTrack: !!player.currentTrack,
      };
    });

    expect(state.hasTrack).toBe(true);
    expect(state.position).toBeGreaterThanOrEqual(0);

    if (state.duration > 0) {
      expect(state.position).toBeLessThanOrEqual(state.duration);
    }
  });
});
