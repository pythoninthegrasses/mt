/**
 * Row-space surface for library-store test stubs.
 *
 * Every method delegates to the same pure helpers the real store uses
 * (`js/utils/library-visible-rows.js`), so a stub that applies this behaves
 * like `stores/library.js` for the Show remote filter instead of inventing its
 * own semantics.
 *
 * Apply it with `defineProperties` — spreading would evaluate the
 * `visibleTotal` getter at spread time instead of copying it:
 *
 *   Object.defineProperties(stub, Object.getOwnPropertyDescriptors(rowSpace));
 *
 * Stubs also need `isRemote(track)`, `getTrackAtIndex(i)`, `_isPaginated()`,
 * `_loadPageRange()`, `_loadAllPages()` and `_dataVersion`, which each stub
 * already provides or gets from its own helpers below.
 */
import {
  buildRowMap,
  clearRowMap,
  loadRowRange,
  rawIndexForRowIndex,
  rebuildVisibleRows,
  rowIndexForRawIndex,
  visibleTotalOf,
} from '../../js/utils/library-visible-rows.js';

export const rowSpace = {
  // Matches the real store's default. Stubs that exercise the filter set this
  // to false (and provide `isRemote`) before `withRowSpace` is applied.
  showRemote: true,
  _visibleRowMap: null,
  _visibleRowBuilding: null,

  get visibleTotal() {
    void this._dataVersion;
    return visibleTotalOf(this);
  },

  isFilteringRows() {
    return this._visibleRowMap !== null;
  },

  getTrackAtRowIndex(row) {
    void this._dataVersion;
    const map = this._visibleRowMap;
    if (map && (row < 0 || row >= map.length)) return null;
    return this.getTrackAtIndex(map ? map[row] : row);
  },

  rawIndexForRowIndex(row) {
    return rawIndexForRowIndex(this._visibleRowMap, row);
  },

  rowIndexForRawIndex(rawIndex) {
    return rowIndexForRawIndex(this._visibleRowMap, rawIndex);
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

  _loadRowRange(startRow, endRow) {
    return loadRowRange(this, startRow, endRow);
  },
};

/**
 * Copy the row space onto a stub, preserving the `visibleTotal` accessor.
 *
 * Row-space members are always (re)defined: a stub built by spreading another
 * row-space object would otherwise carry a frozen copy of the getter's last
 * value. Values in `overrides` (e.g. `{ showRemote: false }`) win.
 *
 * @param {object} stub
 * @param {object} [overrides]
 * @returns {object} the same stub, for chaining
 */
export function withRowSpace(stub, overrides = {}) {
  const descriptors = Object.getOwnPropertyDescriptors(rowSpace);
  for (const [key, value] of Object.entries(overrides)) {
    descriptors[key] = { value, writable: true, enumerable: true, configurable: true };
  }
  return Object.defineProperties(stub, descriptors);
}
