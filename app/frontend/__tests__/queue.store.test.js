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

import { fc, test } from '@fast-check/vitest';
import { beforeEach, describe, expect, vi } from 'vitest';

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
    _buildQueuePromise: null,
    _playHistory: [],
    _maxHistorySize: 100,
    _playNextTrackIds: new Set(),

    _pushToHistory(index) {
      const track = this.items[index];
      if (!track) return;
      this._playHistory.push(track);
      if (this._playHistory.length > this._maxHistorySize) {
        this._playHistory.shift();
      }
    },

    _popFromHistory() {
      while (this._playHistory.length > 0) {
        const track = this._playHistory.pop();
        const idx = this.items.findIndex((t) => t.id === track.id);
        if (idx >= 0) return idx;
      }
      return -1;
    },

    playNext() {
      if (this.items.length === 0) return;

      if (this._repeatOnePending) {
        this._repeatOnePending = false;
      } else if (this.loop === 'one') {
        this._repeatOnePending = true;
        this.loop = 'none';
        this.playIndex(this.currentIndex, true);
        return;
      }

      if (this.currentIndex >= 0) {
        this._pushToHistory(this.currentIndex);
      }

      let nextIndex = this.currentIndex + 1;
      if (nextIndex >= this.items.length) {
        if (this.loop === 'all') {
          nextIndex = 0;
        } else {
          return; // End of queue, no loop
        }
      }

      this.playIndex(nextIndex, true);
    },

    skipNext() {
      if (this.items.length === 0) return;
      if (this.loop === 'one') {
        this.loop = 'all';
        this._repeatOnePending = false;
      }
      if (this.currentIndex >= 0) {
        this._pushToHistory(this.currentIndex);
      }
      let nextIndex = this.currentIndex + 1;
      if (nextIndex >= this.items.length) nextIndex = 0;
      this.playIndex(nextIndex, true);
    },

    playPrevious() {
      if (this.items.length === 0) return;
      if (this._playHistory.length > 0) {
        const historyIndex = this._popFromHistory();
        if (historyIndex >= 0) {
          this.playIndex(historyIndex, true);
          return;
        }
      }
      let prevIndex = this.currentIndex - 1;
      if (prevIndex < 0) {
        prevIndex = this.loop === 'all' ? this.items.length - 1 : 0;
      }
      this.playIndex(prevIndex, true);
    },

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

    async playNextTracks(tracks) {
      const tracksArray = Array.isArray(tracks) ? tracks : [tracks];
      if (tracksArray.length === 0) return;

      // Wait for any background queue build to complete before inserting
      if (this._buildQueuePromise) {
        await this._buildQueuePromise;
      }

      // Move semantics: remove existing copies, skip current track
      const currentTrackId = this.currentIndex >= 0 ? this.items[this.currentIndex]?.id : null;
      const tracksToInsert = [];
      for (const t of tracksArray) {
        if (t.id === currentTrackId) continue;
        const existingIdx = this.items.findIndex((item) => item.id === t.id);
        if (existingIdx >= 0) {
          this.items.splice(existingIdx, 1);
          const origIdx = this._originalOrder.findIndex((item) => item.id === t.id);
          if (origIdx >= 0) this._originalOrder.splice(origIdx, 1);
          if (existingIdx < this.currentIndex) {
            this.currentIndex--;
          }
        }
        tracksToInsert.push(t);
      }
      if (tracksToInsert.length === 0) return;

      if (!this._playNextOffset) this._playNextOffset = 0;
      const insertIndex = (this.currentIndex >= 0 ? this.currentIndex + 1 : 0) +
        this._playNextOffset;
      this._playNextOffset += tracksToInsert.length;

      // Track these as pinned play-next tracks (preserved during shuffle)
      for (const t of tracksToInsert) {
        this._playNextTrackIds.add(t.id);
      }

      this.insert(insertIndex, tracksToInsert);
    },

    remove(index) {
      if (index < 0 || index >= this.items.length) return;
      const removedTrack = this.items[index];
      this.items.splice(index, 1);

      // Also remove from _originalOrder so unshuffle stays consistent
      if (removedTrack) {
        const origIdx = this._originalOrder.findIndex((t) => t.id === removedTrack.id);
        if (origIdx >= 0) {
          this._originalOrder.splice(origIdx, 1);
        }
        this._playNextTrackIds.delete(removedTrack.id);
      }

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
      this._playNextTrackIds = new Set();
      // History intentionally NOT cleared - persists across queue rebuilds
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

    playIndex(index, fromNavigation = false) {
      if (index < 0 || index >= this.items.length) return;
      if (!fromNavigation && this.currentIndex >= 0 && this.currentIndex !== index) {
        this._pushToHistory(this.currentIndex);
      }
      this._playNextOffset = 0;
      this.currentIndex = index;
      // If this was a play-next track, it's been consumed
      const track = this.items[index];
      if (track) this._playNextTrackIds.delete(track.id);
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

      // Separate play-next tracks (pinned) from regular tracks
      const pinnedTracks = [];
      const regularTracks = [];

      for (let i = 0; i < this.items.length; i++) {
        if (i === this.currentIndex) continue;
        if (this._playNextTrackIds.has(this.items[i].id)) {
          pinnedTracks.push(this.items[i]);
        } else {
          regularTracks.push(this.items[i]);
        }
      }

      // Fisher-Yates shuffle only the regular tracks
      for (let i = regularTracks.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [regularTracks[i], regularTracks[j]] = [regularTracks[j], regularTracks[i]];
      }

      if (currentTrack) {
        this.items = [currentTrack, ...pinnedTracks, ...regularTracks];
        this.currentIndex = 0;
      } else {
        this.items = [...pinnedTracks, ...regularTracks];
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
          (store.currentIndex >= 0 && store.currentIndex < store.items.length),
      ).toBe(true);
    },
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
    },
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
    },
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
    },
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
    },
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
    },
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
    },
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

    const newTrack = {
      id: 'new-1',
      title: 'X',
      artist: 'T',
      album: 'T',
      duration: 1000,
      filepath: '/x.mp3',
    };
    store.playNextTracks([newTrack]);

    expect(store.items[1].id).toBe('new-1');
    expect(store.items.map((t) => t.title)).toEqual(['A', 'X', 'B', 'C', 'D']);
  });

  test('preserves currentIndex after insert', () => {
    const tracks = makeTracks(['A', 'B', 'C']);
    const store = createTestQueueStore(tracks);
    store.playIndex(0);

    const newTrack = {
      id: 'new-1',
      title: 'X',
      artist: 'T',
      album: 'T',
      duration: 1000,
      filepath: '/x.mp3',
    };
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

  test('playNextTracks moves existing track to play-next position', () => {
    const tracks = makeTracks(['A', 'B', 'C', 'D', 'E']);
    const store = createTestQueueStore(tracks);
    store.playIndex(0);

    // Play Next track C which is already at index 2
    const dupeC = { ...tracks[2] }; // same id as C
    store.playNextTracks([dupeC]);

    // C should be moved from index 2 to index 1 (play-next position)
    expect(store.items.map((t) => t.title)).toEqual(['A', 'C', 'B', 'D', 'E']);
    expect(store.items.length).toBe(5); // no duplicates
  });

  test('playNextTracks moves duplicate and inserts new tracks together', () => {
    const tracks = makeTracks(['A', 'B', 'C', 'D']);
    const store = createTestQueueStore(tracks);
    store.playIndex(0);

    const dupeC = { ...tracks[2] };
    const x = { id: 'x', title: 'X', artist: 'T', album: 'T', duration: 1000, filepath: '/x.mp3' };
    store.playNextTracks([dupeC, x]);

    // C moved to play-next, X inserted after C
    expect(store.items.map((t) => t.title)).toEqual(['A', 'C', 'X', 'B', 'D']);
    expect(store.items.length).toBe(5);
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
      fc.record({ type: fc.constant('clear') }),
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
          (store.currentIndex >= 0 && store.currentIndex < store.items.length),
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
    },
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
    },
  );
});

