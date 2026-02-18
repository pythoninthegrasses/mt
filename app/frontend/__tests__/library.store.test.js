/**
 * Unit tests for the Library Store
 *
 * Tests pure functions and computed properties that don't require
 * Tauri backend or API mocking.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { test, fc } from '@fast-check/vitest';

// -----------------------------------------------------------------------------
// Test Helpers: Create isolated library store instances for testing
// -----------------------------------------------------------------------------

/**
 * Create a minimal library store for testing (no Alpine/API dependencies)
 * Extracts the pure logic from the store for isolated testing.
 */
function createTestLibraryStore(initialTracks = []) {
  return {
    tracks: [...initialTracks],
    filteredTracks: [...initialTracks],
    searchQuery: '',
    sortBy: 'default',
    sortOrder: 'asc',
    currentSection: 'all',
    loading: false,
    scanning: false,
    scanProgress: 0,
    totalTracks: initialTracks.length,
    totalDuration: initialTracks.reduce((sum, t) => sum + (t.duration || 0), 0),

    /**
     * Format total duration for display
     */
    get formattedTotalDuration() {
      const hours = Math.floor(this.totalDuration / 3600000);
      const minutes = Math.floor((this.totalDuration % 3600000) / 60000);

      if (hours > 0) {
        return `${hours}h ${minutes}m`;
      }
      return `${minutes} min`;
    },

    /**
     * Get unique artists
     */
    get artists() {
      const artistSet = new Set(this.tracks.map((t) => t.artist).filter(Boolean));
      return Array.from(artistSet).sort();
    },

    /**
     * Get unique albums
     */
    get albums() {
      const albumSet = new Set(this.tracks.map((t) => t.album).filter(Boolean));
      return Array.from(albumSet).sort();
    },

    /**
     * Get tracks grouped by artist
     * Uses Object.create(null) to avoid prototype pollution with artist names like "toString"
     */
    get tracksByArtist() {
      const grouped = Object.create(null);
      for (const track of this.filteredTracks) {
        const artist = track.artist || 'Unknown Artist';
        if (!grouped[artist]) {
          grouped[artist] = [];
        }
        grouped[artist].push(track);
      }
      return grouped;
    },

    /**
     * Get tracks grouped by album
     * Uses Object.create(null) to avoid prototype pollution with album names like "valueOf"
     */
    get tracksByAlbum() {
      const grouped = Object.create(null);
      for (const track of this.filteredTracks) {
        const album = track.album || 'Unknown Album';
        if (!grouped[album]) {
          grouped[album] = [];
        }
        grouped[album].push(track);
      }
      return grouped;
    },

    /**
     * Get track by ID
     * @param {string} trackId - Track ID
     * @returns {Object|null} Track object or null
     */
    getTrack(trackId) {
      return this.tracks.find((t) => t.id === trackId) || null;
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
  artist: fc.string({ minLength: 0, maxLength: 50 }),
  album: fc.string({ minLength: 0, maxLength: 50 }),
  duration: fc.integer({ min: 0, max: 600000 }), // 0 to 10min in ms
  filepath: fc.string({ minLength: 1, maxLength: 100 }),
  track_number: fc.option(fc.string({ minLength: 1, maxLength: 10 })),
});

/** Generate an array of tracks */
const tracksArb = fc.array(trackArb, { minLength: 0, maxLength: 30 });


// -----------------------------------------------------------------------------
// Tests: formattedTotalDuration Getter
// -----------------------------------------------------------------------------

describe('Library Store - formattedTotalDuration', () => {
  it('formats 0 duration as "0 min"', () => {
    const store = createTestLibraryStore();
    store.totalDuration = 0;
    expect(store.formattedTotalDuration).toBe('0 min');
  });

  it('formats minutes only when less than 1 hour', () => {
    const store = createTestLibraryStore();
    store.totalDuration = 30 * 60 * 1000; // 30 minutes
    expect(store.formattedTotalDuration).toBe('30 min');
  });

  it('formats hours and minutes when 1 hour or more', () => {
    const store = createTestLibraryStore();
    store.totalDuration = 90 * 60 * 1000; // 1.5 hours
    expect(store.formattedTotalDuration).toBe('1h 30m');
  });

  it('formats exactly 1 hour correctly', () => {
    const store = createTestLibraryStore();
    store.totalDuration = 60 * 60 * 1000; // 1 hour
    expect(store.formattedTotalDuration).toBe('1h 0m');
  });

  it('formats large durations correctly', () => {
    const store = createTestLibraryStore();
    store.totalDuration = 10 * 60 * 60 * 1000; // 10 hours
    expect(store.formattedTotalDuration).toBe('10h 0m');
  });

  test.prop([fc.integer({ min: 0, max: 100 * 60 * 60 * 1000 })])(
    'always returns string with expected format',
    (duration) => {
      const store = createTestLibraryStore();
      store.totalDuration = duration;
      const result = store.formattedTotalDuration;

      // Should match either "Xh Ym" or "X min"
      expect(result).toMatch(/^(\d+h \d+m|\d+ min)$/);
    }
  );

  test.prop([fc.integer({ min: 0, max: 59 * 60 * 1000 })])(
    'durations under 1 hour use "min" format',
    (duration) => {
      const store = createTestLibraryStore();
      store.totalDuration = duration;
      const result = store.formattedTotalDuration;

      expect(result).toMatch(/^\d+ min$/);
    }
  );

  test.prop([fc.integer({ min: 60 * 60 * 1000, max: 100 * 60 * 60 * 1000 })])(
    'durations 1 hour or more use "h m" format',
    (duration) => {
      const store = createTestLibraryStore();
      store.totalDuration = duration;
      const result = store.formattedTotalDuration;

      expect(result).toMatch(/^\d+h \d+m$/);
    }
  );
});

// -----------------------------------------------------------------------------
// Tests: artists and albums Getters
// -----------------------------------------------------------------------------

describe('Library Store - artists getter', () => {
  it('returns empty array for empty library', () => {
    const store = createTestLibraryStore([]);
    expect(store.artists).toEqual([]);
  });

  it('returns unique artists', () => {
    const tracks = [
      { id: '1', artist: 'Artist A', title: 'Song 1' },
      { id: '2', artist: 'Artist B', title: 'Song 2' },
      { id: '3', artist: 'Artist A', title: 'Song 3' },
    ];
    const store = createTestLibraryStore(tracks);
    expect(store.artists).toEqual(['Artist A', 'Artist B']);
  });

  it('filters out null/undefined/empty artists', () => {
    const tracks = [
      { id: '1', artist: 'Artist A', title: 'Song 1' },
      { id: '2', artist: null, title: 'Song 2' },
      { id: '3', artist: '', title: 'Song 3' },
      { id: '4', artist: undefined, title: 'Song 4' },
    ];
    const store = createTestLibraryStore(tracks);
    expect(store.artists).toEqual(['Artist A']);
  });

  it('returns artists in sorted order', () => {
    const tracks = [
      { id: '1', artist: 'Zebra', title: 'Song 1' },
      { id: '2', artist: 'Apple', title: 'Song 2' },
      { id: '3', artist: 'Mango', title: 'Song 3' },
    ];
    const store = createTestLibraryStore(tracks);
    expect(store.artists).toEqual(['Apple', 'Mango', 'Zebra']);
  });

  test.prop([tracksArb])('artist count is <= track count', (tracks) => {
    const store = createTestLibraryStore(tracks);
    expect(store.artists.length).toBeLessThanOrEqual(tracks.length);
  });

  test.prop([tracksArb])('all artists are unique', (tracks) => {
    const store = createTestLibraryStore(tracks);
    const uniqueArtists = new Set(store.artists);
    expect(uniqueArtists.size).toBe(store.artists.length);
  });
});

describe('Library Store - albums getter', () => {
  it('returns empty array for empty library', () => {
    const store = createTestLibraryStore([]);
    expect(store.albums).toEqual([]);
  });

  it('returns unique albums', () => {
    const tracks = [
      { id: '1', album: 'Album A', title: 'Song 1' },
      { id: '2', album: 'Album B', title: 'Song 2' },
      { id: '3', album: 'Album A', title: 'Song 3' },
    ];
    const store = createTestLibraryStore(tracks);
    expect(store.albums).toEqual(['Album A', 'Album B']);
  });

  it('returns albums in sorted order', () => {
    const tracks = [
      { id: '1', album: 'Zoo', title: 'Song 1' },
      { id: '2', album: 'Abbey Road', title: 'Song 2' },
      { id: '3', album: 'Magic', title: 'Song 3' },
    ];
    const store = createTestLibraryStore(tracks);
    expect(store.albums).toEqual(['Abbey Road', 'Magic', 'Zoo']);
  });

  test.prop([tracksArb])('album count is <= track count', (tracks) => {
    const store = createTestLibraryStore(tracks);
    expect(store.albums.length).toBeLessThanOrEqual(tracks.length);
  });

  test.prop([tracksArb])('all albums are unique', (tracks) => {
    const store = createTestLibraryStore(tracks);
    const uniqueAlbums = new Set(store.albums);
    expect(uniqueAlbums.size).toBe(store.albums.length);
  });
});

// -----------------------------------------------------------------------------
// Tests: tracksByArtist and tracksByAlbum Getters
// -----------------------------------------------------------------------------

describe('Library Store - tracksByArtist getter', () => {
  it('returns empty object for empty library', () => {
    const store = createTestLibraryStore([]);
    expect(store.tracksByArtist).toEqual({});
  });

  it('groups tracks by artist', () => {
    const tracks = [
      { id: '1', artist: 'Artist A', title: 'Song 1' },
      { id: '2', artist: 'Artist B', title: 'Song 2' },
      { id: '3', artist: 'Artist A', title: 'Song 3' },
    ];
    const store = createTestLibraryStore(tracks);
    const grouped = store.tracksByArtist;

    expect(Object.keys(grouped)).toEqual(['Artist A', 'Artist B']);
    expect(grouped['Artist A'].length).toBe(2);
    expect(grouped['Artist B'].length).toBe(1);
  });

  it('uses "Unknown Artist" for tracks without artist', () => {
    const tracks = [
      { id: '1', artist: null, title: 'Song 1' },
      { id: '2', artist: '', title: 'Song 2' },
      { id: '3', artist: undefined, title: 'Song 3' },
    ];
    const store = createTestLibraryStore(tracks);
    const grouped = store.tracksByArtist;

    expect(Object.keys(grouped)).toEqual(['Unknown Artist']);
    expect(grouped['Unknown Artist'].length).toBe(3);
  });

  test.prop([tracksArb])('total tracks equals sum of grouped tracks', (tracks) => {
    const store = createTestLibraryStore(tracks);
    const grouped = store.tracksByArtist;
    const totalGrouped = Object.values(grouped).reduce((sum, arr) => sum + arr.length, 0);
    expect(totalGrouped).toBe(tracks.length);
  });

  test.prop([tracksArb])('each track appears exactly once', (tracks) => {
    const store = createTestLibraryStore(tracks);
    const grouped = store.tracksByArtist;
    const allGroupedIds = Object.values(grouped)
      .flat()
      .map((t) => t.id);
    const uniqueIds = new Set(allGroupedIds);
    expect(uniqueIds.size).toBe(tracks.length);
  });
});

describe('Library Store - tracksByAlbum getter', () => {
  it('returns empty object for empty library', () => {
    const store = createTestLibraryStore([]);
    expect(store.tracksByAlbum).toEqual({});
  });

  it('groups tracks by album', () => {
    const tracks = [
      { id: '1', album: 'Album A', title: 'Song 1' },
      { id: '2', album: 'Album B', title: 'Song 2' },
      { id: '3', album: 'Album A', title: 'Song 3' },
    ];
    const store = createTestLibraryStore(tracks);
    const grouped = store.tracksByAlbum;

    expect(Object.keys(grouped)).toEqual(['Album A', 'Album B']);
    expect(grouped['Album A'].length).toBe(2);
    expect(grouped['Album B'].length).toBe(1);
  });

  it('uses "Unknown Album" for tracks without album', () => {
    const tracks = [
      { id: '1', album: null, title: 'Song 1' },
      { id: '2', album: '', title: 'Song 2' },
    ];
    const store = createTestLibraryStore(tracks);
    const grouped = store.tracksByAlbum;

    expect(Object.keys(grouped)).toEqual(['Unknown Album']);
    expect(grouped['Unknown Album'].length).toBe(2);
  });

  test.prop([tracksArb])('total tracks equals sum of grouped tracks', (tracks) => {
    const store = createTestLibraryStore(tracks);
    const grouped = store.tracksByAlbum;
    const totalGrouped = Object.values(grouped).reduce((sum, arr) => sum + arr.length, 0);
    expect(totalGrouped).toBe(tracks.length);
  });
});

// -----------------------------------------------------------------------------
// Tests: getTrack Method
// -----------------------------------------------------------------------------

describe('Library Store - getTrack', () => {
  it('returns track when found', () => {
    const tracks = [
      { id: 'track-1', title: 'Song 1' },
      { id: 'track-2', title: 'Song 2' },
    ];
    const store = createTestLibraryStore(tracks);
    const track = store.getTrack('track-1');
    expect(track).toEqual({ id: 'track-1', title: 'Song 1' });
  });

  it('returns null when track not found', () => {
    const tracks = [{ id: 'track-1', title: 'Song 1' }];
    const store = createTestLibraryStore(tracks);
    const track = store.getTrack('nonexistent');
    expect(track).toBeNull();
  });

  it('returns null for empty library', () => {
    const store = createTestLibraryStore([]);
    const track = store.getTrack('any-id');
    expect(track).toBeNull();
  });

  test.prop([tracksArb])('getTrack returns exact object from tracks array', (tracks) => {
    fc.pre(tracks.length > 0);
    const store = createTestLibraryStore(tracks);
    const randomTrack = tracks[Math.floor(Math.random() * tracks.length)];
    const found = store.getTrack(randomTrack.id);
    expect(found).toBe(randomTrack);
  });
});


// -----------------------------------------------------------------------------
// Tests: Statistics and State
// -----------------------------------------------------------------------------

describe('Library Store - Statistics', () => {
  it('calculates totalDuration from tracks', () => {
    const tracks = [
      { id: '1', duration: 180000 }, // 3 min
      { id: '2', duration: 240000 }, // 4 min
      { id: '3', duration: 120000 }, // 2 min
    ];
    const store = createTestLibraryStore(tracks);
    expect(store.totalDuration).toBe(540000); // 9 min
  });

  it('handles tracks with missing duration', () => {
    const tracks = [
      { id: '1', duration: 180000 },
      { id: '2' }, // No duration
      { id: '3', duration: null },
    ];
    const store = createTestLibraryStore(tracks);
    expect(store.totalDuration).toBe(180000);
  });

  it('sets totalTracks to track count', () => {
    const tracks = [{ id: '1' }, { id: '2' }, { id: '3' }];
    const store = createTestLibraryStore(tracks);
    expect(store.totalTracks).toBe(3);
  });

  test.prop([tracksArb])('totalDuration is sum of all durations', (tracks) => {
    const store = createTestLibraryStore(tracks);
    const expectedDuration = tracks.reduce((sum, t) => sum + (t.duration || 0), 0);
    expect(store.totalDuration).toBe(expectedDuration);
  });

  test.prop([tracksArb])('totalDuration is never negative', (tracks) => {
    const store = createTestLibraryStore(tracks);
    expect(store.totalDuration).toBeGreaterThanOrEqual(0);
  });
});

// -----------------------------------------------------------------------------
// Tests: Section and Loading State
// -----------------------------------------------------------------------------

describe('Library Store - Section State', () => {
  it('defaults to "all" section', () => {
    const store = createTestLibraryStore();
    expect(store.currentSection).toBe('all');
  });

  it('defaults to loading false', () => {
    const store = createTestLibraryStore();
    expect(store.loading).toBe(false);
  });

  it('defaults to scanning false', () => {
    const store = createTestLibraryStore();
    expect(store.scanning).toBe(false);
  });

  it('defaults to scanProgress 0', () => {
    const store = createTestLibraryStore();
    expect(store.scanProgress).toBe(0);
  });
});

// -----------------------------------------------------------------------------
// Tests: Sort Settings
// -----------------------------------------------------------------------------

describe('Library Store - Sort Settings', () => {
  it('defaults to "default" sortBy', () => {
    const store = createTestLibraryStore();
    expect(store.sortBy).toBe('default');
  });

  it('defaults to "asc" sortOrder', () => {
    const store = createTestLibraryStore();
    expect(store.sortOrder).toBe('asc');
  });

  it('defaults to empty searchQuery', () => {
    const store = createTestLibraryStore();
    expect(store.searchQuery).toBe('');
  });
});
