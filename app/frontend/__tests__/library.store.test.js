/**
 * Unit tests for the Library Store
 *
 * Tests pure functions and computed properties that don't require
 * Tauri backend or API mocking.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fc, test } from '@fast-check/vitest';

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
    },
  );

  test.prop([fc.integer({ min: 0, max: 59 * 60 * 1000 })])(
    'durations under 1 hour use "min" format',
    (duration) => {
      const store = createTestLibraryStore();
      store.totalDuration = duration;
      const result = store.formattedTotalDuration;

      expect(result).toMatch(/^\d+ min$/);
    },
  );

  test.prop([fc.integer({ min: 60 * 60 * 1000, max: 100 * 60 * 60 * 1000 })])(
    'durations 1 hour or more use "h m" format',
    (duration) => {
      const store = createTestLibraryStore();
      store.totalDuration = duration;
      const result = store.formattedTotalDuration;

      expect(result).toMatch(/^\d+h \d+m$/);
    },
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

// -----------------------------------------------------------------------------
// Tests: Pagination - Sparse Page Map
// -----------------------------------------------------------------------------

/**
 * Create a page-map-aware store for pagination testing
 */
function createPaginatedStore(pageSize = 5) {
  return {
    _trackPages: {},
    _loadingPages: {},
    _pageSize: pageSize,
    _loadGeneration: 0,
    _allPagesLoaded: false,
    _sectionTracks: null,
    _dataVersion: 0,
    totalTracks: 0,
    totalDuration: 0,

    _isPaginated() {
      return this._sectionTracks === null;
    },

    _resetPages() {
      this._loadGeneration++;
      this._trackPages = {};
      this._loadingPages = {};
      this._allPagesLoaded = false;
      this._sectionTracks = null;
    },

    _setSectionTracks(tracks) {
      this._sectionTracks = tracks;
      this._trackPages = {};
      this._loadingPages = {};
      this._allPagesLoaded = true;
    },

    getTrackAtIndex(i) {
      if (this._sectionTracks) {
        return this._sectionTracks[i] || null;
      }
      const pageIndex = Math.floor(i / this._pageSize);
      const page = this._trackPages[pageIndex];
      if (!page) return null;
      return page[i % this._pageSize] || null;
    },

    getTrack(trackId) {
      if (this._sectionTracks) {
        return this._sectionTracks.find((t) => t.id === trackId) || null;
      }
      for (const page of Object.values(this._trackPages)) {
        const found = page.find((t) => t.id === trackId);
        if (found) return found;
      }
      return null;
    },

    get filteredTracks() {
      if (this._sectionTracks) return this._sectionTracks;
      void this._dataVersion;
      const result = [];
      const pageCount = Math.ceil(this.totalTracks / this._pageSize);
      for (let i = 0; i < pageCount; i++) {
        const page = this._trackPages[i];
        if (page) result.push(...page);
      }
      return result;
    },
  };
}

function makeTracks(count, startId = 1) {
  return Array.from({ length: count }, (_, i) => ({
    id: `track-${startId + i}`,
    title: `Song ${startId + i}`,
    artist: `Artist ${startId + i}`,
    duration: 180000,
  }));
}

describe('Paginated Store - getTrackAtIndex', () => {
  it('returns track from loaded page', () => {
    const store = createPaginatedStore(3);
    store.totalTracks = 9;
    store._trackPages[0] = makeTracks(3);
    expect(store.getTrackAtIndex(0).id).toBe('track-1');
    expect(store.getTrackAtIndex(2).id).toBe('track-3');
  });

  it('returns null for unloaded page', () => {
    const store = createPaginatedStore(3);
    store.totalTracks = 9;
    store._trackPages[0] = makeTracks(3);
    expect(store.getTrackAtIndex(3)).toBeNull();
    expect(store.getTrackAtIndex(6)).toBeNull();
  });

  it('returns correct track from non-zero page', () => {
    const store = createPaginatedStore(3);
    store.totalTracks = 9;
    store._trackPages[1] = makeTracks(3, 4);
    expect(store.getTrackAtIndex(3).id).toBe('track-4');
    expect(store.getTrackAtIndex(5).id).toBe('track-6');
  });

  it('returns null for out-of-bounds index', () => {
    const store = createPaginatedStore(3);
    store.totalTracks = 3;
    store._trackPages[0] = makeTracks(3);
    expect(store.getTrackAtIndex(3)).toBeNull();
  });
});

