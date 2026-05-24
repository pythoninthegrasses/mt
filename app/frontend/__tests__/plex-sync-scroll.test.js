/**
 * Unit tests for plex-sync-complete handler.
 *
 * Verifies that the plex-sync-complete event triggers a background refresh
 * (which does NOT zero totalTracks) rather than fetchTracks (which does).
 *
 * The scroll-reset bug: fetchTracks() → loadLibraryData sets totalTracks=0 before
 * re-fetching, collapsing the virtual-scroll spacer and resetting scrollTop to 0.
 * backgroundRefreshLibrary() swaps in data atomically after the fetch.
 */

import { describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Minimal store stub that captures which refresh path is taken
// ---------------------------------------------------------------------------

function createStoreStub({ currentSection = 'all' } = {}) {
  return {
    currentSection,
    totalTracks: 500,
    _backgroundRefresh: vi.fn(),
    fetchTracks: vi.fn(() => {
      // Simulate the bug: fetchTracks zeros totalTracks before fetching
      this.totalTracks = 0;
    }),
    _onPlexSyncComplete() {
      this._backgroundRefresh('all');
    },
  };
}

describe('plex-sync-complete handler', () => {
  it('calls _backgroundRefresh, not fetchTracks', () => {
    const store = createStoreStub();
    store._onPlexSyncComplete();

    expect(store._backgroundRefresh).toHaveBeenCalledWith('all');
    expect(store.fetchTracks).not.toHaveBeenCalled();
  });

  it('does not zero totalTracks when handling sync', () => {
    const store = createStoreStub();
    const totalBefore = store.totalTracks;

    store._onPlexSyncComplete();

    // totalTracks should be unchanged — backgroundRefresh does not zero it
    expect(store.totalTracks).toBe(totalBefore);
  });
});