// -----------------------------------------------------------------------------
// Deterministic Tests: Play History Preservation
// -----------------------------------------------------------------------------

describe('Queue Store - Play History Preservation', () => {
  function makeTracks(names) {
    return names.map((name, i) => ({
      id: `history-track-${i}-${name}`,
      title: name,
      artist: 'Test',
      album: 'Test',
      duration: 180000,
      filepath: `/music/${name}.mp3`,
    }));
  }

  test('playIndex non-navigation pushes current track to history', () => {
    const tracks = makeTracks(['A', 'B', 'C']);
    const store = createTestQueueStore(tracks);
    store.playIndex(0); // currentIndex was -1, no push
    store.playIndex(2); // currentIndex was 0, pushes A

    expect(store._playHistory.length).toBe(1);
    expect(store._playHistory[0].title).toBe('A');
  });

  test('playIndex non-navigation does not clear existing history', () => {
    const tracks = makeTracks(['A', 'B', 'C', 'D']);
    const store = createTestQueueStore(tracks);
    store.playIndex(0);
    store.skipNext(); // A in history, playing B
    store.playIndex(3); // B in history, playing D

    expect(store._playHistory.length).toBe(2);
    expect(store._playHistory[0].title).toBe('A');
    expect(store._playHistory[1].title).toBe('B');
  });

  test('playPrevious goes back via history after manual jump', () => {
    const tracks = makeTracks(['A', 'B', 'C']);
    const store = createTestQueueStore(tracks);
    store.playIndex(0);
    store.playIndex(2); // A in history

    store.playPrevious();

    expect(store.currentTrack.title).toBe('A');
    expect(store._playHistory.length).toBe(0);
  });

  test('skipNext builds history in order', () => {
    const tracks = makeTracks(['A', 'B', 'C', 'D']);
    const store = createTestQueueStore(tracks);
    store.playIndex(0);
    store.skipNext(); // A in history
    store.skipNext(); // B in history

    expect(store._playHistory[0].title).toBe('A');
    expect(store._playHistory[1].title).toBe('B');
    expect(store.currentTrack.title).toBe('C');
  });

  test('playPrevious navigates back through history in reverse order', () => {
    const tracks = makeTracks(['A', 'B', 'C', 'D']);
    const store = createTestQueueStore(tracks);
    store.playIndex(0);
    store.skipNext();
    store.skipNext();

    store.playPrevious();
    expect(store.currentTrack.title).toBe('B');

    store.playPrevious();
    expect(store.currentTrack.title).toBe('A');
  });

  test('clear does not wipe play history', () => {
    const tracks = makeTracks(['A', 'B', 'C']);
    const store = createTestQueueStore(tracks);
    store.playIndex(0);
    store.skipNext(); // A in history

    store.clear();

    expect(store._playHistory.length).toBe(1);
    expect(store._playHistory[0].title).toBe('A');
  });

  test('history survives queue rebuild - prev finds track by ID at new index', () => {
    const tracks = makeTracks(['A', 'B', 'C', 'D', 'E']);
    const store = createTestQueueStore(tracks);
    store.playIndex(0);
    store.skipNext(); // A in history, playing B
    store.skipNext(); // B in history, playing C

    // Simulate queue rebuild (double-click D): new queue [D, E, A, B, C]
    const newQueue = [
      {
        id: 'history-track-3-D',
        title: 'D',
        artist: 'Test',
        album: 'Test',
        duration: 180000,
        filepath: '/music/D.mp3',
      },
      {
        id: 'history-track-4-E',
        title: 'E',
        artist: 'Test',
        album: 'Test',
        duration: 180000,
        filepath: '/music/E.mp3',
      },
      {
        id: 'history-track-0-A',
        title: 'A',
        artist: 'Test',
        album: 'Test',
        duration: 180000,
        filepath: '/music/A.mp3',
      },
      {
        id: 'history-track-1-B',
        title: 'B',
        artist: 'Test',
        album: 'Test',
        duration: 180000,
        filepath: '/music/B.mp3',
      },
      {
        id: 'history-track-2-C',
        title: 'C',
        artist: 'Test',
        album: 'Test',
        duration: 180000,
        filepath: '/music/C.mp3',
      },
    ];
    store.items = newQueue;
    store.currentIndex = 0; // D is playing

    // History has [A, B] - both exist in new queue at different indices
    store.playPrevious();
    expect(store.currentTrack.title).toBe('B'); // Most recent history entry

    store.playPrevious();
    expect(store.currentTrack.title).toBe('A');
  });

  test('prev skips history entries not in current queue', () => {
    const tracks = makeTracks(['A', 'B', 'C']);
    const store = createTestQueueStore(tracks);
    store.playIndex(0);
    store.skipNext(); // A in history
    store.skipNext(); // B in history

    // Replace with entirely different tracks
    store.items = [
      { id: 'x', title: 'X', artist: 'T', album: 'T', duration: 1000, filepath: '/x.mp3' },
      { id: 'y', title: 'Y', artist: 'T', album: 'T', duration: 1000, filepath: '/y.mp3' },
    ];
    store.currentIndex = 0;

    // A and B are not in new queue - history exhausted, falls back to positional prev
    store.playPrevious();
    expect(store._playHistory.length).toBe(0);
    expect(store.currentIndex).toBeGreaterThanOrEqual(0);
  });
});