describe('Paginated Store - getTrack', () => {
  it('finds track in loaded page', () => {
    const store = createPaginatedStore(3);
    store._trackPages[0] = makeTracks(3);
    store._trackPages[2] = makeTracks(3, 7);
    expect(store.getTrack('track-8').id).toBe('track-8');
  });

  it('returns null for track not in any loaded page', () => {
    const store = createPaginatedStore(3);
    store._trackPages[0] = makeTracks(3);
    expect(store.getTrack('track-99')).toBeNull();
  });
});

describe('Paginated Store - filteredTracks getter', () => {
  it('concatenates loaded pages in order', () => {
    const store = createPaginatedStore(3);
    store.totalTracks = 9;
    store._trackPages[0] = makeTracks(3);
    store._trackPages[2] = makeTracks(3, 7);
    const tracks = store.filteredTracks;
    expect(tracks.length).toBe(6);
    expect(tracks[0].id).toBe('track-1');
    expect(tracks[3].id).toBe('track-7');
  });

  it('returns empty array when no pages loaded', () => {
    const store = createPaginatedStore(3);
    store.totalTracks = 9;
    expect(store.filteredTracks).toEqual([]);
  });

  it('returns section tracks for non-paginated mode', () => {
    const store = createPaginatedStore(3);
    const tracks = makeTracks(5);
    store._setSectionTracks(tracks);
    expect(store.filteredTracks).toBe(tracks);
  });
});

describe('Paginated Store - _resetPages', () => {
  it('clears all page state', () => {
    const store = createPaginatedStore(3);
    store._trackPages[0] = makeTracks(3);
    store._loadingPages[1] = true;
    store._allPagesLoaded = true;
    const oldGen = store._loadGeneration;

    store._resetPages();

    expect(store._trackPages).toEqual({});
    expect(store._loadingPages).toEqual({});
    expect(store._allPagesLoaded).toBe(false);
    expect(store._loadGeneration).toBe(oldGen + 1);
  });
});

describe('Paginated Store - _isPaginated', () => {
  it('returns true when _sectionTracks is null', () => {
    const store = createPaginatedStore();
    expect(store._isPaginated()).toBe(true);
  });

  it('returns false when section tracks are set', () => {
    const store = createPaginatedStore();
    store._setSectionTracks([]);
    expect(store._isPaginated()).toBe(false);
  });
});

// -----------------------------------------------------------------------------
// Tests: loadLibraryData — FOUC regression
// -----------------------------------------------------------------------------

