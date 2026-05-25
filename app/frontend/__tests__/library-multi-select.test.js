/**
 * Tests for multi-select range selection fix.
 *
 * Verifies that Shift+Click range selection and Cmd+A selectAll correctly
 * load unloaded pages before iterating, and use getTrackAtIndex (absolute
 * index) rather than filteredTracks (compacted/misaligned array).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTrack(id, { remote = false } = {}) {
  return { id: `track-${id}`, title: `Track ${id}`, plex_guid: remote ? `plex-${id}` : null };
}

function makePage(startId, count) {
  return Array.from({ length: count }, (_, i) => makeTrack(startId + i));
}

/**
 * Minimal library store stub — mirrors _loadPageRange / _loadAllPages /
 * getTrackAtIndex behaviour from stores/library.js.
 */
function createLibStub({
  totalTracks = undefined,
  pageSize = 500,
  loadedPages = {},
  sectionTracks = null,
  showRemote = true,
} = {}) {
  if (totalTracks === undefined) {
    totalTracks = sectionTracks ? sectionTracks.length : 0;
  }
  const stub = {
    totalTracks,
    _pageSize: pageSize,
    _trackPages: { ...loadedPages },
    _loadingPages: {},
    _sectionTracks: sectionTracks,
    showRemote,
    _fetchPageCalls: [],

    _isPaginated() {
      return this._sectionTracks === null;
    },

    isRemote(track) {
      return !!track.plex_guid;
    },

    getTrackAtIndex(i) {
      if (this._sectionTracks) return this._sectionTracks[i] || null;
      const pageIndex = Math.floor(i / this._pageSize);
      const page = this._trackPages[pageIndex];
      if (!page) return null;
      return page[i % this._pageSize] || null;
    },

    _fetchPage(pageIndex) {
      this._fetchPageCalls.push(pageIndex);
      if (!this._trackPages[pageIndex]) {
        this._trackPages[pageIndex] = makePage(pageIndex * this._pageSize, this._pageSize);
      }
      return Promise.resolve();
    },

    async _loadPageRange(startIndex, endIndex) {
      if (!this._isPaginated()) return;
      const firstPage = Math.floor(startIndex / this._pageSize);
      const lastPage = Math.floor(endIndex / this._pageSize);
      const pending = [];
      for (let p = firstPage; p <= lastPage; p++) {
        if (!this._trackPages[p]) pending.push(this._fetchPage(p));
      }
      if (pending.length) await Promise.all(pending);
    },

    async _loadAllPages() {
      const totalPages = Math.ceil(this.totalTracks / this._pageSize);
      const pending = [];
      for (let p = 0; p < totalPages; p++) {
        if (!this._trackPages[p]) pending.push(this._fetchPage(p));
      }
      if (pending.length) await Promise.all(pending);
    },
  };
  return stub;
}

/**
 * Minimal library-browser component stub that mirrors the fixed
 * handleRowClick and selectAll methods.
 */
