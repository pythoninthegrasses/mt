/**
 * Unit tests for the SWR (stale-while-revalidate) snapshot in visibleTracks.
 *
 * Tests the render-side fallback logic that keeps the viewport populated
 * with the last known tracks while an unloaded page is being fetched.
 * This is the Option A implementation from TASK-334.
 */

import { describe, expect, it } from 'vitest';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeTrack(id) {
  return { id: `track-${id}`, title: `Track ${id}`, artist: 'Artist' };
}

/**
 * Create a minimal page store that mirrors library.js pagination logic.
 */
function createLibStub({
  totalTracks = 0,
  pageSize = 10,
  loadedPages = {},
  loadGeneration = 0,
  sectionTracks = null,
} = {}) {
  return {
    _dataVersion: 0,
    _loadGeneration: loadGeneration,
    totalTracks,
    _pageSize: pageSize,
    _trackPages: { ...loadedPages },
    _loadingPages: {},
    _sectionTracks: sectionTracks,
    _isPaginated() {
      return this._sectionTracks === null;
    },
    _ensurePage() {},
    getTrackAtIndex(i) {
      if (this._sectionTracks) return this._sectionTracks[i] || null;
      const pageIndex = Math.floor(i / this._pageSize);
      const page = this._trackPages[pageIndex];
      if (!page) return null;
      return page[i % this._pageSize] || null;
    },
  };
}

/**
 * Create a minimal component stub that replicates only the SWR-relevant
 * parts of visibleTracks, startIndex, and endIndex.
 */
function createBrowserStub(
  { lib, scrollTop = 0, containerHeight = 100, rowHeight = 34, bufferRows = 0, isJumping = false } = {},
) {
  const comp = {
    _swrSnapshot: [],
    _swrGeneration: -1,
    _scrollTop: scrollTop,
    _containerHeight: containerHeight,
    _rowHeight: rowHeight,
    _bufferRows: bufferRows,
    _isJumping: isJumping,

    get library() {
      return lib;
    },

    get startIndex() {
      const trackCount = lib.totalTracks;
      if (trackCount === 0) return 0;
      const clampedScroll = Math.min(this._scrollTop, trackCount * this._rowHeight);
      return Math.max(0, Math.floor(clampedScroll / this._rowHeight) - this._bufferRows);
    },

    get endIndex() {
      const trackCount = lib.totalTracks;
      if (trackCount === 0) return 0;
      const clampedScroll = Math.min(this._scrollTop, trackCount * this._rowHeight);
      const visibleRows = Math.ceil(this._containerHeight / this._rowHeight);
      return Math.min(
        trackCount,
        Math.floor(clampedScroll / this._rowHeight) + visibleRows + this._bufferRows,
      );
    },

    get visibleTracks() {
      void lib._dataVersion;
      const end = Math.min(this.endIndex, lib.totalTracks);
      const result = [];

      if (lib._loadGeneration !== this._swrGeneration) {
        this._swrSnapshot = [];
        this._swrGeneration = lib._loadGeneration;
      }

      if (lib._isPaginated()) {
        const pageSize = lib._pageSize;
        const firstPage = Math.floor(this.startIndex / pageSize);
        const lastPage = Math.floor(Math.max(0, end - 1) / pageSize);
        for (let p = firstPage; p <= lastPage + 1; p++) {
          lib._ensurePage(p);
        }
      }

      for (let i = this.startIndex; i < end; i++) {
        const track = lib.getTrackAtIndex(i);
        if (track) result.push({ track, globalIndex: i });
      }

      if (result.length > 0) {
        this._swrSnapshot = result;
        return result;
      }
      if (this._isJumping) {
        const placeholders = [];
        for (let i = this.startIndex; i < end; i++) {
          placeholders.push({ track: { _placeholder: true }, globalIndex: i });
        }
        return placeholders;
      }
      return this._swrSnapshot;
    },
  };

  return comp;
}

// ---------------------------------------------------------------------------
// Tests: visibleTracks SWR behavior
// ---------------------------------------------------------------------------