describe('loadLibraryData - FOUC regression', () => {
  let loadLibraryData;

  let mockGetSection;

  beforeEach(async () => {
    vi.resetModules();

    // Mock the library API with getSection (unified endpoint)
    mockGetSection = vi.fn().mockResolvedValue({
      section: 'all',
      tracks: makeTracks(50),
      total_tracks: 50,
      total_duration: 3600,
      has_more: false,
      revision: 1,
    });
    vi.doMock('../js/api/library.js', () => ({
      library: {
        getSection: mockGetSection,
      },
    }));

    // Mock watched-folders (imported by library-operations but unused here)
    vi.doMock('../js/utils/watched-folders.js', () => ({
      promptToAddWatchedFolders: vi.fn(),
    }));

    // Provide window.Alpine.disableEffectScheduling
    globalThis.window = globalThis.window || {};
    globalThis.window.Alpine = {
      disableEffectScheduling: (fn) => fn(),
    };

    const mod = await import('../js/utils/library-operations.js');
    loadLibraryData = mod.loadLibraryData;
  });

  function createLoadStore() {
    const store = createPaginatedStore(50);
    // Simulate pre-existing data (as if "all" section was loaded before)
    store.totalTracks = 1000;
    store.totalDuration = 50000;
    store._trackPages[0] = makeTracks(50);
    store.currentSection = 'all';
    store._lastLoadedSection = 'all';
    store._sectionCache = {};
    store._getFilterParams = () => ({});
    store._updateCache = vi.fn();
    return store;
  }

  it('zeroes totalTracks before async fetch to prevent empty placeholder rows', async () => {
    const store = createLoadStore();
    const statesDuringFetch = [];

    // Capture state when getSection is called (during the await)
    mockGetSection.mockImplementation(() => {
      statesDuringFetch.push({
        totalTracks: store.totalTracks,
        loading: store.loading,
        pagesEmpty: Object.keys(store._trackPages).length === 0,
      });
      return Promise.resolve({
        section: 'all',
        tracks: makeTracks(50),
        total_tracks: 50,
        total_duration: 3600,
        has_more: false,
        revision: 1,
      });
    });

    await loadLibraryData(store);

    // During fetch, totalTracks must be 0 so loading spinner shows
    expect(statesDuringFetch).toHaveLength(1);
    expect(statesDuringFetch[0].totalTracks).toBe(0);
    expect(statesDuringFetch[0].loading).toBe(true);
    expect(statesDuringFetch[0].pagesEmpty).toBe(true);

    // After load completes, data is populated
    expect(store.totalTracks).toBe(50);
    expect(store.loading).toBe(false);
  });

  it('does not flash stale cached totalTracks when pages are empty', async () => {
    const store = createLoadStore();
    // Seed cache from a previous load
    store._sectionCache = {
      all: { totalTracks: 1000, totalDuration: 50000, timestamp: Date.now() },
    };

    const tracksSeenDuringFetch = [];
    mockGetSection.mockImplementation(() => {
      tracksSeenDuringFetch.push(store.totalTracks);
      return Promise.resolve({
        section: 'all',
        tracks: makeTracks(50),
        total_tracks: 50,
        total_duration: 3600,
        has_more: false,
        revision: 1,
      });
    });

    await loadLibraryData(store);

    // Even with cache, totalTracks should be 0 during fetch (not 1000)
    expect(tracksSeenDuringFetch[0]).toBe(0);
  });

  it('page 0 data is available when totalTracks becomes non-zero (no placeholder flash)', async () => {
    const store = createLoadStore();
    // Start from a clean state (simulating first app load)
    store.totalTracks = 0;
    store._trackPages = {};

    // Instrument disableEffectScheduling to capture state at the moment
    // totalTracks transitions from 0 to non-zero. In production, Alpine
    // re-evaluates dependent getters (like visibleTracks) when the batch
    // flushes. If _trackPages[0] isn't set yet, getTrackAtIndex returns
    // null and placeholder rows flash (the FOUC).
    let page0AtTransition = undefined;
    globalThis.window.Alpine.disableEffectScheduling = (fn) => {
      const origTotalTracks = store.totalTracks;
      fn();
      // If totalTracks just transitioned from 0 to non-zero, check page 0
      if (origTotalTracks === 0 && store.totalTracks > 0) {
        page0AtTransition = store._trackPages[0];
      }
    };

    await loadLibraryData(store);

    // Page 0 must be populated at the exact moment totalTracks becomes > 0
    expect(page0AtTransition).toBeDefined();
    expect(page0AtTransition.length).toBeGreaterThan(0);
    // First track should be a real track, not a placeholder
    expect(page0AtTransition[0]).toHaveProperty('id');
  });
});

// Tests: FOUC #1 — init() must not expose totalTracks from cache before pages exist
// Tests: FOUC #2 — visibleTracks must not produce placeholder rows for unloaded pages
// -----------------------------------------------------------------------------

