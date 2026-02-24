/**
 * Shared constants for the application
 */

/** Default list of words to ignore when sorting (articles in various languages) */
export const DEFAULT_SORT_IGNORE_WORDS =
  'the, a, an, la, le, les, los, las, el, die, der, das, il, lo, gli, ...';

/** Default column widths in pixels (all columns have explicit widths for grid layout) */
export const DEFAULT_COLUMN_WIDTHS = {
  status: 24, // Left gutter for status/drag handle
  index: 48,
  title: 320,
  artist: 431,
  album: 411,
  year: 70,
  genre: 120,
  trackTotal: 60,
  discNumber: 60,
  lastPlayed: 120,
  dateAdded: 120,
  playCount: 83,
  duration: 52,
};

/** Only Title and Time enforce minimum widths */
export const MIN_OTHER_COLUMN_WIDTH = 1;
export const MIN_TITLE_WIDTH = 120;
export const MIN_DURATION_WIDTH = 52;

export const DEFAULT_COLUMN_VISIBILITY = {
  status: true,
  index: true,
  title: true,
  artist: true,
  album: true,
  year: true,
  genre: false,
  trackTotal: false,
  discNumber: false,
  lastPlayed: true,
  dateAdded: true,
  playCount: true,
  duration: true,
};

export const DEFAULT_COLUMN_ORDER = [
  'status',
  'index',
  'title',
  'artist',
  'album',
  'year',
  'duration',
  'lastPlayed',
  'dateAdded',
  'playCount',
  'genre',
  'trackTotal',
  'discNumber',
];