describe('visibleTracks SWR — returns real tracks when page is loaded', () => {
  it('returns tracks for loaded page 0 at scroll position 0', () => {
    const tracks = Array.from({ length: 10 }, (_, i) => makeTrack(i));
    const lib = createLibStub({ totalTracks: 10, loadedPages: { 0: tracks } });
    const comp = createBrowserStub({ lib, scrollTop: 0, containerHeight: 340 });

    const result = comp.visibleTracks;

    expect(result).toHaveLength(10);
    expect(result[0].track.id).toBe('track-0');
    expect(result[9].track.id).toBe('track-9');
  });

  it('updates snapshot when real tracks are returned', () => {
    const tracks = Array.from({ length: 5 }, (_, i) => makeTrack(i));
    const lib = createLibStub({ totalTracks: 5, loadedPages: { 0: tracks } });
    const comp = createBrowserStub({ lib, scrollTop: 0, containerHeight: 200 });

    comp.visibleTracks;

    expect(comp._swrSnapshot).toHaveLength(5);
  });

  it('includes globalIndex matching track position', () => {
    const tracks = Array.from({ length: 10 }, (_, i) => makeTrack(i));
    const lib = createLibStub({ totalTracks: 20, pageSize: 10, loadedPages: { 0: tracks } });
    const comp = createBrowserStub({ lib, scrollTop: 0, containerHeight: 200 });

    const result = comp.visibleTracks;

    result.forEach((item, idx) => {
      expect(item.globalIndex).toBe(idx);
    });
  });
});

describe('visibleTracks SWR — serves stale snapshot when page is unloaded', () => {
  it('returns snapshot when current viewport page is missing', () => {
    const page0tracks = Array.from({ length: 10 }, (_, i) => makeTrack(i));
    const lib = createLibStub({ totalTracks: 20, pageSize: 10, loadedPages: { 0: page0tracks } });
    // containerHeight = 10 * 34 = 340 so all 10 tracks fit in viewport
    const comp = createBrowserStub({ lib, scrollTop: 0, containerHeight: 340 });

    // Populate snapshot by rendering the loaded page
    comp.visibleTracks;
    expect(comp._swrSnapshot).toHaveLength(10);

    // Scroll to page 1 (not loaded) — snapshot should be returned
    comp._scrollTop = 10 * 34; // Jump to track index 10
    const result = comp.visibleTracks;

    expect(result).toHaveLength(10);
    expect(result[0].track.id).toBe('track-0'); // stale data from page 0
  });

  it('returns empty array when snapshot is empty and page is unloaded', () => {
    const lib = createLibStub({ totalTracks: 20, pageSize: 10, loadedPages: {} });
    const comp = createBrowserStub({ lib, scrollTop: 0, containerHeight: 200 });

    const result = comp.visibleTracks;

    expect(result).toHaveLength(0);
  });

  it('snapshot persists across multiple unloaded-page accesses', () => {
    const page0tracks = Array.from({ length: 10 }, (_, i) => makeTrack(i));
    const lib = createLibStub({ totalTracks: 30, pageSize: 10, loadedPages: { 0: page0tracks } });
    // containerHeight = 340 so all 10 tracks from page 0 fit in viewport
    const comp = createBrowserStub({ lib, scrollTop: 0, containerHeight: 340 });

    comp.visibleTracks; // populate snapshot

    comp._scrollTop = 10 * 34; // page 1, unloaded
    const first = comp.visibleTracks;
    comp._scrollTop = 20 * 34; // page 2, also unloaded
    const second = comp.visibleTracks;

    expect(first).toHaveLength(10);
    expect(second).toHaveLength(10);
    expect(first[0].track.id).toBe(second[0].track.id);
  });
});

describe('visibleTracks SWR — clears snapshot on load generation change', () => {
  it('clears snapshot when _loadGeneration increments', () => {
    const page0tracks = Array.from({ length: 10 }, (_, i) => makeTrack(i));
    const lib = createLibStub({
      totalTracks: 20,
      pageSize: 10,
      loadedPages: { 0: page0tracks },
      loadGeneration: 0,
    });
    // containerHeight = 340 so all 10 tracks from page 0 fit in viewport
    const comp = createBrowserStub({ lib, scrollTop: 0, containerHeight: 340 });

    comp.visibleTracks; // populate snapshot
    expect(comp._swrSnapshot).toHaveLength(10);

    // Simulate section switch / search: generation increments, pages cleared
    lib._loadGeneration = 1;
    lib._trackPages = {};
    lib.totalTracks = 0;

    const result = comp.visibleTracks;

    expect(result).toHaveLength(0);
    expect(comp._swrSnapshot).toHaveLength(0);
    expect(comp._swrGeneration).toBe(1);
  });

  it('snapshot rebuilds after generation change when new page loads', () => {
    const oldTracks = Array.from({ length: 10 }, (_, i) => makeTrack(i));
    const lib = createLibStub({
      totalTracks: 10,
      pageSize: 10,
      loadedPages: { 0: oldTracks },
      loadGeneration: 0,
    });
    const comp = createBrowserStub({ lib, scrollTop: 0, containerHeight: 200 });

    comp.visibleTracks; // populate snapshot with old tracks

    // Simulate section switch
    const newTracks = Array.from({ length: 10 }, (_, i) => makeTrack(100 + i));
    lib._loadGeneration = 1;
    lib._trackPages = { 0: newTracks };
    lib.totalTracks = 10;

    const result = comp.visibleTracks;

    expect(result[0].track.id).toBe('track-100'); // new data
    expect(comp._swrSnapshot[0].track.id).toBe('track-100');
    expect(comp._swrGeneration).toBe(1);
  });
});

