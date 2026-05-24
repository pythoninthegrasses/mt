/**
 * Tests for backgroundRefreshLibrary: verifies that a Plex/Last.fm sync does
 * not destroy the user's scroll position by clearing loaded pages.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Module-level mocks must be declared before any imports that depend on them
// ---------------------------------------------------------------------------

vi.mock('../js/api/library.js', () => ({
  library: {
    getSection: vi.fn(),
  },
}));

vi.mock('../js/api/shared.js', () => ({
  tauriInvoke: vi.fn(),
}));

vi.mock('../js/utils/watched-folders.js', () => ({
  promptToAddWatchedFolders: vi.fn(),
}));

// Alpine must exist on window before the module is imported
globalThis.window = {
  Alpine: { disableEffectScheduling: (fn) => fn() },
  __TAURI__: undefined,
};

const { backgroundRefreshLibrary } = await import('../js/utils/library-operations.js');
const { library } = await import('../js/api/library.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTrack(id) {
  return { id, title: `Track ${id}`, artist: 'Artist', duration: 180 };
}

function createStore(overrides = {}) {
  const page50 = [makeTrack(5001)];
  return {
    currentSection: 'all',
    totalTracks: 1000,
    localFileCount: 1000,
    totalDuration: 180000,
    totalFileSize: 500_000_000,
    _backgroundRefreshing: false,
    _lastRevision: 41,
    _pageSize: 500,
    _loadGeneration: 5,
    _trackPages: { 0: [makeTrack(1)], 50: page50 },
    _loadingPages: {},
    _allPagesLoaded: false,
    _dataVersion: 0,
    _page50: page50,
    _resetPages: vi.fn(function () {
      this._loadGeneration++;
      this._trackPages = {};
      this._loadingPages = {};
      this._allPagesLoaded = false;
    }),
    _updateCache: vi.fn(),
    _getFilterParams: vi.fn(() => ({ ignoreWords: null })),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('backgroundRefreshLibrary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    library.getSection.mockResolvedValue({
      tracks: [makeTrack(1)],
      total_tracks: 1000,
      total_duration: 180000,
      total_size: 500_000_000,
      revision: 42,
    });
  });

  it('preserves loaded pages beyond page 0 so user scroll position is maintained', async () => {
    const store = createStore();
    const originalPage50 = store._page50;

    await backgroundRefreshLibrary(store, 'all');

    expect(store._trackPages[50]).toBe(
      originalPage50,
      'page 50 should remain in _trackPages after background refresh',
    );
  });

  it('does not call _resetPages', async () => {
    const store = createStore();
    await backgroundRefreshLibrary(store, 'all');
    expect(store._resetPages).not.toHaveBeenCalled();
  });

  it('does not bump _loadGeneration', async () => {
    const store = createStore();
    const genBefore = store._loadGeneration;
    await backgroundRefreshLibrary(store, 'all');
    expect(store._loadGeneration).toBe(genBefore);
  });

  it('clears _loadingPages to drop stale in-flight fetches', async () => {
    const store = createStore();
    store._loadingPages = { 1: Promise.resolve(), 2: Promise.resolve() };
    await backgroundRefreshLibrary(store, 'all');
    expect(store._loadingPages).toEqual({});
  });

  it('updates page 0 with the fresh response', async () => {
    const store = createStore();
    const freshPage0 = [makeTrack(99)];
    library.getSection.mockResolvedValue({
      tracks: freshPage0,
      total_tracks: 1001,
      total_duration: 180180,
      total_size: 500_000_001,
      revision: 42,
    });

    await backgroundRefreshLibrary(store, 'all');

    expect(store._trackPages[0]).toEqual(freshPage0);
  });

  it('skips update when revision is unchanged', async () => {
    const store = createStore({ _lastRevision: 42 });
    library.getSection.mockResolvedValue({
      tracks: [],
      total_tracks: 999,
      revision: 42,
    });

    await backgroundRefreshLibrary(store, 'all');

    // Revision unchanged: no store mutations should happen
    expect(store._resetPages).not.toHaveBeenCalled();
    expect(store.totalTracks).toBe(1000); // unchanged
  });
});