// -----------------------------------------------------------------------------
// Deterministic Tests: Loop-One (Repeat Once) Behavior
// -----------------------------------------------------------------------------

describe('Queue Store - Loop-One (Repeat Once)', () => {
  function makeTracks(names) {
    return names.map((name, i) => ({
      id: `loop-track-${i}-${name}`,
      title: name,
      artist: 'Test',
      album: 'Test',
      duration: 180000,
      filepath: `/music/${name}.mp3`,
    }));
  }

  test('playNext with loop=one replays current track and untogles icon on first call', () => {
    const tracks = makeTracks(['A', 'B', 'C']);
    const store = createTestQueueStore(tracks);
    store.playIndex(0);
    store.loop = 'one';

    store.playNext();

    expect(store.currentIndex).toBe(0);
    expect(store.currentTrack.title).toBe('A');
    expect(store._repeatOnePending).toBe(true);
    // Icon untoggled immediately when repeat starts
    expect(store.loop).toBe('none');
  });

  test('playNext with loop=one advances to next track on second call', () => {
    const tracks = makeTracks(['A', 'B', 'C']);
    const store = createTestQueueStore(tracks);
    store.playIndex(0);
    store.loop = 'one';

    store.playNext(); // First: replays A, untoggles icon
    store.playNext(); // Second: advances to B

    expect(store.currentIndex).toBe(1);
    expect(store.currentTrack.title).toBe('B');
    expect(store._repeatOnePending).toBe(false);
    expect(store.loop).toBe('none');
  });

  test('loop=one clears to none when repeat starts, not when it completes', () => {
    const tracks = makeTracks(['A', 'B', 'C']);
    const store = createTestQueueStore(tracks);
    store.playIndex(1); // Playing B
    store.loop = 'one';

    store.playNext(); // First: replays B
    expect(store.loop).toBe('none');

    store.playNext(); // Second: clears loop, advances to C
    expect(store.loop).toBe('none');
    expect(store.currentIndex).toBe(2);
  });

  test('cycleLoop resets _repeatOnePending', () => {
    const tracks = makeTracks(['A', 'B']);
    const store = createTestQueueStore(tracks);
    store.playIndex(0);
    store.loop = 'one';

    store.playNext(); // Sets _repeatOnePending = true
    expect(store._repeatOnePending).toBe(true);

    store.cycleLoop(); // Cycle loop resets pending flag
    expect(store._repeatOnePending).toBe(false);
  });

  test('other loop modes unaffected - loop=all wraps around', () => {
    const tracks = makeTracks(['A', 'B', 'C']);
    const store = createTestQueueStore(tracks);
    store.playIndex(2); // Last track
    store.loop = 'all';

    store.playNext();

    expect(store.currentIndex).toBe(0);
    expect(store.loop).toBe('all');
  });

  test('other loop modes unaffected - loop=none stops at end', () => {
    const tracks = makeTracks(['A', 'B', 'C']);
    const store = createTestQueueStore(tracks);
    store.playIndex(2); // Last track
    store.loop = 'none';

    store.playNext();

    // Should not advance (returns without changing index)
    expect(store.currentIndex).toBe(2);
    expect(store.loop).toBe('none');
  });
});

