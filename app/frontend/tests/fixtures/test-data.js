/**
 * Test fixtures and mock data for E2E tests
 *
 * Provides mock tracks, playlists, and other test data
 * to support consistent testing across the test suite.
 */

/**
 * Create a mock track object with sensible defaults
 * @param {Object} overrides - Properties to override
 * @returns {Object} Mock track object
 */
export function createMockTrack(overrides = {}) {
  const defaults = {
    id: `track-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    title: 'Test Track',
    artist: 'Test Artist',
    album: 'Test Album',
    duration: 180.5,
    filename: 'test-track.mp3',
    path: '/path/to/test-track.mp3',
    added_date: new Date().toISOString(),
    play_count: 0,
    last_played: null,
    favorite: false,
  };

  return { ...defaults, ...overrides };
}

/**
 * Create multiple mock tracks
 * @param {number} count - Number of tracks to create
 * @param {Object} baseOverrides - Base properties for all tracks
 * @returns {Array} Array of mock track objects
 */
export function createMockTracks(count, baseOverrides = {}) {
  return Array.from({ length: count }, (_, i) =>
    createMockTrack({
      ...baseOverrides,
      title: `${baseOverrides.title || 'Test Track'} ${i + 1}`,
      id: `track-${i + 1}`,
    })
  );
}

/**
 * Create a mock playlist object
 * @param {Object} overrides - Properties to override
 * @returns {Object} Mock playlist object
 */
export function createMockPlaylist(overrides = {}) {
  const defaults = {
    id: `playlist-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    name: 'Test Playlist',
    tracks: [],
    created_date: new Date().toISOString(),
  };

  return { ...defaults, ...overrides };
}

/**
 * Common test tracks with diverse metadata for testing sorting, filtering
 */
export const testTracks = [
  createMockTrack({
    id: 'track-1',
    title: 'Song A',
    artist: 'Artist A',
    album: 'Album A',
    duration: 180,
    play_count: 10,
  }),
  createMockTrack({
    id: 'track-2',
    title: 'Song B',
    artist: 'Artist B',
    album: 'Album B',
    duration: 240,
    play_count: 5,
  }),
  createMockTrack({
    id: 'track-3',
    title: 'Song C',
    artist: 'Artist A',
    album: 'Album A',
    duration: 200,
    play_count: 15,
  }),
  createMockTrack({
    id: 'track-4',
    title: 'Song D',
    artist: 'Artist C',
    album: 'Album C',
    duration: 160,
    play_count: 2,
  }),
];

/**
 * Common viewport sizes for testing responsive behavior
 *
 * Standard breakpoints:
 * - 4K UHD: 3840x2160
 * - QHD: 2560x1440
 * - Desktop large: 1920x1080 (Full HD)
 * - Desktop: 1624x1057 (app minimum)
 * - Desktop small: 1366x768 (common laptop)
 */
export const viewportSizes = {
  uhd4k: { width: 3840, height: 2160 },
  qhd: { width: 2560, height: 1440 },
  desktopLarge: { width: 1920, height: 1080 },
  desktop: { width: 1624, height: 1057 },
  desktopSmall: { width: 1366, height: 768 },
};
