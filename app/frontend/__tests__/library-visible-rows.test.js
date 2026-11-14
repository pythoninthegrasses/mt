/**
 * Row space for the virtualized library list (js/utils/library-visible-rows.js).
 *
 * The library list addresses rows positionally, so hiding remote Plex tracks
 * cannot happen inside the page arrays: scroll height would keep counting rows
 * that are gone. The row map is what makes "Show remote" off render a compact
 * list without a section reload, so these tests pin both directions of the
 * raw ↔ row conversion and the points where the map is rebuilt or dropped.
 */

import { describe, expect, it } from 'vitest';
import {
  buildRowMap,
  clearRowMap,
  computeRowMap,
  loadRowRange,
  rawIndexForRowIndex,
  rebuildVisibleRows,
  rowIndexForRawIndex,
  visibleTotalOf,
} from '../js/utils/library-visible-rows.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTrack(id, { remote = false } = {}) {
  return {
    id: `track-${id}`,
    title: `Track ${id}`,
    // Matches the real store's isRemote(): a Plex source with a streaming URL.
    source: remote ? 'plex' : 'local',
    filepath: remote ? `http://plex/stream/${id}` : `/music/${id}.flac`,
  };
}

/**
 * A library-store-shaped object wired to the same helpers the real store uses.
 *
 * @param {object} options
 * @param {Array<{remote?: boolean}>} [options.pattern] - One entry per raw index
 * @param {number} [options.loadedPages] - How many leading pages are already fetched
 * @param {number} [options.pageSize]
 * @param {boolean} [options.showRemote]
 * @param {number[]} [options.fetchDelayPages] - Pages whose fetch never resolves
 */
function createStore({
  pattern = [],
  loadedPages = pattern.length,
  pageSize = 5,
  showRemote = false,
  sectionTracks = null,
  deferredPages = [],
} = {}) {
  const tracks = pattern.map((remote, i) => makeTrack(i, { remote }));
  const store = {
    showRemote,
    totalTracks: sectionTracks ? sectionTracks.length : pattern.length,
    _pageSize: pageSize,
    _sectionTracks: sectionTracks,
    _trackPages: {},
    _loadingPages: {},
    _deferred: {},
    _released: {},
    _dataVersion: 0,
    _loadGeneration: 0,
    _allPagesLoaded: false,
    _visibleRowMap: null,
    _visibleRowBuilding: null,
    fetchCalls: [],

    isRemote(track) {
      return (
        track?.source === 'plex' &&
        (track.filepath?.startsWith('http://') || track.filepath?.startsWith('https://'))
      );
    },

    _isPaginated() {
      return this._sectionTracks === null;
    },

    getTrackAtIndex(i) {
      if (this._sectionTracks) return this._sectionTracks[i] || null;
      const page = this._trackPages[Math.floor(i / this._pageSize)];
      if (!page) return null;
      return page[i % this._pageSize] || null;
    },

    _fetchPage(pageIndex) {
      if (this._trackPages[pageIndex]) return Promise.resolve();
      if (this._loadingPages[pageIndex]) return this._loadingPages[pageIndex];
      this.fetchCalls.push(pageIndex);
      const base = pageIndex * this._pageSize;
      const page = tracks.slice(base, base + this._pageSize);
      if (deferredPages.includes(pageIndex) && !this._released[pageIndex]) {
        // The test releases this page with store.resolveFetch(pageIndex), so a
        // rebuild can be observed — and superseded — while it is still in flight.
        const promise = new Promise((resolve) => {
          this._deferred[pageIndex] = () => {
            this._trackPages[pageIndex] = page;
            delete this._loadingPages[pageIndex];
            resolve();
          };
        });
        this._loadingPages[pageIndex] = promise;
        return promise;
      }
      this._trackPages[pageIndex] = page;
      return Promise.resolve();
    },

    /**
     * Release a deferred page. Safe before *or* after its fetch starts: a
     * rebuild reaches deeper pages on later microtasks, so a supersede in a
     * test naturally happens before the request is even issued.
     */
    resolveFetch(pageIndex) {
      this._released[pageIndex] = true;
      const release = this._deferred[pageIndex];
      if (release) release();
    },

    async _loadPageRange(startIndex, endIndex) {
      if (!this._isPaginated()) return;
      const firstPage = Math.floor(startIndex / this._pageSize);
      const lastPage = Math.floor(endIndex / this._pageSize);
      for (let p = firstPage; p <= lastPage; p++) await this._fetchPage(p);
    },

    async _loadAllPages() {
      const totalPages = Math.ceil(this.totalTracks / this._pageSize);
      for (let p = 0; p < totalPages; p++) await this._fetchPage(p);
      this._allPagesLoaded = true;
    },
  };
  // Wire row-space members the same way the store does, via the shared helpers.
  Object.defineProperties(
    store,
    Object.getOwnPropertyDescriptors({
      get visibleTotal() {
        return visibleTotalOf(this);
      },
      isFilteringRows() {
        return this._visibleRowMap !== null;
      },
      getTrackAtRowIndex(row) {
        const map = this._visibleRowMap;
        if (map && (row < 0 || row >= map.length)) return null;
        return this.getTrackAtIndex(map ? map[row] : row);
      },
      rawIndexForRowIndex(row) {
        return rawIndexForRowIndex(this._visibleRowMap, row);
      },
      rowIndexForRawIndex(raw) {
        return rowIndexForRawIndex(this._visibleRowMap, raw);
      },
      _buildRowMap() {
        buildRowMap(this);
      },
      _clearRowMap() {
        clearRowMap(this);
      },
      _rebuildVisibleRows() {
        return rebuildVisibleRows(this);
      },
      _loadRowRange(from, to) {
        return loadRowRange(this, from, to);
      },
    }),
  );

  const loaded = Math.min(loadedPages, Math.ceil(pattern.length / pageSize));
  for (let p = 0; p < loaded; p++) {
    store._trackPages[p] = tracks.slice(p * pageSize, (p + 1) * pageSize);
  }
  if (loaded >= Math.ceil(pattern.length / pageSize)) store._allPagesLoaded = true;
  return store;
}