// -----------------------------------------------------------------------------
// Deterministic Tests: playNextTracks during background queue build
// -----------------------------------------------------------------------------

describe('Queue Store - playNextTracks during background queue build', () => {
  function makeTracks(names) {
    return names.map((name, i) => ({
      id: `build-track-${i}-${name}`,
      title: name,
      artist: 'Test',
      album: 'Test',
      duration: 180000,
      filepath: `/music/${name}.mp3`,
    }));
  }

  test('playNextTracks awaits _buildQueuePromise before inserting', async () => {
    const tracks = makeTracks(['A', 'B', 'C', 'D', 'E']);
    const store = createTestQueueStore(tracks);
    store.playIndex(0); // Playing A

    // Simulate a pending background queue build
    let resolvePromise;
    store._buildQueuePromise = new Promise((resolve) => {
      resolvePromise = resolve;
    });

    const newTrack = {
      id: 'play-next-1',
      title: 'X',
      artist: 'T',
      album: 'T',
      duration: 1000,
      filepath: '/x.mp3',
    };

    // Start playNextTracks - it should await the promise
    const playNextPromise = store.playNextTracks([newTrack]);

    // Before resolving, X should NOT be in the queue yet
    expect(store.items.find((t) => t.id === 'play-next-1')).toBeUndefined();

    // Resolve the build promise
    resolvePromise();
    await playNextPromise;

    // Now X should be inserted at index 1
    expect(store.items[1].id).toBe('play-next-1');
    expect(store.items.map((t) => t.title)).toEqual(['A', 'X', 'B', 'C', 'D', 'E']);
  });

  test('playNextTracks works normally when no build in progress', async () => {
    const tracks = makeTracks(['A', 'B', 'C']);
    const store = createTestQueueStore(tracks);
    store.playIndex(0);

    // _buildQueuePromise is null (no build in progress)
    expect(store._buildQueuePromise).toBeNull();

    const newTrack = {
      id: 'play-next-1',
      title: 'X',
      artist: 'T',
      album: 'T',
      duration: 1000,
      filepath: '/x.mp3',
    };

    await store.playNextTracks([newTrack]);

    expect(store.items[1].id).toBe('play-next-1');
    expect(store.items.map((t) => t.title)).toEqual(['A', 'X', 'B', 'C']);
    expect(store.currentIndex).toBe(0);
  });

  test('successive playNextTracks calls after build completion', async () => {
    const tracks = makeTracks(['A', 'B', 'C']);
    const store = createTestQueueStore(tracks);
    store.playIndex(0);

    // Simulate a build promise that resolves immediately
    store._buildQueuePromise = Promise.resolve();

    const x = { id: 'x', title: 'X', artist: 'T', album: 'T', duration: 1000, filepath: '/x.mp3' };
    const y = { id: 'y', title: 'Y', artist: 'T', album: 'T', duration: 1000, filepath: '/y.mp3' };

    await store.playNextTracks([x]);
    await store.playNextTracks([y]);

    // Expected order: [A (playing), X, Y, B, C]
    expect(store.items.map((t) => t.title)).toEqual(['A', 'X', 'Y', 'B', 'C']);
    expect(store.currentIndex).toBe(0);
  });
});

