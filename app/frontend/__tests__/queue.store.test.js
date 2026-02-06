/**
 * Property-based tests for the Queue Store
 *
 * These tests verify invariants that should hold for ALL valid inputs,
 * not just specific examples. fast-check generates random inputs and
 * sequences of operations to find edge cases.
 *
 * Key invariants tested:
 * 1. Index bounds: currentIndex is always valid (-1 or within items range)
 * 2. Permutation preservation: shuffle/unshuffle preserves all track IDs
 * 3. Operation sequences: invariants hold after arbitrary operation sequences
 */

import { test, fc } from '@fast-check/vitest';
import { describe, expect, beforeEach, vi } from 'vitest';

// -----------------------------------------------------------------------------
// Test Helpers: Create isolated queue store instances for testing
// -----------------------------------------------------------------------------

/**
 * Create a minimal queue store for testing (no Alpine/API dependencies)
 * This extracts the pure logic from the store for isolated testing.
 */
function createTestQueueStore(initialItems = [], initialIndex = -1) {
  return {
    items: [...initialItems],
    currentIndex: initialIndex,
    shuffle: false,
    loop: 'none',
    _originalOrder: [...initialItems],
    _repeatOnePending: false,
    _playNextOffset: 0,

    // --- Core operations (simplified, synchronous versions) ---

    add(tracks) {
      const tracksArray = Array.isArray(tracks) ? tracks : [tracks];
      this.items.push(...tracksArray);
      this._originalOrder.push(...tracksArray);
    },

    insert(index, tracks) {
      const tracksArray = Array.isArray(tracks) ? tracks : [tracks];
      this.items.splice(index, 0, ...tracksArray);
      if (this.currentIndex >= index) {
        this.currentIndex += tracksArray.length;
      }
    },

    playNextTracks(tracks) {
      const tracksArray = Array.isArray(tracks) ? tracks : [tracks];
      if (tracksArray.length === 0) return;
      if (!this._playNextOffset) this._playNextOffset = 0;
      const insertIndex = (this.currentIndex >= 0 ? this.currentIndex + 1 : 0) + this._playNextOffset;
      this._playNextOffset += tracksArray.length;
      this.insert(insertIndex, tracksArray);
    },

    remove(index) {
      if (index < 0 || index >= this.items.length) return;
      this.items.splice(index, 1);
      if (index < this.currentIndex) {
        this.currentIndex--;
      } else if (index === this.currentIndex) {
        if (this.items.length === 0) {
          this.currentIndex = -1;
        } else if (this.currentIndex >= this.items.length) {
          this.currentIndex = this.items.length - 1;
        }
      }
    },

    clear() {
      this.items = [];
      this.currentIndex = -1;
      this._originalOrder = [];
    },

    reorder(from, to) {
      if (from === to) return;
      if (from < 0 || from >= this.items.length) return;
      if (to < 0 || to >= this.items.length) return;

      const [item] = this.items.splice(from, 1);
      this.items.splice(to, 0, item);

      if (from === this.currentIndex) {
        this.currentIndex = to;
      } else if (from < this.currentIndex && to >= this.currentIndex) {
        this.currentIndex--;
      } else if (from > this.currentIndex && to <= this.currentIndex) {
        this.currentIndex++;
      }
    },

    playIndex(index) {
      if (index < 0 || index >= this.items.length) return;
      this._playNextOffset = 0;
      this.currentIndex = index;
    },

    toggleShuffle() {
      this.shuffle = !this.shuffle;
      if (this.shuffle) {
        this._originalOrder = [...this.items];
        this._shuffleItems();
      } else {
        const currentTrack = this.items[this.currentIndex];
        this.items = [...this._originalOrder];
        this.currentIndex = this.items.findIndex((t) => t.id === currentTrack?.id);
        if (this.currentIndex < 0) {
          this.currentIndex = this.items.length > 0 ? 0 : -1;
        }
      }
    },

    _shuffleItems() {
      if (this.items.length < 2) return;
      const currentTrack = this.currentIndex >= 0 ? this.items[this.currentIndex] : null;
      const otherTracks = currentTrack
        ? this.items.filter((_, i) => i !== this.currentIndex)
        : [...this.items];

      // Fisher-Yates shuffle
      for (let i = otherTracks.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [otherTracks[i], otherTracks[j]] = [otherTracks[j], otherTracks[i]];
      }

      if (currentTrack) {
        this.items = [currentTrack, ...otherTracks];
        this.currentIndex = 0;
      } else {
        this.items = otherTracks;
      }
    },

    cycleLoop() {
      const modes = ['none', 'all', 'one'];
      const currentIdx = modes.indexOf(this.loop);
      this.loop = modes[(currentIdx + 1) % modes.length];
      this._repeatOnePending = false;
    },

    // --- Computed properties ---

    get currentTrack() {
      return this.currentIndex >= 0 ? this.items[this.currentIndex] : null;
    },

    get hasNext() {
      if (this.items.length === 0) return false;
      if (this.loop !== 'none') return true;
      return this.currentIndex < this.items.length - 1;
    },

    get hasPrevious() {
      if (this.items.length === 0) return false;
      if (this.loop !== 'none') return true;
      return this.currentIndex > 0;
    },
  };
}