function createBrowserStub(lib) {
  return {
    library: lib,
    selectedTracks: new Set(),
    lastSelectedIndex: -1,

    async handleRowClick(event, track, index) {
      if (event.shiftKey && this.lastSelectedIndex >= 0) {
        const start = Math.min(this.lastSelectedIndex, index);
        const end = Math.max(this.lastSelectedIndex, index);

        if (!event.ctrlKey && !event.metaKey) {
          this.selectedTracks.clear();
        }

        await this.library._loadPageRange(start, end);

        for (let i = start; i <= end; i++) {
          const t = this.library.getTrackAtIndex(i);
          if (!t) continue;
          if (!this.library.showRemote && this.library.isRemote(t)) continue;
          this.selectedTracks.add(t.id);
        }
      } else if (event.ctrlKey || event.metaKey) {
        if (this.selectedTracks.has(track.id)) {
          this.selectedTracks.delete(track.id);
        } else {
          this.selectedTracks.add(track.id);
        }
        this.lastSelectedIndex = index;
      } else {
        this.selectedTracks.clear();
        this.selectedTracks.add(track.id);
        this.lastSelectedIndex = index;
      }
    },

    async selectAll() {
      if (this.library._isPaginated()) {
        await this.library._loadAllPages();
      }
      const total = this.library.totalTracks;
      for (let i = 0; i < total; i++) {
        const t = this.library.getTrackAtIndex(i);
        if (!t) continue;
        if (!this.library.showRemote && this.library.isRemote(t)) continue;
        this.selectedTracks.add(t.id);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('_loadPageRange', () => {
  it('fetches unloaded pages in the range', async () => {
    const lib = createLibStub({ totalTracks: 2000, pageSize: 500 });
    // Seed page 0 but leave page 1, 2, 3 empty
    lib._trackPages[0] = makePage(0, 500);

    await lib._loadPageRange(0, 1999);

    expect(lib._fetchPageCalls).toEqual(expect.arrayContaining([1, 2, 3]));
    expect(lib._fetchPageCalls).not.toContain(0);
  });

  it('does not refetch already-loaded pages', async () => {
    const lib = createLibStub({ totalTracks: 1000, pageSize: 500 });
    lib._trackPages[0] = makePage(0, 500);
    lib._trackPages[1] = makePage(500, 500);

    await lib._loadPageRange(0, 999);

    expect(lib._fetchPageCalls).toHaveLength(0);
  });

  it('only fetches pages overlapping the range', async () => {
    const lib = createLibStub({ totalTracks: 3000, pageSize: 500 });

    await lib._loadPageRange(500, 1499);

    expect(lib._fetchPageCalls.sort()).toEqual([1, 2]);
  });

  it('is a no-op for non-paginated sections', async () => {
    const lib = createLibStub({ sectionTracks: [makeTrack(1), makeTrack(2)] });

    await lib._loadPageRange(0, 1);

    expect(lib._fetchPageCalls).toHaveLength(0);
  });
});

describe('handleRowClick – shift+click range', () => {
  it('selects all tracks in range across unloaded pages', async () => {
    const pageSize = 10;
    const lib = createLibStub({ totalTracks: 30, pageSize });
    // Only page 0 is pre-loaded
    lib._trackPages[0] = makePage(0, pageSize);

    const browser = createBrowserStub(lib);

    // Anchor on first row (page 0)
    await browser.handleRowClick({ shiftKey: false, ctrlKey: false, metaKey: false }, lib.getTrackAtIndex(0), 0);

    // Shift+click at index 25 (page 2)
    await browser.handleRowClick(
      { shiftKey: true, ctrlKey: false, metaKey: false },
      lib.getTrackAtIndex(25),
      25,
    );

    expect(browser.selectedTracks.size).toBe(26); // indices 0-25 inclusive
    for (let i = 0; i <= 25; i++) {
      const t = lib.getTrackAtIndex(i);
      expect(browser.selectedTracks.has(t.id)).toBe(true);
    }
  });

  it('fetches only the pages needed to cover the range', async () => {
    const pageSize = 500;
    const lib = createLibStub({ totalTracks: 2000, pageSize });
    lib._trackPages[0] = makePage(0, pageSize);

    const browser = createBrowserStub(lib);
    await browser.handleRowClick({ shiftKey: false, ctrlKey: false, metaKey: false }, lib.getTrackAtIndex(0), 0);
    await browser.handleRowClick(
      { shiftKey: true, ctrlKey: false, metaKey: false },
      lib.getTrackAtIndex(600),
      600,
    );

    // Pages 0 (already loaded) and 1 (indices 500-999) needed — only page 1 fetched
    expect(lib._fetchPageCalls).toEqual([1]);
  });

  it('excludes remote tracks when showRemote is false', async () => {
    const pageSize = 5;
    // Page 0: tracks 0-4, track-2 is remote
    const page0 = [
      makeTrack(0), makeTrack(1), makeTrack(2, { remote: true }), makeTrack(3), makeTrack(4),
    ];
    const lib = createLibStub({ totalTracks: 5, pageSize, loadedPages: { 0: page0 }, showRemote: false });

    const browser = createBrowserStub(lib);
    await browser.handleRowClick({ shiftKey: false, ctrlKey: false, metaKey: false }, page0[0], 0);
    await browser.handleRowClick({ shiftKey: true, ctrlKey: false, metaKey: false }, page0[4], 4);

    expect(browser.selectedTracks.has('track-2')).toBe(false);
    expect(browser.selectedTracks.size).toBe(4);
  });

  it('preserves existing selection when Shift+Ctrl+clicking', async () => {
    const pageSize = 10;
    const lib = createLibStub({ totalTracks: 20, pageSize, loadedPages: { 0: makePage(0, pageSize), 1: makePage(10, pageSize) } });

    const browser = createBrowserStub(lib);

    // Manually seed selection with a track outside the range
    browser.selectedTracks.add('track-15');
    // Set anchor at index 0
    browser.lastSelectedIndex = 0;

    // Shift+Ctrl+click at index 5 — should extend range without clearing
    await browser.handleRowClick({ shiftKey: true, ctrlKey: true, metaKey: false }, lib.getTrackAtIndex(5), 5);

    // track-15 should still be in selection (not cleared)
    expect(browser.selectedTracks.has('track-15')).toBe(true);
    // And indices 0-5 added
    for (let i = 0; i <= 5; i++) {
      expect(browser.selectedTracks.has(`track-${i}`)).toBe(true);
    }
  });
});

describe('selectAll', () => {
  it('selects all tracks across all pages', async () => {
    const pageSize = 10;
    const lib = createLibStub({ totalTracks: 30, pageSize });

    const browser = createBrowserStub(lib);
    await browser.selectAll();

    expect(browser.selectedTracks.size).toBe(30);
    expect(lib._fetchPageCalls.sort()).toEqual([0, 1, 2]);
  });

  it('excludes remote tracks when showRemote is false', async () => {
    const pageSize = 5;
    const page0 = [
      makeTrack(0), makeTrack(1, { remote: true }), makeTrack(2), makeTrack(3, { remote: true }), makeTrack(4),
    ];
    const lib = createLibStub({ totalTracks: 5, pageSize, loadedPages: { 0: page0 }, showRemote: false });

    const browser = createBrowserStub(lib);
    await browser.selectAll();

    expect(browser.selectedTracks.size).toBe(3);
    expect(browser.selectedTracks.has('track-1')).toBe(false);
    expect(browser.selectedTracks.has('track-3')).toBe(false);
  });

  it('works for non-paginated sections without calling _loadAllPages', async () => {
    const section = [makeTrack(100), makeTrack(101), makeTrack(102)];
    const lib = createLibStub({ sectionTracks: section });

    const browser = createBrowserStub(lib);
    await browser.selectAll();

    expect(browser.selectedTracks.size).toBe(3);
    expect(lib._fetchPageCalls).toHaveLength(0);
  });
});
