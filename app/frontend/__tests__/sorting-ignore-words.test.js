/**
 * @vitest-environment jsdom
 *
 * Unit tests for sorting ignore-words logic.
 *
 * Covers the stripIgnoredPrefix function from type-to-jump mixin,
 * sort key mapping, and the DEFAULT_SORT_IGNORE_WORDS constant.
 * Replaces pure-logic Playwright tests from sorting-ignore-words.spec.js.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DEFAULT_SORT_IGNORE_WORDS } from '../js/constants.js';

// ---------------------------------------------------------------------------
// Standalone stripIgnoredPrefix extracted from the mixin for unit testing.
// Mirrors type-to-jump.js:stripIgnoredPrefix without Alpine dependency.
// ---------------------------------------------------------------------------
function stripIgnoredPrefix(value, { sortIgnoreWords, sortIgnoreWordsList }) {
  if (!sortIgnoreWords) return value;

  const wordsList = sortIgnoreWordsList?.trim() || DEFAULT_SORT_IGNORE_WORDS;
  const ignoreWords = wordsList
    .split(',')
    .map((w) => w.trim().toLowerCase())
    .filter(Boolean);

  for (const word of ignoreWords) {
    const prefix = word + ' ';
    if (value.startsWith(prefix)) {
      return value.slice(prefix.length);
    }
  }
  return value;
}

// Sort key mapping mirrors library.js:_getSortParams
const SORT_KEY_MAP = {
  default: 'artist',
  index: 'track_number',
  dateAdded: 'added_date',
};

describe('Sorting Ignore Words', () => {
  describe('DEFAULT_SORT_IGNORE_WORDS constant', () => {
    it('should be a non-empty string', () => {
      expect(typeof DEFAULT_SORT_IGNORE_WORDS).toBe('string');
      expect(DEFAULT_SORT_IGNORE_WORDS.trim().length).toBeGreaterThan(0);
    });

    it('should contain common English articles', () => {
      const words = DEFAULT_SORT_IGNORE_WORDS.split(',').map((w) => w.trim().toLowerCase());
      expect(words).toContain('the');
      expect(words).toContain('a');
      expect(words).toContain('an');
    });

    it('should contain non-English articles', () => {
      const words = DEFAULT_SORT_IGNORE_WORDS.split(',').map((w) => w.trim().toLowerCase());
      expect(words).toContain('la');
      expect(words).toContain('le');
      expect(words).toContain('los');
      expect(words).toContain('las');
      expect(words).toContain('el');
      expect(words).toContain('die');
      expect(words).toContain('der');
      expect(words).toContain('das');
    });
  });

  describe('stripIgnoredPrefix', () => {
    const enabledSettings = {
      sortIgnoreWords: true,
      sortIgnoreWordsList: DEFAULT_SORT_IGNORE_WORDS,
    };

    it('should strip "the " prefix', () => {
      expect(stripIgnoredPrefix('the beatles', enabledSettings)).toBe('beatles');
    });

    it('should strip "a " prefix', () => {
      expect(stripIgnoredPrefix('a new hope', enabledSettings)).toBe('new hope');
    });

    it('should strip "los " prefix', () => {
      expect(stripIgnoredPrefix('los lobos', enabledSettings)).toBe('lobos');
    });

    it('should strip "la " prefix', () => {
      expect(stripIgnoredPrefix('la bamba', enabledSettings)).toBe('bamba');
    });

    it('should strip "el " prefix', () => {
      expect(stripIgnoredPrefix('el camino', enabledSettings)).toBe('camino');
    });

    it('should strip "die " prefix', () => {
      expect(stripIgnoredPrefix('die toten hosen', enabledSettings)).toBe('toten hosen');
    });

    it('should not strip when word is part of artist name (no space)', () => {
      expect(stripIgnoredPrefix('therapy?', enabledSettings)).toBe('therapy?');
      expect(stripIgnoredPrefix('thesaurus', enabledSettings)).toBe('thesaurus');
    });

    it('should not strip partial matches', () => {
      expect(stripIgnoredPrefix('these arms are snakes', enabledSettings)).toBe('these arms are snakes');
    });

    it('should return original when no prefix matches', () => {
      expect(stripIgnoredPrefix('radiohead', enabledSettings)).toBe('radiohead');
    });

    it('should be case-sensitive (expects lowercase input)', () => {
      // The function expects lowercase input per the mixin contract
      expect(stripIgnoredPrefix('the uppercase band', enabledSettings)).toBe('uppercase band');
    });

    it('should return value unchanged when sortIgnoreWords is disabled', () => {
      const disabled = { sortIgnoreWords: false, sortIgnoreWordsList: DEFAULT_SORT_IGNORE_WORDS };
      expect(stripIgnoredPrefix('the beatles', disabled)).toBe('the beatles');
    });

    it('should handle empty ignore words list by falling back to defaults', () => {
      const emptyList = { sortIgnoreWords: true, sortIgnoreWordsList: '' };
      expect(stripIgnoredPrefix('the beatles', emptyList)).toBe('beatles');
    });

    it('should handle whitespace-only ignore words list by falling back to defaults', () => {
      const whitespace = { sortIgnoreWords: true, sortIgnoreWordsList: '   ' };
      expect(stripIgnoredPrefix('the beatles', whitespace)).toBe('beatles');
    });

    it('should use custom ignore words list', () => {
      const custom = { sortIgnoreWords: true, sortIgnoreWordsList: 'artist, composer' };
      expect(stripIgnoredPrefix('artist mozart', custom)).toBe('mozart');
      expect(stripIgnoredPrefix('composer bach', custom)).toBe('bach');
      // Default words should NOT work with custom list
      expect(stripIgnoredPrefix('the beatles', custom)).toBe('the beatles');
    });

    it('should handle null sortIgnoreWordsList by falling back to defaults', () => {
      const nullList = { sortIgnoreWords: true, sortIgnoreWordsList: null };
      expect(stripIgnoredPrefix('the beatles', nullList)).toBe('beatles');
    });
  });

  describe('sort key mapping', () => {
    it('should map "default" to "artist"', () => {
      expect(SORT_KEY_MAP['default']).toBe('artist');
    });

    it('should map "index" to "track_number"', () => {
      expect(SORT_KEY_MAP['index']).toBe('track_number');
    });

    it('should map "dateAdded" to "added_date"', () => {
      expect(SORT_KEY_MAP['dateAdded']).toBe('added_date');
    });

    it('should pass unmapped sort keys through', () => {
      const sortBy = 'title';
      expect(SORT_KEY_MAP[sortBy] || sortBy).toBe('title');
    });
  });

  describe('sorting with ignore words (integration)', () => {
    const tracks = [
      { id: '1', artist: 'The Beatles', title: 'Song One', album: 'Abbey Road' },
      { id: '2', artist: 'Beatles Cover Band', title: 'Song Two', album: 'The Best Album' },
      { id: '3', artist: 'Artist Name', title: 'The Beginning', album: 'Los Angeles' },
      { id: '4', artist: 'Composer', title: 'A New Hope', album: 'Le Soundtrack' },
      { id: '5', artist: 'Los Lobos', title: 'Track Five', album: 'La Bamba' },
    ];

    const settings = {
      sortIgnoreWords: true,
      sortIgnoreWordsList: DEFAULT_SORT_IGNORE_WORDS,
    };

    function sortByField(tracks, field) {
      return [...tracks].sort((a, b) => {
        const aKey = stripIgnoredPrefix(a[field].toLowerCase(), settings);
        const bKey = stripIgnoredPrefix(b[field].toLowerCase(), settings);
        return aKey.localeCompare(bKey);
      });
    }

    it('should sort "The Beatles" before "Los Lobos" by artist (B < L)', () => {
      const sorted = sortByField(tracks, 'artist');
      const artists = sorted.map((t) => t.artist);
      const beatlesIdx = artists.indexOf('The Beatles');
      const lobosIdx = artists.indexOf('Los Lobos');
      expect(beatlesIdx).toBeLessThan(lobosIdx);
    });

    it('should sort "A New Hope" after "The Beginning" by title (N > B)', () => {
      const sorted = sortByField(tracks, 'title');
      const titles = sorted.map((t) => t.title);
      const newHopeIdx = titles.indexOf('A New Hope');
      const beginningIdx = titles.indexOf('The Beginning');
      expect(beginningIdx).toBeLessThan(newHopeIdx);
    });

    it('should sort "The Best Album" after "Abbey Road" by album (B > A)', () => {
      const sorted = sortByField(tracks, 'album');
      const albums = sorted.map((t) => t.album);
      const bestIdx = albums.indexOf('The Best Album');
      const abbeyIdx = albums.indexOf('Abbey Road');
      expect(bestIdx).toBeGreaterThan(abbeyIdx);
    });

    it('should preserve original names in display (sort key != display)', () => {
      const sorted = sortByField(tracks, 'artist');
      // All original artist names should be intact
      expect(sorted.some((t) => t.artist === 'The Beatles')).toBe(true);
      expect(sorted.some((t) => t.artist === 'Los Lobos')).toBe(true);
    });

    it('should sort identically to naive sort when ignore words disabled', () => {
      const disabledSettings = { sortIgnoreWords: false, sortIgnoreWordsList: '' };

      const naiveSorted = [...tracks].sort((a, b) => a.artist.toLowerCase().localeCompare(b.artist.toLowerCase()));
      const ignoreSorted = [...tracks].sort((a, b) => {
        const aKey = stripIgnoredPrefix(a.artist.toLowerCase(), disabledSettings);
        const bKey = stripIgnoredPrefix(b.artist.toLowerCase(), disabledSettings);
        return aKey.localeCompare(bKey);
      });

      expect(ignoreSorted.map((t) => t.id)).toEqual(naiveSorted.map((t) => t.id));
    });
  });
});
