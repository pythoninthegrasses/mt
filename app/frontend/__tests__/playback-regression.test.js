/**
 * @vitest-environment jsdom
 *
 * Regression tests for play/pause (task-279)
 *
 * Covers:
 * - Store initialization order: queue.clear() must not crash when player
 *   store exists (previously crashed if queue was registered before player)
 * - Play/pause toggle state transitions
 * - Queue/player store interaction during clear and track removal
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTauriMock } from './mocks/tauri.js';

global.window = createTauriMock({
  invokeReturns: {
    audio_get_status: { volume: 1.0, state: 'Stopped' },
    queue_get: { items: [], current_index: -1 },
    queue_get_playback_state: { shuffle: false, loop: 'none', current_index: -1 },
  },
});

vi.mock('../js/api.js', async () => {
  const { createApiMock } = await import('./mocks/api.js');
  return createApiMock({
    queue: {
      get: vi.fn().mockResolvedValue({ items: [], current_index: -1 }),
      clear: vi.fn().mockResolvedValue({}),
      add: vi.fn().mockResolvedValue({}),
      remove: vi.fn().mockResolvedValue({}),
      reorder: vi.fn().mockResolvedValue({}),
    },
  });
});

import { createPlayerStore } from '../js/stores/player.js';
import { createQueueStore } from '../js/stores/queue.js';

// Minimal Alpine mock that behaves like the real Alpine.store() registry
function createAlpineMock() {
  const stores = {};
  return {
    stores,
    store(name, value) {
      if (value !== undefined) {
        stores[name] = value;
      }
      return stores[name];
    },
  };
}

describe('Play/Pause Regression (task-279)', () => {
  let Alpine;

  beforeEach(() => {
    Alpine = createAlpineMock();

    // Register UI and library stubs (no dependency on player/queue)
    Alpine.store('ui', {
      view: 'library',
      showMissingTrackModal: vi.fn().mockResolvedValue({ result: 'skip' }),
      toast: vi.fn(),
    });
    Alpine.store('library', {
      tracks: [],
      filteredTracks: [],
      refreshIfLikedSongs: vi.fn(),
    });
  });

  describe('Store initialization order', () => {
    it('queue.clear() does not crash when player store is registered first', () => {
      // Register player THEN queue (correct order after fix)
      createPlayerStore(Alpine);
      createQueueStore(Alpine);

      const queue = Alpine.store('queue');
      // clear() calls Alpine.store('player')?.stop() — should not throw
      expect(() => queue.clear()).not.toThrow();
    });

    it('queue.clear() does not crash even if player store is missing', () => {
      // Register queue WITHOUT player (regression scenario before fix)
      createQueueStore(Alpine);

      const queue = Alpine.store('queue');
      // With optional chaining fix, this should not throw
      expect(() => queue.clear()).not.toThrow();
    });

    it('both stores initialize successfully when player is registered before queue', () => {
      createPlayerStore(Alpine);
      createQueueStore(Alpine);

      const player = Alpine.store('player');
      const queue = Alpine.store('queue');

      expect(player).toBeDefined();
      expect(player.isPlaying).toBe(false);
      expect(player.currentTrack).toBeNull();
      expect(player.volume).toBeDefined();

      expect(queue).toBeDefined();
      expect(queue.items).toEqual([]);
      expect(queue.currentIndex).toBe(-1);
      expect(queue.shuffle).toBe(false);
      expect(queue.loop).toBeDefined();
    });

    it('player store has all required methods after init', () => {
      createPlayerStore(Alpine);
      const player = Alpine.store('player');

      // All playback methods must exist
      expect(typeof player.togglePlay).toBe('function');
      expect(typeof player.pause).toBe('function');
      expect(typeof player.resume).toBe('function');
      expect(typeof player.stop).toBe('function');
      expect(typeof player.playTrack).toBe('function');
      expect(typeof player.seek).toBe('function');
      expect(typeof player.setVolume).toBe('function');
      expect(typeof player.toggleMute).toBe('function');
      expect(typeof player.next).toBe('function');
      expect(typeof player.previous).toBe('function');
      expect(typeof player._updateNowPlayingState).toBe('function');
      expect(typeof player._updateNowPlayingMetadata).toBe('function');
    });
  });

  describe('Play/pause toggle state transitions', () => {
    let player;

    beforeEach(() => {
      // Provide a queue stub with methods the player calls
      Alpine.store('queue', {
        items: [],
        currentIndex: -1,
        playNext: vi.fn(),
        skipNext: vi.fn(),
        skipPrevious: vi.fn(),
        playIndex: vi.fn(),
        add: vi.fn(),
      });
      createPlayerStore(Alpine);
      player = Alpine.store('player');
    });

    it('togglePlay calls pause when currently playing', async () => {
      player.isPlaying = true;
      player.currentTrack = { id: 1, title: 'Test', filepath: '/test.mp3' };

      const pauseSpy = vi.spyOn(player, 'pause');
      await player.togglePlay();

      expect(pauseSpy).toHaveBeenCalled();
    });

    it('togglePlay calls resume when paused with a current track', async () => {
      player.isPlaying = false;
      player.currentTrack = { id: 1, title: 'Test', filepath: '/test.mp3' };

      const resumeSpy = vi.spyOn(player, 'resume');
      await player.togglePlay();

      expect(resumeSpy).toHaveBeenCalled();
    });

    it('togglePlay queues library tracks when no track and empty queue', async () => {
      player.isPlaying = false;
      player.currentTrack = null;

      const queue = Alpine.store('queue');
      queue.items = [];

      const mockTracks = [{ id: 1, title: 'Track 1' }, { id: 2, title: 'Track 2' }];
      Alpine.store('library').filteredTracks = mockTracks;

      await player.togglePlay();

      expect(queue.add).toHaveBeenCalledWith(mockTracks, true);
    });

    it('togglePlay plays from queue when tracks exist but no current track', async () => {
      player.isPlaying = false;
      player.currentTrack = null;

      const queue = Alpine.store('queue');
      queue.items = [{ id: 1, title: 'Track 1' }];
      queue.currentIndex = -1;

      await player.togglePlay();

      expect(queue.playIndex).toHaveBeenCalledWith(0);
    });

    it('pause/resume are idempotent on isPlaying flag', async () => {
      player.isPlaying = true;
      player.currentTrack = { id: 1, title: 'Test' };

      // Multiple pauses should not break state
      await player.pause();
      expect(player.isPlaying).toBe(false);

      await player.pause();
      expect(player.isPlaying).toBe(false);

      // Multiple resumes should not break state
      await player.resume();
      expect(player.isPlaying).toBe(true);

      await player.resume();
      expect(player.isPlaying).toBe(true);
    });
  });

  describe('Queue/player interaction', () => {
    it('queue.remove does not crash when removing the last track', () => {
      createPlayerStore(Alpine);
      createQueueStore(Alpine);

      const queue = Alpine.store('queue');
      queue.items = [{ id: 1, title: 'Only Track' }];
      queue.currentIndex = 0;

      // Removing the only track triggers player.stop() via optional chaining
      expect(() => queue.remove(0)).not.toThrow();
      expect(queue.items.length).toBe(0);
      expect(queue.currentIndex).toBe(-1);
    });

    it('queue.clear resets queue state and calls player.stop', () => {
      createPlayerStore(Alpine);
      createQueueStore(Alpine);

      const queue = Alpine.store('queue');
      const player = Alpine.store('player');

      queue.items = [{ id: 1 }, { id: 2 }, { id: 3 }];
      queue.currentIndex = 1;

      const stopSpy = vi.spyOn(player, 'stop');
      queue.clear();

      expect(queue.items).toEqual([]);
      expect(queue.currentIndex).toBe(-1);
      expect(stopSpy).toHaveBeenCalled();
    });

    it('player default state is stopped with no track', () => {
      createPlayerStore(Alpine);
      const player = Alpine.store('player');

      expect(player.isPlaying).toBe(false);
      expect(player.currentTrack).toBeNull();
      expect(player.progress).toBe(0);
      expect(player.currentTime).toBe(0);
      expect(player.duration).toBe(0);
    });
  });
});