// -----------------------------------------------------------------------------
// Arbitraries: Generators for random test data
// -----------------------------------------------------------------------------

/** Generate a track object with unique ID */
const trackArb = fc.record({
  id: fc.uuid(),
  title: fc.string({ minLength: 1, maxLength: 50 }),
  artist: fc.string({ minLength: 1, maxLength: 50 }),
  album: fc.string({ minLength: 1, maxLength: 50 }),
  duration: fc.integer({ min: 1000, max: 600000 }), // 1s to 10min in ms
  filepath: fc.string({ minLength: 1, maxLength: 100 }),
});

/** Generate an array of tracks with unique IDs */
const tracksArb = fc.array(trackArb, { minLength: 0, maxLength: 20 });

/** Generate a non-empty array of tracks */
const nonEmptyTracksArb = fc.array(trackArb, { minLength: 1, maxLength: 20 });

/** Generate a valid index for a given array length */
const validIndexArb = (length) =>
  length > 0 ? fc.integer({ min: 0, max: length - 1 }) : fc.constant(-1);

// -----------------------------------------------------------------------------
// Property Tests: Index Bounds Invariants
// -----------------------------------------------------------------------------

describe('Queue Store - Index Bounds Invariants', () => {
  test.prop([tracksArb])('currentIndex is -1 when queue is empty', (tracks) => {
    const store = createTestQueueStore();
    // Add then clear
    store.add(tracks);
    store.clear();

    expect(store.currentIndex).toBe(-1);
    expect(store.items.length).toBe(0);
  });

  test.prop([nonEmptyTracksArb, fc.integer({ min: 0, max: 100 })])(
    'currentIndex stays within bounds after playIndex',
    (tracks, rawIndex) => {
      const store = createTestQueueStore(tracks);
      const index = rawIndex % (tracks.length + 5); // May be out of bounds

      store.playIndex(index);

      // If index was valid, it should be set; otherwise unchanged
      if (index >= 0 && index < tracks.length) {
        expect(store.currentIndex).toBe(index);
      }
      // Invariant: currentIndex is always valid or -1
      expect(
        store.currentIndex === -1 ||
          (store.currentIndex >= 0 && store.currentIndex < store.items.length)
      ).toBe(true);
    }
  );

  test.prop([nonEmptyTracksArb, fc.integer({ min: 0, max: 19 })])(
    'currentIndex adjusts correctly after remove',
    (tracks, removeOffset) => {
      const store = createTestQueueStore(tracks);
      const removeIndex = removeOffset % tracks.length;

      // Set current to middle of queue
      const initialCurrent = Math.floor(tracks.length / 2);
      store.playIndex(initialCurrent);

      store.remove(removeIndex);

      // Invariant: currentIndex is always valid or -1
      if (store.items.length === 0) {
        expect(store.currentIndex).toBe(-1);
      } else {
        expect(store.currentIndex).toBeGreaterThanOrEqual(0);
        expect(store.currentIndex).toBeLessThan(store.items.length);
      }
    }
  );

  test.prop([nonEmptyTracksArb, fc.integer({ min: 0, max: 19 }), fc.integer({ min: 0, max: 19 })])(
    'currentIndex adjusts correctly after reorder',
    (tracks, fromOffset, toOffset) => {
      if (tracks.length < 2) return; // Need at least 2 items to reorder

      const store = createTestQueueStore(tracks);
      const from = fromOffset % tracks.length;
      const to = toOffset % tracks.length;

      // Set current to a known position
      const initialCurrent = Math.min(1, tracks.length - 1);
      store.playIndex(initialCurrent);
      const currentTrackId = store.currentTrack?.id;

      store.reorder(from, to);

      // Invariant: currentIndex points to the same track
      if (currentTrackId) {
        expect(store.currentTrack?.id).toBe(currentTrackId);
      }
      // Invariant: currentIndex is within bounds
      expect(store.currentIndex).toBeGreaterThanOrEqual(0);
      expect(store.currentIndex).toBeLessThan(store.items.length);
    }
  );
});

