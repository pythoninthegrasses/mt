/**
 * Unit tests for LibraryPageCache.
 *
 * Per-query LRU cache for paginated track pages. Survives _resetPages() so
 * that returning to a previously-viewed (section, search, sort) query re-uses
 * already-fetched pages instantly without re-hitting the backend.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { LibraryPageCache } from '../js/utils/library-page-cache.js';

function track(id) {
  return { id, title: `t${id}` };
}

function page(...ids) {
  return ids.map(track);
}

describe('LibraryPageCache.queryKey', () => {
  it('returns stable string for fixed query components', () => {
    const c = new LibraryPageCache();
    const k1 = c.queryKey({
      section: 'all',
      search: 'foo',
      sortBy: 'artist',
      sortOrder: 'asc',
      ignoreWords: ['the', 'a'],
    });
    const k2 = c.queryKey({
      section: 'all',
      search: 'foo',
      sortBy: 'artist',
      sortOrder: 'asc',
      ignoreWords: ['the', 'a'],
    });
    expect(k1).toBe(k2);
  });

  it('differs when any component changes', () => {
    const c = new LibraryPageCache();
    const base = {
      section: 'all',
      search: '',
      sortBy: 'artist',
      sortOrder: 'asc',
      ignoreWords: null,
    };
    const k0 = c.queryKey(base);
    expect(c.queryKey({ ...base, section: 'liked' })).not.toBe(k0);
    expect(c.queryKey({ ...base, search: 'x' })).not.toBe(k0);
    expect(c.queryKey({ ...base, sortBy: 'title' })).not.toBe(k0);
    expect(c.queryKey({ ...base, sortOrder: 'desc' })).not.toBe(k0);
    expect(c.queryKey({ ...base, ignoreWords: ['the'] })).not.toBe(k0);
  });

  it('treats null and empty search equivalently', () => {
    const c = new LibraryPageCache();
    const base = { section: 'all', sortBy: 'artist', sortOrder: 'asc', ignoreWords: null };
    expect(c.queryKey({ ...base, search: null })).toBe(c.queryKey({ ...base, search: '' }));
  });
});

describe('LibraryPageCache.save / restore', () => {
  let cache;
  beforeEach(() => {
    cache = new LibraryPageCache({ maxPages: 60 });
  });

  it('stores pages under the given key', () => {
    cache.save('k1', { 0: page(1, 2), 5: page(50, 51) });
    expect(cache.size()).toBe(2);
    expect(cache.bucketKeys()).toEqual(['k1']);
  });

  it('restore returns null on miss', () => {
    expect(cache.restore('missing')).toBeNull();
  });

  it('restore returns the stored pages on hit', () => {
    const pages = { 0: page(1), 3: page(30) };
    cache.save('k1', pages);
    const got = cache.restore('k1');
    expect(got).toEqual(pages);
  });

  it('restore returns a shallow clone, not the stored reference', () => {
    const pages = { 0: page(1) };
    cache.save('k1', pages);
    const got = cache.restore('k1');
    expect(got).not.toBe(pages);
    // But inner arrays are shared (we don't deep-clone for perf)
    expect(got[0]).toBe(pages[0]);
  });

  it('save with empty pages is a no-op', () => {
    cache.save('k1', {});
    expect(cache.size()).toBe(0);
    expect(cache.bucketKeys()).toEqual([]);
  });

  it('save replaces the bucket for an existing key', () => {
    cache.save('k1', { 0: page(1) });
    cache.save('k1', { 5: page(50) });
    const got = cache.restore('k1');
    expect(got).toEqual({ 5: page(50) });
  });
});

describe('LibraryPageCache LRU eviction', () => {
  it('evicts least-recent bucket when totalPages exceeds cap', () => {
    const cache = new LibraryPageCache({ maxPages: 5 });
    cache.save('a', { 0: page(1), 1: page(2), 2: page(3) }); // 3 pages
    cache.save('b', { 0: page(10), 1: page(11) }); // 2 pages, total=5
    cache.save('c', { 0: page(100) }); // 1 page, total=6 -> evict 'a' (oldest)
    expect(cache.restore('a')).toBeNull();
    expect(cache.restore('b')).not.toBeNull();
    expect(cache.restore('c')).not.toBeNull();
  });

  it('restore promotes a bucket to most-recent', () => {
    const cache = new LibraryPageCache({ maxPages: 5 });
    cache.save('a', { 0: page(1), 1: page(2) }); // 2 pages
    cache.save('b', { 0: page(10), 1: page(11) }); // 2 pages
    cache.restore('a'); // 'a' now most-recent
    cache.save('c', { 0: page(100), 1: page(101) }); // 2 pages, total=6 -> evict 'b'
    expect(cache.restore('b')).toBeNull();
    expect(cache.restore('a')).not.toBeNull();
    expect(cache.restore('c')).not.toBeNull();
  });

  it('evicts multiple buckets if one save overshoots cap by a lot', () => {
    const cache = new LibraryPageCache({ maxPages: 5 });
    cache.save('a', { 0: page(1) });
    cache.save('b', { 0: page(2) });
    cache.save('c', { 0: page(3) });
    cache.save('big', { 0: page(0), 1: page(1), 2: page(2), 3: page(3), 4: page(4) }); // 5 pages alone hits cap
    expect(cache.restore('a')).toBeNull();
    expect(cache.restore('b')).toBeNull();
    expect(cache.restore('c')).toBeNull();
    expect(cache.restore('big')).not.toBeNull();
  });

  it('a single bucket larger than cap is still stored (no self-eviction)', () => {
    const cache = new LibraryPageCache({ maxPages: 3 });
    const pages = { 0: page(1), 1: page(2), 2: page(3), 3: page(4), 4: page(5) };
    cache.save('huge', pages);
    expect(cache.restore('huge')).toEqual(pages);
  });
});

describe('LibraryPageCache.clear', () => {
  it('removes all buckets', () => {
    const cache = new LibraryPageCache({ maxPages: 60 });
    cache.save('a', { 0: page(1) });
    cache.save('b', { 0: page(2) });
    cache.clear();
    expect(cache.size()).toBe(0);
    expect(cache.bucketKeys()).toEqual([]);
    expect(cache.restore('a')).toBeNull();
  });
});

describe('LibraryPageCache.size', () => {
  it('counts total pages across all buckets', () => {
    const cache = new LibraryPageCache({ maxPages: 60 });
    expect(cache.size()).toBe(0);
    cache.save('a', { 0: page(1), 1: page(2) });
    expect(cache.size()).toBe(2);
    cache.save('b', { 0: page(10), 5: page(50), 9: page(90) });
    expect(cache.size()).toBe(5);
  });
});