// -----------------------------------------------------------------------------
// Regression Tests: Remove from shuffled queue preserves order
// -----------------------------------------------------------------------------

describe('Queue Store - Remove from shuffled queue', () => {
  function makeTracks(names) {
    return names.map((name, i) => ({
      id: `remove-track-${i}-${name}`,
      title: name,
      artist: 'Test',
      album: 'Test',
      duration: 180000,
      filepath: `/music/${name}.mp3`,
    }));
  }

  test('removing a non-current track from shuffled queue preserves play order', () => {
    const tracks = makeTracks(['A', 'B', 'C', 'D', 'E']);
    const store = createTestQueueStore(tracks);
    store.playIndex(0); // Playing A

    // Enable shuffle - A goes to index 0, rest shuffled
    store.toggleShuffle();
    expect(store.currentIndex).toBe(0);
    expect(store.currentTrack.title).toBe('A');

    // Record the shuffled order
    const shuffledOrder = store.items.map((t) => t.title);
    const nextTrack = shuffledOrder[1]; // The track that should play after A

    // Remove a track that is NOT the current or next track
    const removeIdx = 3; // Some later track
    const removedTitle = shuffledOrder[removeIdx];
    store.remove(removeIdx);

    // Current track should be unchanged
    expect(store.currentIndex).toBe(0);
    expect(store.currentTrack.title).toBe('A');

    // Next track should be unchanged
    expect(store.items[1].title).toBe(nextTrack);

    // Queue length should decrease by 1
    expect(store.items.length).toBe(4);

    // Removed track should not be in the queue
    expect(store.items.find((t) => t.title === removedTitle)).toBeUndefined();
  });

  test('removing track before current in shuffled queue adjusts currentIndex', () => {
    const tracks = makeTracks(['A', 'B', 'C', 'D', 'E']);
    const store = createTestQueueStore(tracks);
    store.playIndex(0);
    store.toggleShuffle();

    // Advance to index 2
    store.playIndex(2);
    const currentTrackId = store.currentTrack.id;

    // Remove track at index 0 (before current)
    store.remove(0);

    // currentIndex should decrement
    expect(store.currentIndex).toBe(1);
    // Same track should still be playing
    expect(store.currentTrack.id).toBe(currentTrackId);
  });

  test('playNext after remove from shuffled queue plays the correct next track', () => {
    const tracks = makeTracks(['A', 'B', 'C', 'D', 'E']);
    const store = createTestQueueStore(tracks);
    store.playIndex(0);
    store.toggleShuffle();

    // Record shuffled order
    const expectedNext = store.items[1].id;

    // Remove track at index 3 (not current, not next)
    store.remove(3);

    // playNext should advance to what was index 1
    store.playNext();
    expect(store.currentTrack.id).toBe(expectedNext);
  });

  test('removed track does not reappear when shuffle is disabled', () => {
    const tracks = makeTracks(['A', 'B', 'C', 'D', 'E']);
    const store = createTestQueueStore(tracks);
    store.playIndex(0);

    // Enable shuffle
    store.toggleShuffle();

    // Remove track C
    const cIndex = store.items.findIndex((t) => t.title === 'C');
    store.remove(cIndex);

    // Disable shuffle - should restore original order minus C
    store.toggleShuffle();

    const titles = store.items.map((t) => t.title);
    expect(titles).not.toContain('C');
    expect(titles.length).toBe(4);
  });

  test('_originalOrder is updated when removing during shuffle', () => {
    const tracks = makeTracks(['A', 'B', 'C', 'D']);
    const store = createTestQueueStore(tracks);
    store.playIndex(0);
    store.toggleShuffle();

    // Remove a track
    const removedTrack = store.items[2];
    store.remove(2);

    // _originalOrder should not contain the removed track
    expect(store._originalOrder.find((t) => t.id === removedTrack.id)).toBeUndefined();
    expect(store._originalOrder.length).toBe(3);
  });
});