// -----------------------------------------------------------------------------
// Property Tests: Permutation Preservation (Shuffle/Unshuffle)
// -----------------------------------------------------------------------------

describe('Queue Store - Permutation Preservation', () => {
  test.prop([nonEmptyTracksArb])(
    'shuffle preserves all track IDs (no duplicates, no losses)',
    (tracks) => {
      const store = createTestQueueStore(tracks);
      store.playIndex(0);

      const originalIds = new Set(tracks.map((t) => t.id));

      store.toggleShuffle(); // Enable shuffle

      const shuffledIds = new Set(store.items.map((t) => t.id));

      // Same set of IDs
      expect(shuffledIds.size).toBe(originalIds.size);
      for (const id of originalIds) {
        expect(shuffledIds.has(id)).toBe(true);
      }
    }
  );

  test.prop([nonEmptyTracksArb])(
    'unshuffle restores original track set',
    (tracks) => {
      const store = createTestQueueStore(tracks);
      store.playIndex(0);

      const originalIds = tracks.map((t) => t.id);

      store.toggleShuffle(); // Enable
      store.toggleShuffle(); // Disable

      const restoredIds = store.items.map((t) => t.id);

      // Same IDs in same order
      expect(restoredIds).toEqual(originalIds);
    }
  );

  test.prop([nonEmptyTracksArb])(
    'current track stays at index 0 after shuffle',
    (tracks) => {
      const store = createTestQueueStore(tracks);
      const startIndex = Math.floor(tracks.length / 2);
      store.playIndex(startIndex);

      const currentTrackId = store.currentTrack?.id;

      store.toggleShuffle();

      // Current track should now be at index 0
      expect(store.currentIndex).toBe(0);
      expect(store.currentTrack?.id).toBe(currentTrackId);
    }
  );

  test.prop([nonEmptyTracksArb])(
    'current track is preserved after unshuffle',
    (tracks) => {
      const store = createTestQueueStore(tracks);
      store.playIndex(0);

      const currentTrackId = store.currentTrack?.id;

      store.toggleShuffle(); // Enable
      store.toggleShuffle(); // Disable

      // Current track should still be the same
      expect(store.currentTrack?.id).toBe(currentTrackId);
    }
  );
});

// -----------------------------------------------------------------------------
// Deterministic Tests: playNextTracks (Queue Next / Cmd+D)
// -----------------------------------------------------------------------------

