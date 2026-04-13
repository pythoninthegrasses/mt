/**
 * Property-based tests for queue store using fast-check
 *
 * These tests verify invariants and catch edge cases that are difficult
 * to find with example-based testing.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fc, test } from '@fast-check/vitest';

// Mock Alpine
const Alpine = {
  stores: {},
  store(name, value) {
    if (value) {
      this.stores[name] = value;
    }
    return this.stores[name];
  },
};

// Mock API
vi.mock('../js/api/queue.js', () => ({
  queue: {
    get: vi.fn().mockResolvedValue({ items: [], currentIndex: -1 }),
    save: vi.fn().mockResolvedValue({}),
    add: vi.fn().mockResolvedValue({}),
    remove: vi.fn().mockResolvedValue({}),
    clear: vi.fn().mockResolvedValue({}),
    move: vi.fn().mockResolvedValue({}),
    setShuffle: vi.fn().mockResolvedValue({}),
    setLoop: vi.fn().mockResolvedValue({}),
    setCurrentIndex: vi.fn().mockResolvedValue({}),
    addPlayNext: vi.fn().mockResolvedValue({}),
    playNextTrack: vi.fn().mockResolvedValue({}),
    playPreviousTrack: vi.fn().mockResolvedValue({}),
    skipNext: vi.fn().mockResolvedValue({}),
    skipPrevious: vi.fn().mockResolvedValue({}),
    checkIntegrity: vi.fn().mockResolvedValue({}),
  },
}));

import { queue as queueApi } from '../js/api/queue.js';

// Mock Tauri
global.window = {
  __TAURI__: undefined,
};

// Import after mocks
import { createQueueStore } from '../js/stores/queue.js';

// Arbitraries for generating test data
const trackArbitrary = fc.integer({ min: 1, max: 10000 }).map((id) => ({
  id,
  title: `Track ${id}`,
  artist: `Artist ${id}`,
  album: `Album ${id}`,
  duration: 180000,
  filepath: `/path/track${id}.mp3`,
}));

const trackListArbitrary = fc.uniqueArray(trackArbitrary, {
  minLength: 0,
  maxLength: 100,
  selector: (track) => track.id, // Ensure unique IDs
});

describe('Queue Store - Property-Based Tests', () => {
  let store;

  beforeEach(() => {
    Alpine.stores = {};
    Alpine.store('player', {
      stop: vi.fn(),
      playTrack: vi.fn().mockResolvedValue({}),
    });
    createQueueStore(Alpine);
    store = Alpine.store('queue');
  });

  describe('Shuffle (Backend-Delegated)', () => {
    test.prop([trackListArbitrary])(
      'toggleShuffle calls setShuffle with inverted state',
      async (tracks) => {
        fc.pre(tracks.length >= 1);

        store.items = [...tracks];
        store.currentIndex = 0;
        store.shuffle = false;

        // Mock backend returning a snapshot
        const snapshot = {
          items: tracks.map((t) => ({ track: t })),
          current_index: 0,
          shuffle_enabled: true,
          loop_mode: 'none',
          play_next_offset: 0,
        };
        queueApi.setShuffle.mockResolvedValue(snapshot);

        await store.toggleShuffle();

        expect(queueApi.setShuffle).toHaveBeenCalledWith(true);
      },
    );

    test.prop([trackListArbitrary])(
      'toggleShuffle applies snapshot from backend',
      async (tracks) => {
        fc.pre(tracks.length >= 2);

        store.items = [...tracks];
        store.currentIndex = 0;
        store.shuffle = false;

        // Simulate backend returning shuffled order
        const shuffled = [...tracks].reverse();
        const snapshot = {
          items: shuffled.map((t) => ({ track: t })),
          current_index: 0,
          shuffle_enabled: true,
          loop_mode: 'none',
          play_next_offset: 0,
        };
        queueApi.setShuffle.mockResolvedValue(snapshot);

        await store.toggleShuffle();

        expect(store.shuffle).toBe(true);
        expect(store.items.map((t) => t.id)).toEqual(shuffled.map((t) => t.id));
        expect(store.currentIndex).toBe(0);
      },
    );

    it('toggleShuffle handles API error gracefully', async () => {
      store.items = [{ id: 1, title: 'A' }];
      store.shuffle = false;

      queueApi.setShuffle.mockRejectedValue(new Error('IPC failed'));
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await store.toggleShuffle();

      // Shuffle state should not change on error
      expect(store.shuffle).toBe(false);

      consoleSpy.mockRestore();
    });
  });

  describe('Reorder Invariants', () => {
    test.prop([trackListArbitrary, fc.nat(), fc.nat()])(
      'reorder preserves track count',
      async (tracks, fromIdx, toIdx) => {
        fc.pre(tracks.length > 0);
        const from = fromIdx % tracks.length;
        const to = toIdx % tracks.length;

        store.items = [...tracks];
        const originalLength = store.items.length;

        await store.reorder(from, to);

        expect(store.items.length).toBe(originalLength);
      },
    );

    test.prop([trackListArbitrary, fc.nat(), fc.nat()])(
      'reorder preserves all tracks',
      async (tracks, fromIdx, toIdx) => {
        fc.pre(tracks.length > 0);
        const from = fromIdx % tracks.length;
        const to = toIdx % tracks.length;

        store.items = [...tracks];
        const originalIds = new Set(tracks.map((t) => t.id));

        await store.reorder(from, to);

        const reorderedIds = new Set(store.items.map((t) => t.id));
        expect(reorderedIds).toEqual(originalIds);
      },
    );

    test.prop([trackListArbitrary, fc.nat()])(
      'reorder to same index is no-op',
      async (tracks, idx) => {
        fc.pre(tracks.length > 0);
        const index = idx % tracks.length;

        store.items = [...tracks];
        const originalOrder = tracks.map((t) => t.id);

        await store.reorder(index, index);

        const resultOrder = store.items.map((t) => t.id);
        expect(resultOrder).toEqual(originalOrder);
      },
    );

    test.prop([trackListArbitrary, fc.nat(), fc.nat()])(
      'reorder moves track to correct position',
      async (tracks, fromIdx, toIdx) => {
        fc.pre(tracks.length > 0);
        const from = fromIdx % tracks.length;
        const to = toIdx % tracks.length;
        fc.pre(from !== to);

        store.items = [...tracks];
        const movingTrack = tracks[from];

        await store.reorder(from, to);

        expect(store.items[to].id).toBe(movingTrack.id);
      },
    );
  });

  describe('Add/Remove Invariants', () => {
    test.prop([trackListArbitrary, trackArbitrary])(
      'add increases queue size by 1',
      async (tracks, newTrack) => {
        store.items = [...tracks];
        const originalSize = store.items.length;

        await store.add(newTrack);

        expect(store.items.length).toBe(originalSize + 1);
      },
    );

    test.prop([trackListArbitrary, trackArbitrary])(
      'add places track at end',
      async (tracks, newTrack) => {
        store.items = [...tracks];

        await store.add(newTrack);

        const lastTrack = store.items[store.items.length - 1];
        expect(lastTrack.id).toBe(newTrack.id);
      },
    );

    test.prop([trackListArbitrary, fc.nat()])(
      'remove decreases queue size by 1',
      async (tracks, idx) => {
        fc.pre(tracks.length > 0);
        const index = idx % tracks.length;

        store.items = [...tracks];
        const originalSize = store.items.length;

        await store.remove(index);

        expect(store.items.length).toBe(originalSize - 1);
      },
    );

    test.prop([trackListArbitrary, fc.nat()])(
      'remove preserves other tracks',
      async (tracks, idx) => {
        fc.pre(tracks.length > 1);
        const index = idx % tracks.length;

        store.items = [...tracks];
        const removedTrackId = tracks[index].id;
        const otherTrackIds = tracks.filter((_, i) => i !== index).map((t) => t.id);

        await store.remove(index);

        const remainingIds = store.items.map((t) => t.id);
        expect(remainingIds).toEqual(otherTrackIds);
        expect(remainingIds).not.toContain(removedTrackId);
      },
    );

    test.prop([trackListArbitrary])('clear empties queue', async (tracks) => {
      store.items = [...tracks];

      await store.clear();

      expect(store.items.length).toBe(0);
      expect(store.currentIndex).toBe(-1);
    });

    test.prop([trackListArbitrary, fc.nat(), trackArbitrary])(
      'insert at position places track correctly',
      async (tracks, idx, newTrack) => {
        fc.pre(tracks.length > 0);
        const index = idx % tracks.length;

        store.items = [...tracks];

        await store.insert(index, newTrack);

        expect(store.items[index].id).toBe(newTrack.id);
        expect(store.items.length).toBe(tracks.length + 1);
      },
    );
  });

  describe('CurrentIndex Invariants', () => {
    test.prop([trackListArbitrary, fc.nat()])(
      'currentIndex stays in bounds after remove',
      async (tracks, idx) => {
        fc.pre(tracks.length > 0);
        const removeIdx = idx % tracks.length;

        store.items = [...tracks];
        store.currentIndex = Math.min(tracks.length - 1, removeIdx + 1);

        await store.remove(removeIdx);

        expect(store.currentIndex).toBeGreaterThanOrEqual(-1);
        expect(store.currentIndex).toBeLessThan(store.items.length);
      },
    );

    test.prop([trackListArbitrary, fc.nat()])(
      'removing current track updates index appropriately',
      async (tracks, idx) => {
        fc.pre(tracks.length > 0);
        const currentIdx = idx % tracks.length;

        store.items = [...tracks];
        store.currentIndex = currentIdx;

        await store.remove(currentIdx);

        if (store.items.length === 0) {
          expect(store.currentIndex).toBe(-1);
        } else {
          expect(store.currentIndex).toBeLessThan(store.items.length);
          expect(store.currentIndex).toBeGreaterThanOrEqual(0);
        }
      },
    );

    test.prop([trackListArbitrary, fc.nat(), fc.nat()])(
      'reorder preserves current track reference',
      async (tracks, fromIdx, currentIdx) => {
        fc.pre(tracks.length > 2);
        const from = fromIdx % tracks.length;
        const to = (fromIdx + 1) % tracks.length;
        const current = currentIdx % tracks.length;

        store.items = [...tracks];
        store.currentIndex = current;
        const currentTrack = tracks[current];

        await store.reorder(from, to);

        const newCurrentTrack = store.items[store.currentIndex];
        expect(newCurrentTrack.id).toBe(currentTrack.id);
      },
    );
  });

  describe('Loop Mode Invariants', () => {
    test.prop([fc.constantFrom('none', 'all', 'one')])(
      'setLoop updates mode correctly',
      async (mode) => {
        await store.setLoop(mode);
        expect(store.loop).toBe(mode);
      },
    );

    it('cycleLoop progresses through modes in order', async () => {
      expect(store.loop).toBe('none');

      await store.cycleLoop();
      expect(store.loop).toBe('all');

      await store.cycleLoop();
      expect(store.loop).toBe('one');

      await store.cycleLoop();
      expect(store.loop).toBe('none');
    });

    test.prop([trackListArbitrary])(
      'hasNext is true when loop=all regardless of position',
      async (tracks) => {
        fc.pre(tracks.length > 0);

        store.items = [...tracks];
        store.currentIndex = tracks.length - 1; // Last track
        store.loop = 'all';

        expect(store.hasNext).toBe(true);
      },
    );

    test.prop([trackListArbitrary])('hasNext is false at end when loop=none', async (tracks) => {
      fc.pre(tracks.length > 0);

      store.items = [...tracks];
      store.currentIndex = tracks.length - 1; // Last track
      store.loop = 'none';

      expect(store.hasNext).toBe(false);
    });

    test.prop([trackListArbitrary])(
      'hasPrevious is true when loop=all at first track',
      async (tracks) => {
        fc.pre(tracks.length > 0);

        store.items = [...tracks];
        store.currentIndex = 0;
        store.loop = 'all';

        expect(store.hasPrevious).toBe(true);
      },
    );
  });

  describe('Play Order Invariants', () => {
    test.prop([trackListArbitrary])(
      'playOrderItems includes all upcoming tracks',
      async (tracks) => {
        fc.pre(tracks.length > 1);

        store.items = [...tracks];
        store.currentIndex = 0;
        store.loop = 'none';

        const playOrder = store.playOrderItems;

        expect(playOrder.length).toBe(tracks.length);
        expect(playOrder[0].isCurrentTrack).toBe(true);
        expect(playOrder.slice(1).every((item) => item.isUpcoming)).toBe(true);
      },
    );

    test.prop([trackListArbitrary, fc.nat()])(
      'playOrderItems wraps around when loop=all',
      async (tracks, idx) => {
        fc.pre(tracks.length > 1);
        const current = idx % tracks.length;

        store.items = [...tracks];
        store.currentIndex = current;
        store.loop = 'all';

        const playOrder = store.playOrderItems;

        // Should include all tracks
        expect(playOrder.length).toBe(tracks.length);

        // First item should be current track
        expect(playOrder[0].originalIndex).toBe(current);
        expect(playOrder[0].isCurrentTrack).toBe(true);
      },
    );

    test.prop([trackListArbitrary])('upcomingTracks excludes current track', async (tracks) => {
      fc.pre(tracks.length > 1);

      store.items = [...tracks];
      store.currentIndex = 0;

      const upcoming = store.upcomingTracks;

      expect(upcoming.every((item) => !item.isCurrentTrack)).toBe(true);
      expect(upcoming.length).toBe(tracks.length - 1);
    });
  });

  describe('Play Next (Backend-Delegated)', () => {
    test.prop([
      trackListArbitrary,
      fc.array(trackArbitrary, { minLength: 1, maxLength: 5 }),
    ])(
      'playNextTracks calls addPlayNext with track IDs',
      async (tracks, playNextTracks) => {
        fc.pre(tracks.length >= 1);

        store.items = [...tracks];
        store.currentIndex = 0;

        // Mock backend returning a snapshot with all tracks
        const allTracks = [...tracks, ...playNextTracks];
        const snapshot = {
          items: allTracks.map((t) => ({ track: t })),
          current_index: 0,
          shuffle_enabled: false,
          loop_mode: 'none',
          play_next_offset: playNextTracks.length,
        };
        queueApi.addPlayNext.mockResolvedValue(snapshot);

        await store.playNextTracks(playNextTracks);

        expect(queueApi.addPlayNext).toHaveBeenCalledWith(
          playNextTracks.map((t) => t.id),
        );
      },
    );

    test.prop([trackListArbitrary, fc.array(trackArbitrary, { minLength: 1, maxLength: 5 })])(
      'playNextTracks applies snapshot from backend',
      async (tracks, playNextTracks) => {
        fc.pre(tracks.length >= 1);

        store.items = [...tracks];
        store.currentIndex = 0;

        const resultTracks = [...tracks, ...playNextTracks];
        const snapshot = {
          items: resultTracks.map((t) => ({ track: t })),
          current_index: 0,
          shuffle_enabled: false,
          loop_mode: 'none',
          play_next_offset: playNextTracks.length,
        };
        queueApi.addPlayNext.mockResolvedValue(snapshot);

        await store.playNextTracks(playNextTracks);

        // Items should be set from snapshot
        expect(store.items.length).toBe(resultTracks.length);
        expect(store.currentIndex).toBe(0);
      },
    );
  });

  describe('Edge Cases', () => {
    test.prop([trackListArbitrary])('operations on empty queue are safe', async (tracks) => {
      store.items = [];
      store.currentIndex = -1;

      // Should not throw
      await expect(store.clear()).resolves.not.toThrow();
      await expect(store.remove(0)).resolves.not.toThrow();
      await expect(store.reorder(0, 1)).resolves.not.toThrow();
    });

    test.prop([fc.nat()])('operations with out-of-bounds indices are safe', async (idx) => {
      fc.pre(idx > 100);

      store.items = [];

      await expect(store.remove(idx)).resolves.not.toThrow();
      await expect(store.playIndex(idx)).resolves.not.toThrow();
    });

    test.prop([trackArbitrary])('single track queue operations work correctly', async (track) => {
      store.items = [track];
      store.currentIndex = 0;

      // Remove should empty queue
      await store.remove(0);
      expect(store.items.length).toBe(0);
      expect(store.currentIndex).toBe(-1);
    });
  });

  describe('Concurrent Modifications', () => {
    test.prop([trackListArbitrary, fc.array(trackArbitrary, { minLength: 1, maxLength: 10 })])(
      'multiple adds preserve all tracks',
      async (initialTracks, tracksToAdd) => {
        store.items = [...initialTracks];

        // Add all tracks
        for (const track of tracksToAdd) {
          await store.add(track);
        }

        expect(store.items.length).toBe(initialTracks.length + tracksToAdd.length);

        // All original tracks should be present
        const allIds = store.items.map((t) => t.id);
        for (const track of initialTracks) {
          expect(allIds).toContain(track.id);
        }

        // All new tracks should be present
        for (const track of tracksToAdd) {
          expect(allIds).toContain(track.id);
        }
      },
    );

    test.prop([trackListArbitrary, fc.array(fc.nat(), { minLength: 1, maxLength: 5 })])(
      'multiple removes maintain consistency',
      async (tracks, indicesToRemove) => {
        fc.pre(tracks.length > indicesToRemove.length);

        store.items = [...tracks];
        const originalSize = store.items.length;

        // Remove tracks (adjust indices after each remove)
        const sortedIndices = indicesToRemove
          .map((idx) => idx % tracks.length)
          .sort((a, b) => b - a); // Remove from end to start

        for (const idx of sortedIndices) {
          if (idx < store.items.length) {
            await store.remove(idx);
          }
        }

        // Queue should be smaller but not negative
        expect(store.items.length).toBeGreaterThanOrEqual(0);
        expect(store.items.length).toBeLessThan(originalSize);

        // CurrentIndex should be valid
        if (store.items.length > 0) {
          expect(store.currentIndex).toBeLessThan(store.items.length);
          expect(store.currentIndex).toBeGreaterThanOrEqual(-1);
        } else {
          expect(store.currentIndex).toBe(-1);
        }
      },
    );
  });
});