const noRemote = [false, false, false, false, false, false, false, false, false, false];
const interleaved = [true, false, true, false, false, true, false, false, true, false];

// ---------------------------------------------------------------------------
// computeRowMap
// ---------------------------------------------------------------------------

describe('computeRowMap', () => {
  it('is null while remote tracks are shown, so rows stay raw indices', () => {
    const store = createStore({ pattern: interleaved, showRemote: true });
    expect(computeRowMap(store)).toBeNull();
    expect(store.visibleTotal).toBe(10);
    expect(store.getTrackAtRowIndex(0).id).toBe('track-0');
  });

  it('records ascending raw indices of non-remote tracks across pages', () => {
    const store = createStore({ pattern: interleaved, pageSize: 5 });
    expect(computeRowMap(store)).toEqual([1, 3, 4, 6, 7, 9]);
  });

  it('measures loaded pages only, so a partial fetch never shows hidden tracks', () => {
    // Only page 0 (raw 0-4) is in hand; rows must not claim the rest yet.
    const store = createStore({ pattern: interleaved, pageSize: 5, loadedPages: 1 });
    expect(computeRowMap(store)).toEqual([1, 3, 4]);
    store._buildRowMap();
    expect(store.visibleTotal).toBe(3);
  });

  it('filters the flat _sectionTracks array by position', () => {
    const tracks = [
      makeTrack(0),
      makeTrack(1, { remote: true }),
      makeTrack(2),
    ];
    const store = createStore({ sectionTracks: tracks, pattern: [] });
    expect(computeRowMap(store)).toEqual([0, 2]);
  });

  it('is an empty map, not null, when every track is remote', () => {
    const store = createStore({ pattern: [true, true, true], pageSize: 5 });
    const map = computeRowMap(store);
    expect(map).toEqual([]);
    // Distinguishing "nothing to show" from "no filtering" matters: null would
    // fall back to the raw count and re-show the hidden tracks.
    store._visibleRowMap = map;
    expect(store.visibleTotal).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Row ↔ raw conversion
// ---------------------------------------------------------------------------

describe('row ↔ raw conversion', () => {
  const map = [1, 3, 4, 6, 7, 9];

  it('is the identity with no map', () => {
    expect(rawIndexForRowIndex(null, 7)).toBe(7);
    expect(rowIndexForRawIndex(null, 7)).toBe(7);
  });

  it('maps rows to their raw index', () => {
    expect(rawIndexForRowIndex(map, 0)).toBe(1);
    expect(rawIndexForRowIndex(map, 3)).toBe(6);
    expect(rawIndexForRowIndex(map, 5)).toBe(9);
  });

  it('falls back to the row number past the map, keeping page math in range', () => {
    // Callers use this only to derive pages to prefetch; NaN would page-fetch
    // forever, and out-of-range raw indices are simply empty pages.
    expect(rawIndexForRowIndex(map, 99)).toBe(99);
  });

  it('finds the row of a visible raw index by binary search', () => {
    for (let row = 0; row < map.length; row++) {
      expect(rowIndexForRawIndex(map, map[row])).toBe(row);
    }
  });

  it('reports -1 for a raw index no row shows', () => {
    expect(rowIndexForRawIndex(map, 0)).toBe(-1); // hidden (remote)
    expect(rowIndexForRawIndex(map, 8)).toBe(-1); // hidden (remote)
    expect(rowIndexForRawIndex(map, 100)).toBe(-1); // past the end
  });
});

// ---------------------------------------------------------------------------
// buildRowMap / clearRowMap
// ---------------------------------------------------------------------------

describe('buildRowMap / clearRowMap', () => {
  it('bumps _dataVersion so Alpine re-renders', () => {
    const store = createStore({ pattern: interleaved });
    const before = store._dataVersion;
    store._buildRowMap();
    expect(store._visibleRowMap).toEqual([1, 3, 4, 6, 7, 9]);
    expect(store._dataVersion).toBe(before + 1);
  });

  it('clearing is a no-op when there is no map, so the raw path stays free', () => {
    const store = createStore({ pattern: noRemote, showRemote: true });
    const before = store._dataVersion;
    store._clearRowMap();
    expect(store._visibleRowMap).toBeNull();
    expect(store._dataVersion).toBe(before);
  });

  it('restores raw addressing when the map is cleared', () => {
    const store = createStore({ pattern: interleaved });
    store._buildRowMap();
    expect(store.visibleTotal).toBe(6);
    store._clearRowMap();
    expect(store.visibleTotal).toBe(10);
    expect(store.getTrackAtRowIndex(0).id).toBe('track-0');
  });

  it('buildRowMap while showing remote tracks drops the map', () => {
    const store = createStore({ pattern: interleaved });
    store._buildRowMap();
    store.showRemote = true;
    store._buildRowMap();
    expect(store._visibleRowMap).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// rebuildVisibleRows — convergence on the whole library
// ---------------------------------------------------------------------------

describe('rebuildVisibleRows', () => {
  it('converges the row count on every page, not just the loaded ones', async () => {
    const store = createStore({ pattern: interleaved, pageSize: 5, loadedPages: 1 });
    store._buildRowMap();
    expect(store.visibleTotal).toBe(3); // page 0 only

    await store._rebuildVisibleRows();

    expect(store.visibleTotal).toBe(6);
    expect(store.fetchCalls.sort()).toEqual([1]);
    expect(store._allPagesLoaded).toBe(true);
  });

  it('paints filtered rows synchronously, before the remaining pages land', () => {
    const store = createStore({ pattern: interleaved, pageSize: 5, loadedPages: 1 });
    // Fire-and-forget: the first pass has already measured page 0 by the time
    // the caller bumps _dataVersion and Alpine renders.
    store._rebuildVisibleRows();
    expect(store._visibleRowMap).toEqual([1, 3, 4]);
    expect(store.getTrackAtRowIndex(0).id).toBe('track-1');
    expect(store.getTrackAtRowIndex(0).source).not.toBe('plex');
  });

  it('never returns a hidden track, even at a row past the map', () => {
    const store = createStore({ pattern: interleaved, pageSize: 5, loadedPages: 1 });
    store._buildRowMap();
    expect(store.getTrackAtRowIndex(3)).toBeNull();
    expect(store.getTrackAtRowIndex(-1)).toBeNull();
  });

  it('shares one run across concurrent callers', async () => {
    const store = createStore({ pattern: interleaved, pageSize: 5, loadedPages: 1 });
    const first = store._rebuildVisibleRows();
    const second = store._rebuildVisibleRows();
    await Promise.all([first, second]);
    expect(store.fetchCalls).toEqual([1]);
  });

  it('does nothing when remote tracks are shown', async () => {
    const store = createStore({ pattern: interleaved, showRemote: true, loadedPages: 1 });
    await store._rebuildVisibleRows();
    expect(store._visibleRowMap).toBeNull();
    expect(store.fetchCalls).toEqual([]);
  });

  it('skips page loading for non-paginated sections', async () => {
    const tracks = [makeTrack(0), makeTrack(1, { remote: true })];
    const store = createStore({ sectionTracks: tracks, pattern: [] });
    await store._rebuildVisibleRows();
    expect(store.visibleTotal).toBe(1);
    expect(store.fetchCalls).toEqual([]);
  });

  it('discards a measurement superseded by a query change mid-flight', async () => {
    const store = createStore({
      pattern: interleaved,
      pageSize: 5,
      loadedPages: 1,
      deferredPages: [1],
    });
    const pending = store._rebuildVisibleRows();
    expect(store._visibleRowMap).toEqual([1, 3, 4]);

    // A section switch, mirroring _resetPages(): raw indices from the old
    // query no longer mean anything.
    store._loadGeneration++;
    store._trackPages = {};
    store._loadingPages = {};
    store._allPagesLoaded = false;
    store._sectionTracks = null;
    store._clearRowMap();
    store.resolveFetch(1);
    await pending;

    expect(store._visibleRowMap).toBeNull();
    // The abandoned run must not resurrect the stale map.
    await Promise.resolve();
    expect(store._visibleRowMap).toBeNull();
  });

  it('discards a measurement superseded by toggling Show remote back on', async () => {
    const store = createStore({
      pattern: interleaved,
      pageSize: 5,
      loadedPages: 1,
      deferredPages: [1],
    });
    const pending = store._rebuildVisibleRows();
    expect(store._visibleRowMap).toEqual([1, 3, 4]);

    // The toggle's own path (setShowRemote → _rebuildVisibleRows), which clears
    // the mirror because nothing is hidden any more.
    store.showRemote = true;
    store._rebuildVisibleRows();
    store.resolveFetch(1);
    await pending;

    expect(store._visibleRowMap).toBeNull();
    expect(store.visibleTotal).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// loadRowRange
// ---------------------------------------------------------------------------

describe('loadRowRange', () => {
  it('loads the pages covering a row range by translating to raw indices', async () => {
    // Rows 2..3 are raw 4..6 → pages 0 and 1; page 1 is the only fetch.
    const store = createStore({ pattern: interleaved, pageSize: 5, loadedPages: 1 });
    await store._loadRowRange(2, 3);
    expect(store.fetchCalls).toEqual([1]);
  });

  it('clamps to the rows that exist instead of walking into raw space', async () => {
    // Every page is in hand, so the only way this can fetch anything is the
    // end row being used as a raw index: row 999 would ask for page 199.
    const store = createStore({ pattern: interleaved, pageSize: 5, loadedPages: 2 });
    store._buildRowMap(); // rows 0..5 → raw 1,3,4,6,7,9
    expect(store.visibleTotal).toBe(6);

    await store._loadRowRange(0, 999);

    expect(store.fetchCalls).toEqual([]);
  });

  it('is a no-op for non-paginated sections', async () => {
    const store = createStore({ sectionTracks: [makeTrack(0)], pattern: [] });
    await store._loadRowRange(0, 5);
    expect(store.fetchCalls).toEqual([]);
  });

  it('leaves callers with trustworthy rows once it resolves', async () => {
    const store = createStore({ pattern: interleaved, pageSize: 5, loadedPages: 1 });
    await store._loadRowRange(0, 5);
    expect(store.visibleTotal).toBe(6);
    expect(store.getTrackAtRowIndex(5).id).toBe('track-9');
  });
});

// ---------------------------------------------------------------------------
// Invariants the consumers depend on
// ---------------------------------------------------------------------------

describe('invariants', () => {
  it('row count times row height is the scroll height consumers render', async () => {
    const store = createStore({ pattern: interleaved, pageSize: 5 });
    await store._rebuildVisibleRows();
    const rowHeight = 34;
    expect(store.visibleTotal * rowHeight).toBe(6 * rowHeight);
  });

  it('visible rows are exactly the local tracks, in raw order', async () => {
    const pattern = [false, true, false, true, true, false, false, true];
    const store = createStore({ pattern, pageSize: 3 });
    await store._rebuildVisibleRows();

    const expected = pattern
      .map((remote, raw) => (remote ? null : raw))
      .filter((raw) => raw !== null);

    const rows = [];
    for (let row = 0; row < store.visibleTotal; row++) {
      const track = store.getTrackAtRowIndex(row);
      expect(track).not.toBeNull();
      expect(store.isRemote(track)).toBe(false);
      rows.push(store.rawIndexForRowIndex(row));
    }
    expect(rows).toEqual(expected);
  });

  it('is a zero-cost identity with remote tracks shown: no map, no fetches', async () => {
    const store = createStore({ pattern: interleaved, showRemote: true, loadedPages: 1 });
    await store._rebuildVisibleRows();
    expect(store._visibleRowMap).toBeNull();
    expect(store.isFilteringRows()).toBe(false);
    expect(store.visibleTotal).toBe(store.totalTracks);
    for (let i = 0; i < store.totalTracks; i++) {
      expect(store.rawIndexForRowIndex(i)).toBe(i);
      expect(store.rowIndexForRawIndex(i)).toBe(i);
    }
  });
});