describe('FOUC #1 - init() cache must not cause placeholder rows', () => {
  let createLibraryStore;
  let mockGetSection;
  let registeredStore;

  beforeEach(async () => {
    vi.resetModules();

    mockGetSection = vi.fn().mockResolvedValue({
      section: 'all',
      tracks: makeTracks(50),
      total_tracks: 13043,
      total_duration: 500000,
      has_more: true,
      revision: 1,
    });

    vi.doMock('../js/api/library.js', () => ({
      library: { getSection: mockGetSection },
    }));

    vi.doMock('../js/utils/watched-folders.js', () => ({
      promptToAddWatchedFolders: vi.fn(),
    }));

    registeredStore = null;
    globalThis.window = globalThis.window || {};
    globalThis.window.Alpine = {
      disableEffectScheduling: (fn) => fn(),
      store: (_name, definition) => {
        if (definition) registeredStore = definition;
        return registeredStore;
      },
    };
    globalThis.window.settings = {
      initialized: true,
      get: (key, defaultVal) => {
        if (key === 'sidebar:activeSection') return 'all';
        if (key === 'library:sectionCache') {
          return {
            all: {
              totalTracks: 13043,
              totalDuration: 500000,
              timestamp: Date.now(),
            },
          };
        }
        return defaultVal;
      },
      set: vi.fn().mockResolvedValue(undefined),
    };

    const mod = await import('../js/stores/library.js');
    createLibraryStore = mod.createLibraryStore;
  });

  it('totalTracks stays 0 while loading even when cache has data', async () => {
    createLibraryStore(globalThis.window.Alpine);
    const store = registeredStore;

    // The FOUC happens because init() does:
    //   1. this.totalTracks = cached.totalTracks  (13043)
    //   2. await this.load()  -> loadLibraryData() -> totalTracks = 0
    // Between steps 1 and 2, Alpine renders and sees totalTracks > 0
    // with empty _trackPages, producing placeholder rows.
    //
    // We verify by checking that init() never sets totalTracks to a
    // non-zero value while _trackPages is empty.
    const statesObserved = [];
    // No need to save original descriptor — we restore as a plain data property below

    // Intercept totalTracks assignments to detect the FOUC window
    let _totalTracks = store.totalTracks;
    Object.defineProperty(store, 'totalTracks', {
      get() {
        return _totalTracks;
      },
      set(val) {
        _totalTracks = val;
        if (val > 0 && Object.keys(store._trackPages).length === 0) {
          statesObserved.push({
            totalTracks: val,
            pagesEmpty: true,
            // This is the FOUC: totalTracks > 0 but no page data
          });
        }
      },
      configurable: true,
    });

    await store.init();

    // Restore as a plain data property with the current intercepted value
    delete store.totalTracks;
    store.totalTracks = _totalTracks;

    // The fix: totalTracks should NEVER be > 0 while _trackPages is empty.
    // Any such state would cause visibleTracks to produce placeholder rows.
    expect(statesObserved).toHaveLength(0);

    // After init completes, real data is loaded
    expect(store.totalTracks).toBe(13043);
  });
});

describe('FOUC #2 - visibleTracks must not produce placeholders for unloaded pages', () => {
  let browserFactory;

  beforeEach(async () => {
    vi.resetModules();

    // Mock all dependencies that library-browser.js imports
    vi.doMock('../js/utils/formatting.js', () => ({
      formatDurationDash: vi.fn(),
      formatRelativeTime: vi.fn(),
    }));
    vi.doMock('../js/utils/dom.js', () => ({
      isTypingInInput: vi.fn(),
    }));
    vi.doMock('../js/mixins/type-to-jump.js', () => ({
      typeToJumpMixin: () => ({}),
    }));
    vi.doMock('../js/mixins/column-geometry.js', () => ({
      columnGeometryMixin: () => ({}),
    }));
    vi.doMock('../js/mixins/column-reorder.js', () => ({
      columnReorderMixin: () => ({}),
    }));
    vi.doMock('../js/mixins/column-settings.js', () => ({
      columnSettingsMixin: () => ({}),
    }));
    vi.doMock('../js/mixins/playlist-drag.js', () => ({
      playlistDragMixin: () => ({}),
    }));
    vi.doMock('../js/mixins/context-menu-actions.js', () => ({
      contextMenuActionsMixin: () => ({}),
    }));
    vi.doMock('../js/mixins/virtual-scroll.js', () => ({
      virtualScrollMixin: () => ({}),
    }));
    vi.doMock('../js/utils/queue-builder.js', () => ({
      handleDoubleClickPlay: vi.fn(),
    }));

    // Capture the factory function passed to Alpine.data
    const mockAlpine = {
      data: (name, factory) => {
        if (name === 'libraryBrowser') {
          browserFactory = factory;
        }
      },
    };

    const mod = await import('../js/components/library-browser.js');
    mod.createLibraryBrowser(mockAlpine);
  });

  it('skips indices where page data is not yet loaded instead of showing placeholders', () => {
    // Simulate: loadLibraryData completed, page 0 has 50 tracks,
    // but scroll position points to page 2 (indices 100-149)
    const store = createPaginatedStore(50);
    store.totalTracks = 13043;
    store._trackPages = { 0: makeTracks(50) };
    store._dataVersion = 1;
    store._ensurePage = vi.fn();

    // Create the browser component with a mock library store
    const browser = browserFactory();
    browser.$store = { library: store };
    browser._rowHeight = 36;
    browser._containerHeight = 800;
    browser._bufferRows = 5;
    browser._scrollTop = 100 * 36; // Scrolled to ~track 100 (page 2)

    const tracks = browser.visibleTracks;
    const placeholders = tracks.filter((r) => r.track._placeholder);

    // No placeholders should be shown for unloaded pages
    expect(placeholders).toHaveLength(0);

    // _ensurePage should still be called to trigger async fetch
    expect(store._ensurePage).toHaveBeenCalled();
  });
});