describe('Queue Store - playNextTracks (Queue Next)', () => {
  /** Helper: create tracks with sequential IDs */
  function makeTracks(names) {
    return names.map((name, i) => ({
      id: `track-${i}`,
      title: name,
      artist: 'Test',
      album: 'Test',
      duration: 180000,
      filepath: `/music/${name}.mp3`,
    }));
  }

  test('inserts track after current track', () => {
    const tracks = makeTracks(['A', 'B', 'C', 'D']);
    const store = createTestQueueStore(tracks);
    store.playIndex(0); // Playing A

    const newTrack = { id: 'new-1', title: 'X', artist: 'T', album: 'T', duration: 1000, filepath: '/x.mp3' };
    store.playNextTracks([newTrack]);

    expect(store.items[1].id).toBe('new-1');
    expect(store.items.map((t) => t.title)).toEqual(['A', 'X', 'B', 'C', 'D']);
  });

  test('preserves currentIndex after insert', () => {
    const tracks = makeTracks(['A', 'B', 'C']);
    const store = createTestQueueStore(tracks);
    store.playIndex(0);

    const newTrack = { id: 'new-1', title: 'X', artist: 'T', album: 'T', duration: 1000, filepath: '/x.mp3' };
    store.playNextTracks([newTrack]);

    expect(store.currentIndex).toBe(0);
    expect(store.currentTrack.title).toBe('A');
  });

  test('successive calls append in order (not prepend)', () => {
    const tracks = makeTracks(['A', 'B', 'C']);
    const store = createTestQueueStore(tracks);
    store.playIndex(0);

    const x = { id: 'x', title: 'X', artist: 'T', album: 'T', duration: 1000, filepath: '/x.mp3' };
    const y = { id: 'y', title: 'Y', artist: 'T', album: 'T', duration: 1000, filepath: '/y.mp3' };
    const z = { id: 'z', title: 'Z', artist: 'T', album: 'T', duration: 1000, filepath: '/z.mp3' };

    store.playNextTracks([x]);
    store.playNextTracks([y]);
    store.playNextTracks([z]);

    // Expected order: A (playing), X, Y, Z, B, C
    expect(store.items.map((t) => t.title)).toEqual(['A', 'X', 'Y', 'Z', 'B', 'C']);
    expect(store.currentIndex).toBe(0);
  });

  test('playNextOffset resets when track changes via playIndex', () => {
    const tracks = makeTracks(['A', 'B', 'C']);
    const store = createTestQueueStore(tracks);
    store.playIndex(0);

    const x = { id: 'x', title: 'X', artist: 'T', album: 'T', duration: 1000, filepath: '/x.mp3' };
    store.playNextTracks([x]);
    // Queue: [A*, X, B, C], offset=1

    // Advance to next track (simulate Next button)
    store.playIndex(1); // Now playing X, offset resets to 0

    const y = { id: 'y', title: 'Y', artist: 'T', album: 'T', duration: 1000, filepath: '/y.mp3' };
    store.playNextTracks([y]);

    // Y should be right after X (index 2), not after the old offset
    expect(store.items.map((t) => t.title)).toEqual(['A', 'X', 'Y', 'B', 'C']);
    expect(store.currentIndex).toBe(1);
  });

  test('insert at beginning when nothing is playing', () => {
    const tracks = makeTracks(['A', 'B']);
    const store = createTestQueueStore(tracks);
    // currentIndex = -1 (nothing playing)

    const x = { id: 'x', title: 'X', artist: 'T', album: 'T', duration: 1000, filepath: '/x.mp3' };
    store.playNextTracks([x]);

    expect(store.items[0].title).toBe('X');
    expect(store.items.map((t) => t.title)).toEqual(['X', 'A', 'B']);
  });

  test('multiple tracks queued at once are inserted in order', () => {
    const tracks = makeTracks(['A', 'B', 'C']);
    const store = createTestQueueStore(tracks);
    store.playIndex(0);

    const batch = [
      { id: 'x', title: 'X', artist: 'T', album: 'T', duration: 1000, filepath: '/x.mp3' },
      { id: 'y', title: 'Y', artist: 'T', album: 'T', duration: 1000, filepath: '/y.mp3' },
    ];
    store.playNextTracks(batch);

    expect(store.items.map((t) => t.title)).toEqual(['A', 'X', 'Y', 'B', 'C']);
  });

  test('currentIndex adjusts when inserting before current track', () => {
    const tracks = makeTracks(['A', 'B', 'C']);
    const store = createTestQueueStore(tracks);
    store.playIndex(2); // Playing C at index 2

    const x = { id: 'x', title: 'X', artist: 'T', album: 'T', duration: 1000, filepath: '/x.mp3' };
    store.insert(0, [x]); // Insert at beginning

    // currentIndex should shift from 2 to 3
    expect(store.currentIndex).toBe(3);
    expect(store.currentTrack.title).toBe('C');
  });
});