// -----------------------------------------------------------------------------
// Regression Tests: Shuffle does not repeat current track
// -----------------------------------------------------------------------------

describe('Queue Store - Shuffle does not repeat current track', () => {
  function makeTracks(names) {
    return names.map((name, i) => ({
      id: `shuffle-track-${i}-${name}`,
      title: name,
      artist: 'Test',
      album: 'Test',
      duration: 180000,
      filepath: `/music/${name}.mp3`,
    }));
  }

  test('after shuffle toggle, playNext advances to a different track', () => {
    const tracks = makeTracks(['A', 'B', 'C', 'D', 'E']);
    const store = createTestQueueStore(tracks);
    store.playIndex(0); // Playing A

    store.toggleShuffle();

    // A should be at index 0
    expect(store.currentIndex).toBe(0);
    expect(store.currentTrack.title).toBe('A');

    // playNext should go to index 1, which should NOT be A
    store.playNext();
    expect(store.currentIndex).toBe(1);
    expect(store.currentTrack.title).not.toBe('A');
  });

  test('no duplicate tracks after shuffle', () => {
    const tracks = makeTracks(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']);
    const store = createTestQueueStore(tracks);
    store.playIndex(0);

    store.toggleShuffle();

    const ids = store.items.map((t) => t.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  test('shuffle from middle of queue puts current track at index 0', () => {
    const tracks = makeTracks(['A', 'B', 'C', 'D', 'E']);
    const store = createTestQueueStore(tracks);
    store.playIndex(3); // Playing D

    store.toggleShuffle();

    expect(store.currentIndex).toBe(0);
    expect(store.currentTrack.title).toBe('D');
    expect(store.items[0].title).toBe('D');
    // D should only appear once
    expect(store.items.filter((t) => t.title === 'D').length).toBe(1);
  });

  test('full playthrough after shuffle plays each track exactly once', () => {
    const tracks = makeTracks(['A', 'B', 'C', 'D', 'E', 'F', 'G']);
    const store = createTestQueueStore(tracks);
    store.playIndex(0);
    store.toggleShuffle();

    const played = new Set();
    played.add(store.currentTrack.id);

    for (let i = 1; i < tracks.length; i++) {
      store.playNext();
      expect(played.has(store.currentTrack.id)).toBe(false);
      played.add(store.currentTrack.id);
    }

    expect(played.size).toBe(tracks.length);
  });
});

// -----------------------------------------------------------------------------
// Regression Tests: Play Next tracks survive shuffle toggle
// -----------------------------------------------------------------------------

describe('Queue Store - Play Next tracks survive shuffle', () => {
  function makeTracks(names) {
    return names.map((name, i) => ({
      id: `pn-track-${i}-${name}`,
      title: name,
      artist: 'Test',
      album: 'Test',
      duration: 180000,
      filepath: `/music/${name}.mp3`,
    }));
  }

  function makeTrack(name, idPrefix = 'pn-extra') {
    return {
      id: `${idPrefix}-${name}`,
      title: name,
      artist: 'Other',
      album: 'Other',
      duration: 180000,
      filepath: `/music/${name}.mp3`,
    };
  }

  test('play-next track stays immediately after current when shuffle is toggled', () => {
    const tracks = makeTracks(['Here', 'All Time Lows', 'Stuck', 'Homewrecker', 'Oh It Is Love']);
    const store = createTestQueueStore(tracks);
    store.playIndex(0); // Playing "Here"

    // User adds "Funeral" via Play Next
    const funeral = makeTrack('Funeral');
    store.playNextTracks([funeral]);

    // Verify: [Here*, Funeral, All Time Lows, ...]
    expect(store.items[0].title).toBe('Here');
    expect(store.items[1].title).toBe('Funeral');

    // Toggle shuffle
    store.toggleShuffle();

    // "Here" should be at index 0, "Funeral" should be at index 1
    expect(store.currentIndex).toBe(0);
    expect(store.items[0].title).toBe('Here');
    expect(store.items[1].title).toBe('Funeral');

    // Queue length unchanged
    expect(store.items.length).toBe(6);
  });

  test('multiple play-next tracks preserve their order during shuffle', () => {
    const tracks = makeTracks(['A', 'B', 'C', 'D', 'E']);
    const store = createTestQueueStore(tracks);
    store.playIndex(0);

    const x = makeTrack('X');
    const y = makeTrack('Y');
    store.playNextTracks([x]);
    store.playNextTracks([y]);

    // Before shuffle: [A*, X, Y, B, C, D, E]
    expect(store.items.map((t) => t.title)).toEqual(['A', 'X', 'Y', 'B', 'C', 'D', 'E']);

    store.toggleShuffle();

    // After shuffle: A at 0, X at 1, Y at 2, rest shuffled
    expect(store.items[0].title).toBe('A');
    expect(store.items[1].title).toBe('X');
    expect(store.items[2].title).toBe('Y');
    expect(store.items.length).toBe(7);
  });

  test('play-next track is consumed when it starts playing', () => {
    const tracks = makeTracks(['A', 'B', 'C']);
    const store = createTestQueueStore(tracks);
    store.playIndex(0);

    const x = makeTrack('X');
    store.playNextTracks([x]);

    expect(store._playNextTrackIds.has(x.id)).toBe(true);

    // Advance to X
    store.playIndex(1, true);

    // X is consumed - no longer pinned
    expect(store._playNextTrackIds.has(x.id)).toBe(false);
  });

  test('consumed play-next track is shuffled normally on next toggle', () => {
    const tracks = makeTracks(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']);
    const store = createTestQueueStore(tracks);
    store.playIndex(0);

    const x = makeTrack('X');
    store.playNextTracks([x]);

    // Advance past X (consume it)
    store.playNext(); // Now playing X at index 1
    expect(store.currentTrack.title).toBe('X');

    // Toggle shuffle - X should NOT be pinned anymore
    store.toggleShuffle();
    expect(store.items[0].title).toBe('X'); // current track at 0
    // Index 1 should be a random track, not necessarily any specific one
    // But X should not appear twice
    expect(store.items.filter((t) => t.title === 'X').length).toBe(1);
  });

  test('unshuffle restores original order including play-next tracks', () => {
    const tracks = makeTracks(['A', 'B', 'C', 'D', 'E']);
    const store = createTestQueueStore(tracks);
    store.playIndex(0);

    const x = makeTrack('X');
    store.playNextTracks([x]);

    // Before shuffle: [A*, X, B, C, D, E]
    const orderBefore = store.items.map((t) => t.title);

    store.toggleShuffle(); // shuffle
    store.toggleShuffle(); // unshuffle

    // Should restore original order including X
    expect(store.items.map((t) => t.title)).toEqual(orderBefore);
  });

  test('play-next tracks cleared when queue is cleared', () => {
    const tracks = makeTracks(['A', 'B', 'C']);
    const store = createTestQueueStore(tracks);
    store.playIndex(0);

    store.playNextTracks([makeTrack('X')]);
    expect(store._playNextTrackIds.size).toBe(1);

    store.clear();
    expect(store._playNextTrackIds.size).toBe(0);
  });

  test('removing a play-next track removes it from pinned set', () => {
    const tracks = makeTracks(['A', 'B', 'C']);
    const store = createTestQueueStore(tracks);
    store.playIndex(0);

    const x = makeTrack('X');
    store.playNextTracks([x]);

    // Remove X (at index 1)
    store.remove(1);

    expect(store._playNextTrackIds.has(x.id)).toBe(false);

    // Shuffle should work normally without the removed track
    store.toggleShuffle();
    expect(store.items.length).toBe(3);
    expect(store.items[0].title).toBe('A');
  });

  test('no duplicates when play-next tracks exist during shuffle', () => {
    const tracks = makeTracks(['A', 'B', 'C', 'D', 'E', 'F', 'G']);
    const store = createTestQueueStore(tracks);
    store.playIndex(0);

    store.playNextTracks([makeTrack('X'), makeTrack('Y')]);

    store.toggleShuffle();

    const ids = store.items.map((t) => t.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
    expect(store.items.length).toBe(9);
  });
});