// -----------------------------------------------------------------------------
// Tests: _getFilterParams must include sort/order/ignoreWords for article stripping
// -----------------------------------------------------------------------------

describe('_getFilterParams includes sort params', () => {
  let createLibraryStore;
  let registeredStore;

  beforeEach(async () => {
    vi.resetModules();

    vi.doMock('../js/api/library.js', () => ({
      library: {
        getSection: vi.fn().mockResolvedValue({
          tracks: [],
          total_tracks: 0,
          total_duration: 0,
          revision: 1,
        }),
      },
    }));

    vi.doMock('../js/utils/watched-folders.js', () => ({
      promptToAddWatchedFolders: vi.fn(),
    }));

    registeredStore = null;
    globalThis.window = globalThis.window || {};
    globalThis.window.Alpine = {
      disableEffectScheduling: (fn) => fn(),
      store: (name, definition) => {
        if (name === 'library') {
          if (definition) registeredStore = definition;
          return registeredStore;
        }
        if (name === 'ui') {
          return {
            sortIgnoreWords: true,
            sortIgnoreWordsList: 'the, a, an, el, la',
          };
        }
        return null;
      },
    };
    globalThis.window.settings = {
      initialized: true,
      get: (_key, defaultVal) => defaultVal,
      set: vi.fn().mockResolvedValue(undefined),
    };

    const mod = await import('../js/stores/library.js');
    createLibraryStore = mod.createLibraryStore;
    createLibraryStore(globalThis.window.Alpine);
  });

  it('returns sort key mapped from sortBy', () => {
    const store = registeredStore;
    store.sortBy = 'default';
    const params = store._getFilterParams();
    expect(params.sort).toBe('artist');
  });

  it('returns order from sortOrder', () => {
    const store = registeredStore;
    store.sortOrder = 'desc';
    const params = store._getFilterParams();
    expect(params.order).toBe('desc');
  });

  it('returns ignoreWords from ui store when enabled', () => {
    const store = registeredStore;
    const params = store._getFilterParams();
    expect(params.ignoreWords).toBe('the, a, an, el, la');
  });

  it('returns search query', () => {
    const store = registeredStore;
    store.searchQuery = 'tribe';
    const params = store._getFilterParams();
    expect(params.search).toBe('tribe');
  });

  it('returns null search when query is empty', () => {
    const store = registeredStore;
    store.searchQuery = '';
    const params = store._getFilterParams();
    expect(params.search).toBeNull();
  });
});

// -----------------------------------------------------------------------------
// Tests: Plex batch download toast
// -----------------------------------------------------------------------------