// -----------------------------------------------------------------------------
// Property Tests: Operation Sequences
// -----------------------------------------------------------------------------

describe('Queue Store - Operation Sequence Invariants', () => {
  /** Command generators for stateful testing */
  const queueCommandArb = (maxTracks) =>
    fc.oneof(
      // Add a track
      fc.record({ type: fc.constant('add'), track: trackArb }),
      // Remove at index
      fc.record({ type: fc.constant('remove'), index: fc.integer({ min: 0, max: maxTracks }) }),
      // Reorder
      fc.record({
        type: fc.constant('reorder'),
        from: fc.integer({ min: 0, max: maxTracks }),
        to: fc.integer({ min: 0, max: maxTracks }),
      }),
      // Play index
      fc.record({ type: fc.constant('playIndex'), index: fc.integer({ min: 0, max: maxTracks }) }),
      // Toggle shuffle
      fc.record({ type: fc.constant('toggleShuffle') }),
      // Cycle loop
      fc.record({ type: fc.constant('cycleLoop') }),
      // Clear
      fc.record({ type: fc.constant('clear') })
    );

  /** Apply a command to the store */
  function applyCommand(store, cmd) {
    switch (cmd.type) {
      case 'add':
        store.add(cmd.track);
        break;
      case 'remove':
        store.remove(cmd.index % Math.max(1, store.items.length));
        break;
      case 'reorder':
        if (store.items.length >= 2) {
          const from = cmd.from % store.items.length;
          const to = cmd.to % store.items.length;
          store.reorder(from, to);
        }
        break;
      case 'playIndex':
        if (store.items.length > 0) {
          store.playIndex(cmd.index % store.items.length);
        }
        break;
      case 'toggleShuffle':
        store.toggleShuffle();
        break;
      case 'cycleLoop':
        store.cycleLoop();
        break;
      case 'clear':
        store.clear();
        break;
    }
  }

  /** Check invariants hold */
  function checkInvariants(store) {
    // Index bounds
    if (store.items.length === 0) {
      expect(store.currentIndex).toBe(-1);
    } else {
      expect(
        store.currentIndex === -1 ||
          (store.currentIndex >= 0 && store.currentIndex < store.items.length)
      ).toBe(true);
    }

    // No duplicate IDs
    const ids = store.items.map((t) => t.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);

    // Loop mode is valid
    expect(['none', 'all', 'one']).toContain(store.loop);

    // Shuffle is boolean
    expect(typeof store.shuffle).toBe('boolean');
  }

  test.prop([nonEmptyTracksArb, fc.array(queueCommandArb(20), { minLength: 1, maxLength: 30 })])(
    'invariants hold after arbitrary operation sequences',
    (initialTracks, commands) => {
      const store = createTestQueueStore(initialTracks);
      store.playIndex(0);

      // Check initial state
      checkInvariants(store);

      // Apply each command and check invariants
      for (const cmd of commands) {
        applyCommand(store, cmd);
        checkInvariants(store);
      }
    }
  );

  test.prop([nonEmptyTracksArb, fc.array(queueCommandArb(20), { minLength: 5, maxLength: 20 })])(
    'currentTrack getter is consistent with currentIndex',
    (initialTracks, commands) => {
      const store = createTestQueueStore(initialTracks);
      store.playIndex(0);

      for (const cmd of commands) {
        applyCommand(store, cmd);

        // currentTrack should match items[currentIndex]
        if (store.currentIndex === -1) {
          expect(store.currentTrack).toBeNull();
        } else {
          expect(store.currentTrack).toBe(store.items[store.currentIndex]);
        }
      }
    }
  );
});
