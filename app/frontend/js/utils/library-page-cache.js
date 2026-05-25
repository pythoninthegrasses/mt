/**
 * LibraryPageCache — per-query LRU cache for paginated track pages.
 *
 * Owned by the library store. Survives `_resetPages()` so that returning to
 * a previously-viewed `(section, search, sort)` query re-uses already-fetched
 * pages instantly instead of re-hitting the backend.
 *
 * Eviction policy: LRU at the whole-bucket level. When the total page count
 * across all buckets exceeds `maxPages`, the least-recently-accessed bucket
 * is removed in full. Bucket-level (not page-level) LRU matches the way
 * users interact with the library: switching back to a previous query
 * generally needs all of its pages, not a random subset.
 *
 * Memory bound at maxPages=60 with pageSize=1500 and ~600B/track is ~54MB.
 *
 * Not persisted to disk — session-only.
 */

const DEFAULT_MAX_PAGES = 60;

export class LibraryPageCache {
  constructor({ maxPages = DEFAULT_MAX_PAGES } = {}) {
    this._maxPages = maxPages;
    // Map preserves insertion order; we treat last-inserted as most-recent.
    // On every save/restore hit, the bucket is re-inserted at the end.
    this._buckets = new Map();
  }

  /**
   * Compute a stable string key for a query.
   * Null/empty search collapse to the same key.
   */
  queryKey({ section, search, sortBy, sortOrder, ignoreWords } = {}) {
    const s = search == null ? '' : String(search);
    const iw = Array.isArray(ignoreWords) ? ignoreWords.join('|') : (ignoreWords || '');
    return `${section || ''}::${s}::${sortBy || ''}::${sortOrder || ''}::${iw}`;
  }

  /**
   * Save the given pages map under `key`. Replaces any existing bucket
   * for that key. Empty maps are not stored. Triggers LRU eviction if
   * total pages exceed `maxPages`.
   */
  save(key, pages) {
    if (!pages || Object.keys(pages).length === 0) {
      // No-op for empty pages; also do not clobber an existing bucket with empty data.
      return;
    }
    // Re-insert at end (most-recent)
    if (this._buckets.has(key)) this._buckets.delete(key);
    this._buckets.set(key, { ...pages });
    this._enforceCap();
  }

  /**
   * Look up pages for `key`. Returns a shallow clone of the stored
   * page map, or null on miss. Inner arrays are shared (not deep-cloned).
   * On hit, promotes the bucket to most-recent.
   */
  restore(key) {
    if (!this._buckets.has(key)) return null;
    const bucket = this._buckets.get(key);
    // Promote to most-recent
    this._buckets.delete(key);
    this._buckets.set(key, bucket);
    return { ...bucket };
  }

  /**
   * Remove all buckets.
   */
  clear() {
    this._buckets.clear();
  }

  /**
   * Total page count across all buckets.
   */
  size() {
    let total = 0;
    for (const bucket of this._buckets.values()) {
      total += Object.keys(bucket).length;
    }
    return total;
  }

  /**
   * Bucket keys in LRU order (oldest first, newest last).
   */
  bucketKeys() {
    return Array.from(this._buckets.keys());
  }

  _enforceCap() {
    // Iterate insertion order (oldest first) and drop buckets until size <= cap.
    // A single bucket larger than the cap is kept intact — better to have one
    // oversized bucket than nothing at all.
    while (this.size() > this._maxPages && this._buckets.size > 1) {
      const oldest = this._buckets.keys().next().value;
      this._buckets.delete(oldest);
    }
  }
}