describe('Plex batch download toast', () => {
  let createLibraryStore;
  let registeredStore;
  let mockUi;

  beforeEach(async () => {
    vi.resetModules();

    vi.doMock('../js/api/library.js', () => ({
      library: {
        getSection: vi.fn().mockResolvedValue({
          tracks: [],
          total_tracks: 0,
          total_duration: 0,
          revision: 1,
        }),
      },
    }));
    vi.doMock('../js/utils/watched-folders.js', () => ({
      promptToAddWatchedFolders: vi.fn(),
    }));

    let toastCounter = 0;
    mockUi = {
      toast: vi.fn((_msg, _type, _dur) => `toast-${++toastCounter}`),
      dismissToast: vi.fn(),
      updateToast: vi.fn(),
    };

    registeredStore = null;
    globalThis.window = globalThis.window || {};
    globalThis.window.Alpine = {
      disableEffectScheduling: (fn) => fn(),
      store: (name, definition) => {
        if (name === 'library') {
          if (definition) registeredStore = definition;
          return registeredStore;
        }
        if (name === 'ui') return mockUi;
        return null;
      },
    };
    globalThis.window.settings = {
      initialized: true,
      get: (_k, d) => d,
      set: vi.fn().mockResolvedValue(undefined),
    };

    const mod = await import('../js/stores/library.js');
    createLibraryStore = mod.createLibraryStore;
    createLibraryStore(globalThis.window.Alpine);
  });

  it('_startPlexBatch shows a persistent "0 / N tracks downloaded" toast', () => {
    const store = registeredStore;
    store._startPlexBatch([101, 102, 103]);
    expect(mockUi.toast).toHaveBeenCalledWith('0 / 3 tracks downloaded', 'info', 0);
  });

  it('_plexBatchTrackDone(id, true) updates toast with incremented count', () => {
    const store = registeredStore;
    store._startPlexBatch([101, 102]);
    const toastId = mockUi.toast.mock.results[0].value;
    store._plexBatchTrackDone(101, true);
    expect(mockUi.updateToast).toHaveBeenCalledWith(toastId, '1 / 2 tracks downloaded');
  });

  it('_plexBatchTrackDone deletes track from pendingIds', () => {
    const store = registeredStore;
    store._startPlexBatch([101, 102]);
    store._plexBatchTrackDone(101, true);
    expect(store._plexBatch.pendingIds.has(101)).toBe(false);
    expect(store._plexBatch.pendingIds.has(102)).toBe(true);
  });

  it('updates toast in-place and schedules auto-dismiss when all complete', () => {
    vi.useFakeTimers();
    const store = registeredStore;
    store._startPlexBatch([101]);
    const toastId = mockUi.toast.mock.results[0].value;
    store._plexBatchTrackDone(101, true);
    // final message written to same toast, not a new one
    expect(mockUi.updateToast).toHaveBeenCalledWith(toastId, '1 track downloaded');
    expect(mockUi.dismissToast).not.toHaveBeenCalled();
    expect(store._plexBatch).toBeNull();
    // toast dismisses after 3 s
    vi.advanceTimersByTime(3000);
    expect(mockUi.dismissToast).toHaveBeenCalledWith(toastId);
    vi.useRealTimers();
  });

  it('shows plural final message for multiple tracks', () => {
    vi.useFakeTimers();
    const store = registeredStore;
    store._startPlexBatch([101, 102]);
    const toastId = mockUi.toast.mock.results[0].value;
    store._plexBatchTrackDone(101, true);
    store._plexBatchTrackDone(102, true);
    expect(mockUi.updateToast).toHaveBeenLastCalledWith(toastId, '2 tracks downloaded');
    vi.useRealTimers();
  });

  it('_plexBatchTrackDone(id, false) includes failure count in progress update', () => {
    const store = registeredStore;
    store._startPlexBatch([101, 102]);
    const toastId = mockUi.toast.mock.results[0].value;
    store._plexBatchTrackDone(101, false);
    expect(mockUi.updateToast).toHaveBeenCalledWith(toastId, '0 / 2 tracks downloaded (1 failed)');
  });

  it('shows warning-type final message when some tracks fail', () => {
    vi.useFakeTimers();
    const store = registeredStore;
    store._startPlexBatch([101, 102]);
    const toastId = mockUi.toast.mock.results[0].value;
    store._plexBatchTrackDone(101, true);
    store._plexBatchTrackDone(102, false);
    expect(mockUi.updateToast).toHaveBeenLastCalledWith(
      toastId,
      '1 downloaded, 1 failed',
      'warning',
    );
    vi.advanceTimersByTime(5000);
    expect(mockUi.dismissToast).toHaveBeenCalledWith(toastId);
    expect(store._plexBatch).toBeNull();
    vi.useRealTimers();
  });

  it('_startPlexBatch extends existing batch when one is already active', () => {
    const store = registeredStore;
    store._startPlexBatch([101, 102]);
    const firstToastId = mockUi.toast.mock.results[0].value;
    store._startPlexBatch([103]);
    expect(mockUi.toast).toHaveBeenCalledTimes(1);
    expect(mockUi.updateToast).toHaveBeenCalledWith(firstToastId, '0 / 3 tracks downloaded');
    expect(store._plexBatch.total).toBe(3);
  });

  it('starting a new batch cancels any pending dismiss timer', () => {
    vi.useFakeTimers();
    const store = registeredStore;
    store._startPlexBatch([101]);
    const firstToastId = mockUi.toast.mock.results[0].value;
    store._plexBatchTrackDone(101, true);
    // First batch done, timer scheduled for 3s
    expect(store._plexBatch).toBeNull();
    // Start second batch before 3s elapses
    store._startPlexBatch([201]);
    const secondToastId = mockUi.toast.mock.results[1].value;
    // Advance past the first batch's dismiss window — should NOT dismiss second toast
    vi.advanceTimersByTime(3000);
    const dismissCalls = mockUi.dismissToast.mock.calls.map((c) => c[0]);
    expect(dismissCalls).not.toContain(secondToastId);
    // Only the first toast should have been dismissed
    expect(dismissCalls).toContain(firstToastId);
    vi.useRealTimers();
  });
});
