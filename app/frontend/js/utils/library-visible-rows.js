/**
 * Row space for the virtualized library list.
 *
 * Two index spaces meet in the library view:
 *
 * - **Raw indices** are backend positions. They are what `_trackPages` arrays
 *   are laid out in, what `_pageSize` arithmetic assumes, what
 *   `library_find_offset` / `library_find_track_offset` report, and what the
 *   page cache keys address. They must stay stable.
 * - **Row indices** are what the list scrolls, renders and selects by.
 *
 * They are the same numbers until remote Plex tracks are hidden. Hiding them
 * cannot happen by filtering the page arrays in place — scroll height would go
 * on counting rows that are gone and the rows below would shift under the
 * scrollbar — so it happens here instead: a row map records, in ascending
 * order, which raw index each rendered row shows. Raw pages stay untouched,
 * so turning the filter back on restores the raw path with no refetch.
 *
 * Pure functions over a store-shaped object (`showRemote`, `totalTracks`,
 * `_sectionTracks`, `_trackPages`, `_pageSize`, `_visibleRowMap`,
 * `_visibleRowBuilding`, `_loadGeneration`, `_dataVersion`, `isRemote()`,
 * `_isPaginated()`, `_loadPageRange()`, `_loadAllPages()`) so the store, its
 * test stubs and unit tests share one implementation.
 */

/**
 * Ascending raw indices of the loaded tracks the list is allowed to show.
 *
 * Returns `null` when nothing is hidden, meaning rows address raw indices
 * directly and no mirror is needed. Measured over loaded data only: rows are
 * exact for what has been fetched, and the map grows as pages arrive.
 *
 * @param {object} store - library-store-shaped object
 * @returns {number[] | null}
 */
export function computeRowMap(store) {
  if (store.showRemote) return null;

  const isRemote = (track) => store.isRemote(track);
  const map = [];

  if (store._sectionTracks) {
    const tracks = store._sectionTracks;
    for (let i = 0; i < tracks.length; i++) {
      if (!isRemote(tracks[i])) map.push(i);
    }
    return map;
  }

  const pageSize = store._pageSize;
  const pageCount = Math.ceil(store.totalTracks / pageSize);
  for (let p = 0; p < pageCount; p++) {
    const page = store._trackPages[p];
    if (!page) continue;
    const base = p * pageSize;
    for (let i = 0; i < page.length; i++) {
      if (!isRemote(page[i])) map.push(base + i);
    }
  }
  return map;
}

/**
 * Number of rows the list should render.
 * @param {object} store
 * @returns {number}
 */
export function visibleTotalOf(store) {
  const map = store._visibleRowMap;
  return map ? map.length : store.totalTracks;
}

/**
 * Raw index rendered at `row`. Falls back to `row` for rows past the end of
 * the mirror, so callers that only use it to derive pages to prefetch stay
 * inside the raw space instead of producing NaN.
 *
 * @param {number[] | null} map
 * @param {number} row
 * @returns {number}
 */
export function rawIndexForRowIndex(map, row) {
  if (!map) return row;
  const raw = map[row];
  return raw === undefined ? row : raw;
}

/**
 * Row that shows `rawIndex`, or -1 when no row shows it — either because the
 * track is hidden by the filter or because its page has not been measured yet.
 *
 * @param {number[] | null} map
 * @param {number} rawIndex
 * @returns {number}
 */
export function rowIndexForRawIndex(map, rawIndex) {
  if (!map) return rawIndex;
  // Raw indices are recorded in ascending order, so the inverse is a binary
  // search rather than a scan of the whole library.
  let low = 0;
  let high = map.length - 1;
  while (low <= high) {
    const mid = (low + high) >>> 1;
    if (map[mid] === rawIndex) return mid;
    if (map[mid] < rawIndex) low = mid + 1;
    else high = mid - 1;
  }
  return -1;
}

/**
 * Recompute the store's row mirror from the pages in hand.
 * @param {object} store
 */
export function buildRowMap(store) {
  const map = computeRowMap(store);
  if (map === null) {
    clearRowMap(store);
    return;
  }
  store._visibleRowMap = map;
  store._dataVersion++;
}

/**
 * Drop the mirror so rows fall back to raw indices until the next
 * `buildRowMap()`. Callers that clear or replace page data must do this: raw
 * indices from a previous query would address the wrong tracks.
 *
 * @param {object} store
 */
export function clearRowMap(store) {
  store._visibleRowBuilding = null;
  if (store._visibleRowMap !== null) {
    store._visibleRowMap = null;
    store._dataVersion++;
  }
}

/**
 * Recompute the row mirror and converge the row count on the whole library.
 *
 * Scroll height and row addressing are only consistent once every row is
 * accounted for, so a filtered view has to see every page — the same
 * requirement `_loadAllPages()` already serves for select-all. Rows are
 * correct (never remote) immediately from the pages in hand, and the height
 * grows as the rest arrives rather than briefly painting the tracks that were
 * just hidden.
 *
 * Fire-and-forget: the first pass runs synchronously, so call sites that bump
 * `_dataVersion` right after get a render that is already filtered. Concurrent
 * calls share one run, which is also what keeps page arrivals inside a bulk
 * load from re-measuring the library page after page.
 *
 * @param {object} store
 * @returns {Promise<void>}
 */
export function rebuildVisibleRows(store) {
  if (store.showRemote) {
    clearRowMap(store);
    return Promise.resolve();
  }
  if (store._visibleRowBuilding) return store._visibleRowBuilding;
  const generation = store._loadGeneration;
  store._visibleRowBuilding = (async () => {
    buildRowMap(store);
    if (!store._isPaginated() || store._allPagesLoaded) return;
    try {
      await store._loadAllPages();
    } catch (error) {
      console.error('[library] filtered view page load failed:', error);
    }
    // Superseded by a toggle or a query change while pages were loading.
    if (store.showRemote || store._loadGeneration !== generation) return;
    buildRowMap(store);
  })().finally(() => {
    store._visibleRowBuilding = null;
  });
  return store._visibleRowBuilding;
}

/**
 * Load the pages covering a range of *rows* (not raw indices), then make sure
 * the mirror reflects what arrived so callers can trust row indices.
 *
 * @param {object} store
 * @param {number} startRow
 * @param {number} endRow
 * @returns {Promise<void>}
 */
export async function loadRowRange(store, startRow, endRow) {
  if (!store._isPaginated()) return;
  const last = Math.max(0, visibleTotalOf(store) - 1);
  const from = Math.min(Math.max(0, startRow), last);
  const to = Math.min(Math.max(0, endRow), last);
  await store._loadPageRange(
    rawIndexForRowIndex(store._visibleRowMap, from),
    rawIndexForRowIndex(store._visibleRowMap, to),
  );
  // Pages may have landed while a rebuild was already in flight, which
  // suppresses their own measurement; await the shared run.
  await rebuildVisibleRows(store);
}
