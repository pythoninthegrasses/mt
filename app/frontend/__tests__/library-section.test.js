/**
 * Tests for unified library_get_section integration.
 *
 * Verifies that applySectionData and buildCacheEntry correctly use
 * authoritative stats from the backend response (total_tracks, total_duration)
 * instead of computing them from the tracks array.
 */

import { describe, expect, it } from 'vitest';

// Mock window and Alpine before importing modules that depend on them
globalThis.window = {
  ...globalThis.window,
  Alpine: {
    disableEffectScheduling: (fn) => fn(),
  },
  __TAURI__: undefined,
};

// Dynamic import to ensure window mock is set up first
const { applySectionData } = await import('../js/utils/library-operations.js');
const { buildCacheEntry } = await import('../js/utils/library-cache.js');

// ---------------------------------------------------------------------------
// applySectionData
// ---------------------------------------------------------------------------

describe('applySectionData', () => {
  function createMockStore() {
    return {
      totalTracks: 0,
      totalDuration: 0,
      totalFileSize: 0,
      _lastLoadedSection: null,
      _sectionTracks: null,
      _setSectionTracks(tracks) {
        this._sectionTracks = tracks;
      },
    };
  }

  it('uses total_tracks, total_duration, and total_size from backend response', () => {
    const store = createMockStore();
    const tracks = [
      { id: 1, duration: 100, file_size: 5000 },
      { id: 2, duration: 200, file_size: 8000 },
    ];
    const data = {
      total_tracks: 42,
      total_duration: 12345.5,
      total_size: 9876543,
    };

    applySectionData(store, 'all', tracks, data);

    expect(store.totalTracks).toBe(42);
    expect(store.totalDuration).toBe(12345.5);
    expect(store.totalFileSize).toBe(9876543);
    expect(store._lastLoadedSection).toBe('all');
    expect(store._sectionTracks).toEqual(tracks);
  });

  it('falls back to total field when total_tracks is absent', () => {
    const store = createMockStore();
    const tracks = [{ id: 1, duration: 60 }];
    const data = { total: 10 };

    applySectionData(store, 'liked', tracks, data);

    expect(store.totalTracks).toBe(10);
  });

  it('falls back to tracks.length when no total fields present', () => {
    const store = createMockStore();
    const tracks = [{ id: 1 }, { id: 2 }, { id: 3 }];

    applySectionData(store, 'recent', tracks, {});

    expect(store.totalTracks).toBe(3);
  });

  it('falls back to computing totalDuration from tracks when total_duration absent', () => {
    const store = createMockStore();
    const tracks = [
      { id: 1, duration: 100 },
      { id: 2, duration: 200 },
    ];

    applySectionData(store, 'added', tracks, {});

    expect(store.totalDuration).toBe(300);
  });

  it('falls back to computing totalFileSize from tracks when total_size absent', () => {
    const store = createMockStore();
    const tracks = [
      { id: 1, file_size: 5000 },
      { id: 2, file_size: 8000 },
    ];

    applySectionData(store, 'added', tracks, {});

    expect(store.totalFileSize).toBe(13000);
  });

  it('prefers total_duration of 0 over JS-computed fallback', () => {
    const store = createMockStore();
    const tracks = [{ id: 1, duration: 100 }];
    const data = { total_duration: 0 };

    applySectionData(store, 'top25', tracks, data);

    // total_duration: 0 is a valid authoritative value
    expect(store.totalDuration).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// buildCacheEntry
// ---------------------------------------------------------------------------

describe('buildCacheEntry', () => {
  it('uses total_tracks, total_duration, and total_size from backend response', () => {
    const data = {
      tracks: [{ duration: 100, file_size: 5000 }],
      total_tracks: 500,
      total_duration: 99999.0,
      total_size: 9876543,
    };

    const entry = buildCacheEntry(data);

    expect(entry.totalTracks).toBe(500);
    expect(entry.totalDuration).toBe(99999.0);
    expect(entry.totalFileSize).toBe(9876543);
    expect(entry.timestamp).toBeGreaterThan(0);
  });

  it('falls back to total field when total_tracks is absent', () => {
    const data = {
      tracks: [{ duration: 100 }],
      total: 10,
    };

    const entry = buildCacheEntry(data);

    expect(entry.totalTracks).toBe(10);
  });

  it('falls back to tracks.length when no total fields', () => {
    const data = {
      tracks: [{ duration: 100 }, { duration: 200 }],
    };

    const entry = buildCacheEntry(data);

    expect(entry.totalTracks).toBe(2);
  });

  it('falls back to computing duration from tracks when total_duration absent', () => {
    const data = {
      tracks: [{ duration: 100 }, { duration: 200 }],
    };

    const entry = buildCacheEntry(data);

    expect(entry.totalDuration).toBe(300);
  });

  it('handles empty tracks with backend stats', () => {
    const data = {
      tracks: [],
      total_tracks: 0,
      total_duration: 0,
      total_size: 0,
    };

    const entry = buildCacheEntry(data);

    expect(entry.totalTracks).toBe(0);
    expect(entry.totalDuration).toBe(0);
    expect(entry.totalFileSize).toBe(0);
  });
});