describe('visibleTracks SWR — section tracks (non-paginated)', () => {
  it('returns section tracks directly when _sectionTracks is set', () => {
    const tracks = Array.from({ length: 5 }, (_, i) => makeTrack(i));
    const lib = createLibStub({ totalTracks: 5, sectionTracks: tracks });
    const comp = createBrowserStub({ lib, scrollTop: 0, containerHeight: 200 });

    const result = comp.visibleTracks;

    expect(result).toHaveLength(5);
    expect(result[0].track.id).toBe('track-0');
  });
});

describe('visibleTracks SWR — placeholder rows during _isJumping', () => {
  it('returns placeholder rows instead of stale snapshot when _isJumping=true', () => {
    const page0tracks = Array.from({ length: 10 }, (_, i) => makeTrack(i));
    const lib = createLibStub({ totalTracks: 100, pageSize: 10, loadedPages: { 0: page0tracks } });
    const comp = createBrowserStub({ lib, scrollTop: 0, containerHeight: 340 });

    // Populate snapshot with page-0 rows (the "old" viewport)
    comp.visibleTracks;
    expect(comp._swrSnapshot).toHaveLength(10);

    // Simulate _jumpViaBackend: scroll to a remote region and mark as jumping
    comp._scrollTop = 50 * 34; // target offset 50, page 5 not loaded
    comp._isJumping = true;

    const result = comp.visibleTracks;

    // Should be placeholder rows, NOT stale page-0 tracks
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((item) => item.track._placeholder === true)).toBe(true);
    expect(result[0].track.id).toBeUndefined();
  });

  it('placeholder items have correct globalIndex values matching target viewport', () => {
    const page0tracks = Array.from({ length: 10 }, (_, i) => makeTrack(i));
    const lib = createLibStub({ totalTracks: 100, pageSize: 10, loadedPages: { 0: page0tracks } });
    // containerHeight = 340 → shows 10 rows at 34px each
    const comp = createBrowserStub({ lib, scrollTop: 0, containerHeight: 340 });
    comp.visibleTracks; // populate snapshot

    comp._scrollTop = 50 * 34; // target row 50
    comp._isJumping = true;

    const result = comp.visibleTracks;

    expect(result[0].globalIndex).toBe(50);
    expect(result[result.length - 1].globalIndex).toBe(59);
  });

  it('returns real tracks once page loads even with _isJumping=true', () => {
    const page0tracks = Array.from({ length: 10 }, (_, i) => makeTrack(i));
    const page5tracks = Array.from({ length: 10 }, (_, i) => makeTrack(50 + i));
    const lib = createLibStub({
      totalTracks: 100,
      pageSize: 10,
      loadedPages: { 0: page0tracks, 5: page5tracks },
    });
    const comp = createBrowserStub({ lib, scrollTop: 0, containerHeight: 340 });
    comp.visibleTracks; // populate snapshot

    comp._scrollTop = 50 * 34;
    comp._isJumping = true;

    const result = comp.visibleTracks;

    // Page 5 is loaded, so real tracks should be returned
    expect(result.every((item) => item.track._placeholder === true)).toBe(false);
    expect(result[0].track.id).toBe('track-50');
  });

  it('falls back to stale snapshot when _isJumping=false and page is unloaded', () => {
    const page0tracks = Array.from({ length: 10 }, (_, i) => makeTrack(i));
    const lib = createLibStub({ totalTracks: 100, pageSize: 10, loadedPages: { 0: page0tracks } });
    const comp = createBrowserStub({ lib, scrollTop: 0, containerHeight: 340 });
    comp.visibleTracks; // populate snapshot

    comp._scrollTop = 50 * 34;
    comp._isJumping = false; // not jumping — normal SWR scroll

    const result = comp.visibleTracks;

    // Stale snapshot should still be served for normal scroll (not jumping)
    expect(result[0].track.id).toBe('track-0');
    expect(result.every((item) => item.track._placeholder === true)).toBe(false);
  });
});
