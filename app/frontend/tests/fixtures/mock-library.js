/**
 * Mock Library API for Playwright tests
 *
 * Provides route handlers that simulate the backend library API.
 * This enables testing library-dependent features without a running backend.
 *
 * Usage:
 *   import { createLibraryState, setupLibraryMocks } from './fixtures/mock-library.js';
 *
 *   test.beforeEach(async ({ page }) => {
 *     const state = createLibraryState();
 *     await setupLibraryMocks(page, state);
 *     await page.goto('/');
 *   });
 */

/**
 * Generate a comprehensive set of mock tracks with diverse metadata
 * for testing sorting, filtering, search, and display features.
 *
 * @param {number} count - Number of tracks to generate
 * @returns {Array} Array of mock track objects
 */
export function generateMockTracks(count = 50) {
  const artists = [
    'The Beatles',
    'Pink Floyd',
    'Led Zeppelin',
    'Queen',
    'David Bowie',
    'The Rolling Stones',
    'Fleetwood Mac',
    'Eagles',
    'Elton John',
    'Bob Dylan',
    'Los Lobos',
    'A Tribe Called Quest',
    'The Police',
    'Le Tigre',
    'La Dispute',
  ];

  const albums = [
    'Abbey Road',
    'The Dark Side of the Moon',
    'Led Zeppelin IV',
    'A Night at the Opera',
    'Heroes',
    'Sticky Fingers',
    'Rumours',
    'Hotel California',
    'Goodbye Yellow Brick Road',
    'Blood on the Tracks',
    'Kiko',
    'The Low End Theory',
    'Synchronicity',
    'Feminist Sweepstakes',
    'Wildlife',
  ];

  const titlePrefixes = ['', 'The ', 'A ', 'My ', ''];
  const titleWords = [
    'Love',
    'Song',
    'Dream',
    'Night',
    'Day',
    'Heart',
    'Soul',
    'Time',
    'Road',
    'Fire',
    'Rain',
    'Wind',
    'Star',
    'Moon',
    'Sun',
    'Blue',
    'Red',
    'Golden',
    'Silver',
    'Wild',
  ];

  const tracks = [];

  for (let i = 1; i <= count; i++) {
    const artistIndex = i % artists.length;
    const albumIndex = Math.floor(i / 3) % albums.length;
    const titlePrefix = titlePrefixes[i % titlePrefixes.length];
    const titleWord1 = titleWords[i % titleWords.length];
    const titleWord2 = titleWords[(i * 7) % titleWords.length];

    tracks.push({
      id: i,
      title: `${titlePrefix}${titleWord1} ${titleWord2}`.trim(),
      artist: artists[artistIndex],
      album: albums[albumIndex],
      album_artist: artists[albumIndex % artists.length],
      duration: 120000 + Math.floor(Math.random() * 300000), // 2-7 minutes in ms
      track_number: (i % 12) + 1,
      disc_number: Math.floor(i / 12) + 1,
      year: 1965 + (i % 40),
      genre: ['Rock', 'Pop', 'Jazz', 'Blues', 'Folk'][i % 5],
      filepath: `/music/artist-${artistIndex}/album-${albumIndex}/track-${i}.mp3`,
      filename: `track-${i}.mp3`,
      file_size: 3000000 + Math.floor(Math.random() * 7000000),
      bitrate: [128, 192, 256, 320][i % 4],
      sample_rate: 44100,
      channels: 2,
      added_date: new Date(Date.now() - i * 86400000).toISOString(),
      last_played: i % 3 === 0 ? new Date(Date.now() - i * 3600000).toISOString() : null,
      play_count: Math.floor(Math.random() * 100),
      rating: i % 5,
      favorite: i % 7 === 0,
      missing: false,
      last_seen_at: new Date().toISOString(),
    });
  }

  return tracks;
}

/**
 * Pre-generated set of mock tracks for consistent testing
 */
export const mockTracks = generateMockTracks(50);

/**
 * Create a fresh library mock state
 * @param {Object} options - Configuration options
 * @param {number} options.trackCount - Number of tracks to generate (default: 50)
 * @param {Array} options.tracks - Custom tracks array (overrides trackCount)
 * @returns {Object} Mutable state object for library
 */
export function createLibraryState(options = {}) {
  const tracks = options.tracks || generateMockTracks(options.trackCount || 50);

  return {
    tracks,
    stats: {
      total_tracks: tracks.length,
      total_duration: tracks.reduce((sum, t) => sum + (t.duration || 0), 0),
      total_size: tracks.reduce((sum, t) => sum + (t.file_size || 0), 0),
      total_artists: new Set(tracks.map((t) => t.artist)).size,
      total_albums: new Set(tracks.map((t) => t.album)).size,
    },
    // Track API calls for assertions
    apiCalls: [],
  };
}

/**
 * Calculate search relevance score for a track
 * @param {Object} track - Track object
 * @param {string} query - Search query (lowercase)
 * @returns {number} Relevance score (higher is more relevant)
 */
function calculateSearchScore(track, query) {
  const title = (track.title || '').toLowerCase();
  const artist = (track.artist || '').toLowerCase();
  const album = (track.album || '').toLowerCase();

  // Exact title match (highest priority)
  if (title === query) {
    return 100;
  }

  // Title starts with query
  if (title.startsWith(query)) {
    return 90;
  }

  // Partial title match (word boundary or contains)
  if (title.includes(query)) {
    return 80;
  }

  // Exact artist match
  if (artist === query) {
    return 70;
  }

  // Artist starts with or contains query
  if (artist.includes(query)) {
    return 60;
  }

  // Exact album match
  if (album === query) {
    return 50;
  }

  // Album starts with or contains query
  if (album.includes(query)) {
    return 40;
  }

  // No match (shouldn't happen if track passed filter)
  return 0;
}

/**
 * Filter and sort tracks based on query parameters
 * @param {Array} tracks - All tracks
 * @param {Object} params - Query parameters
 * @returns {Object} Filtered/sorted result with tracks and total
 */
function filterAndSortTracks(tracks, params) {
  let result = [...tracks];
  const hasSearch = params.search && params.search.trim().length > 0;
  const query = hasSearch ? params.search.toLowerCase() : '';

  // Search filter
  if (hasSearch) {
    result = result.filter(
      (t) =>
        t.title?.toLowerCase().includes(query) ||
        t.artist?.toLowerCase().includes(query) ||
        t.album?.toLowerCase().includes(query)
    );

    // Calculate and attach search scores for ranking
    result = result.map((track) => ({
      ...track,
      _searchScore: calculateSearchScore(track, query),
    }));

    // Sort by search score descending (most relevant first)
    result.sort((a, b) => b._searchScore - a._searchScore);

    // Remove internal score property before returning
    result = result.map(({ _searchScore, ...track }) => track);
  }

  // Artist filter
  if (params.artist) {
    result = result.filter(
      (t) => t.artist?.toLowerCase() === params.artist.toLowerCase()
    );
  }

  // Album filter
  if (params.album) {
    result = result.filter(
      (t) => t.album?.toLowerCase() === params.album.toLowerCase()
    );
  }

  // Sort (only apply if not searching - search results are already ranked)
  if (!hasSearch) {
    const sortBy = params.sort_by || params.sortBy || 'album';
    const sortOrder = params.sort_order || params.sortOrder || 'asc';
    const multiplier = sortOrder === 'desc' ? -1 : 1;

    result.sort((a, b) => {
      let aVal = a[sortBy];
      let bVal = b[sortBy];

      // Handle null/undefined
      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return 1;
      if (bVal == null) return -1;

      // String comparison
      if (typeof aVal === 'string') {
        return multiplier * aVal.localeCompare(bVal);
      }

      // Numeric comparison
      return multiplier * (aVal - bVal);
    });
  }

  // Pagination
  const offset = parseInt(params.offset) || 0;
  const limit = parseInt(params.limit) || result.length;
  const total = result.length;
  result = result.slice(offset, offset + limit);

  return {
    tracks: result,
    total,
    limit,
    offset,
  };
}

/**
 * Setup library API mocks on a Playwright page
 * @param {import('@playwright/test').Page} page - Playwright page
 * @param {Object} state - Mutable state from createLibraryState()
 */
export async function setupLibraryMocks(page, state) {
  // GET /api/library - get all tracks with optional filtering/sorting
  // Match any URL ending with /api/library (with or without query params)
  await page.route(/\/api\/library(\?.*)?$/, async (route, request) => {
    if (request.method() !== 'GET') {
      await route.continue();
      return;
    }

    const url = new URL(request.url());
    const params = Object.fromEntries(url.searchParams);
    state.apiCalls.push({ method: 'GET', url: '/api/library', params });

    const result = filterAndSortTracks(state.tracks, params);

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(result),
    });
  });

  // GET /api/library/:id - get single track
  await page.route(/\/api\/library\/(\d+)$/, async (route, request) => {
    if (request.method() !== 'GET') {
      await route.continue();
      return;
    }

    const match = request.url().match(/\/api\/library\/(\d+)$/);
    const trackId = parseInt(match[1], 10);
    state.apiCalls.push({ method: 'GET', url: `/api/library/${trackId}` });

    const track = state.tracks.find((t) => t.id === trackId);
    if (!track) {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Track not found' }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(track),
    });
  });

  // GET /api/library/stats - get library statistics
  await page.route(/\/api\/library\/stats(\?.*)?$/, async (route, request) => {
    if (request.method() !== 'GET') {
      await route.continue();
      return;
    }

    state.apiCalls.push({ method: 'GET', url: '/api/library/stats' });

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(state.stats),
    });
  });

  // GET /api/library/missing - get missing tracks
  await page.route(/\/api\/library\/missing(\?.*)?$/, async (route, request) => {
    if (request.method() !== 'GET') {
      await route.continue();
      return;
    }

    state.apiCalls.push({ method: 'GET', url: '/api/library/missing' });
    const missingTracks = state.tracks.filter((t) => t.missing);

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ tracks: missingTracks, total: missingTracks.length }),
    });
  });

  // GET /api/library/:id/artwork - get track artwork
  await page.route(/\/api\/library\/(\d+)\/artwork$/, async (route, request) => {
    if (request.method() !== 'GET') {
      await route.continue();
      return;
    }

    const match = request.url().match(/\/api\/library\/(\d+)\/artwork$/);
    const trackId = parseInt(match[1], 10);
    state.apiCalls.push({ method: 'GET', url: `/api/library/${trackId}/artwork` });

    // Return a simple placeholder artwork (1x1 transparent PNG)
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        mime_type: 'image/png',
        source: 'mock',
      }),
    });
  });

  // POST /api/library/scan - scan for new tracks
  await page.route(/\/api\/library\/scan(\?.*)?$/, async (route, request) => {
    if (request.method() !== 'POST') {
      await route.continue();
      return;
    }

    const body = request.postDataJSON();
    state.apiCalls.push({ method: 'POST', url: '/api/library/scan', body });

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        added: 0,
        skipped: 0,
        errors: 0,
        tracks: [],
      }),
    });
  });

  // DELETE /api/library/:id - delete track
  await page.route(/\/api\/library\/(\d+)$/, async (route, request) => {
    if (request.method() !== 'DELETE') {
      await route.continue();
      return;
    }

    const match = request.url().match(/\/api\/library\/(\d+)$/);
    const trackId = parseInt(match[1], 10);
    state.apiCalls.push({ method: 'DELETE', url: `/api/library/${trackId}` });

    const index = state.tracks.findIndex((t) => t.id === trackId);
    if (index !== -1) {
      state.tracks.splice(index, 1);
    }

    await route.fulfill({ status: 204 });
  });

  // PUT /api/library/:id/play-count - update play count
  await page.route(/\/api\/library\/(\d+)\/play-count$/, async (route, request) => {
    if (request.method() !== 'PUT') {
      await route.continue();
      return;
    }

    const match = request.url().match(/\/api\/library\/(\d+)\/play-count$/);
    const trackId = parseInt(match[1], 10);
    state.apiCalls.push({ method: 'PUT', url: `/api/library/${trackId}/play-count` });

    const track = state.tracks.find((t) => t.id === trackId);
    if (track) {
      track.play_count = (track.play_count || 0) + 1;
      track.last_played = new Date().toISOString();
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(track || { error: 'Track not found' }),
    });
  });

  // POST /api/library/:id/locate - locate missing track
  await page.route(/\/api\/library\/(\d+)\/locate$/, async (route, request) => {
    if (request.method() !== 'POST') {
      await route.continue();
      return;
    }

    const match = request.url().match(/\/api\/library\/(\d+)\/locate$/);
    const trackId = parseInt(match[1], 10);
    const body = request.postDataJSON();
    state.apiCalls.push({ method: 'POST', url: `/api/library/${trackId}/locate`, body });

    const track = state.tracks.find((t) => t.id === trackId);
    if (track) {
      track.filepath = body.new_path;
      track.missing = false;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(track || { error: 'Track not found' }),
    });
  });

  // POST /api/library/:id/check-status - check track status
  await page.route(/\/api\/library\/(\d+)\/check-status$/, async (route, request) => {
    if (request.method() !== 'POST') {
      await route.continue();
      return;
    }

    const match = request.url().match(/\/api\/library\/(\d+)\/check-status$/);
    const trackId = parseInt(match[1], 10);
    state.apiCalls.push({ method: 'POST', url: `/api/library/${trackId}/check-status` });

    const track = state.tracks.find((t) => t.id === trackId);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(track || { error: 'Track not found' }),
    });
  });

  // POST /api/library/:id/mark-missing - mark track as missing
  await page.route(/\/api\/library\/(\d+)\/mark-missing$/, async (route, request) => {
    if (request.method() !== 'POST') {
      await route.continue();
      return;
    }

    const match = request.url().match(/\/api\/library\/(\d+)\/mark-missing$/);
    const trackId = parseInt(match[1], 10);
    state.apiCalls.push({ method: 'POST', url: `/api/library/${trackId}/mark-missing` });

    const track = state.tracks.find((t) => t.id === trackId);
    if (track) {
      track.missing = true;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(track || { error: 'Track not found' }),
    });
  });

  // POST /api/library/:id/mark-present - mark track as present
  await page.route(/\/api\/library\/(\d+)\/mark-present$/, async (route, request) => {
    if (request.method() !== 'POST') {
      await route.continue();
      return;
    }

    const match = request.url().match(/\/api\/library\/(\d+)\/mark-present$/);
    const trackId = parseInt(match[1], 10);
    state.apiCalls.push({ method: 'POST', url: `/api/library/${trackId}/mark-present` });

    const track = state.tracks.find((t) => t.id === trackId);
    if (track) {
      track.missing = false;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(track || { error: 'Track not found' }),
    });
  });

  // PUT /api/library/:id/rescan - rescan track metadata
  await page.route(/\/api\/library\/(\d+)\/rescan$/, async (route, request) => {
    if (request.method() !== 'PUT') {
      await route.continue();
      return;
    }

    const match = request.url().match(/\/api\/library\/(\d+)\/rescan$/);
    const trackId = parseInt(match[1], 10);
    state.apiCalls.push({ method: 'PUT', url: `/api/library/${trackId}/rescan` });

    const track = state.tracks.find((t) => t.id === trackId);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(track || { error: 'Track not found' }),
    });
  });
}

/**
 * Helper to add a track to the mock state
 * @param {Object} state - State from createLibraryState()
 * @param {Object} track - Track object to add
 */
export function addTrack(state, track) {
  const newId = Math.max(...state.tracks.map((t) => t.id), 0) + 1;
  const newTrack = { id: newId, ...track };
  state.tracks.push(newTrack);
  state.stats.total_tracks = state.tracks.length;
  return newTrack;
}

/**
 * Helper to mark a track as missing
 * @param {Object} state - State from createLibraryState()
 * @param {number} trackId - Track ID to mark as missing
 */
export function markTrackMissing(state, trackId) {
  const track = state.tracks.find((t) => t.id === trackId);
  if (track) {
    track.missing = true;
  }
}

/**
 * Helper to clear API call history
 * @param {Object} state - State from createLibraryState()
 */
export function clearApiCalls(state) {
  state.apiCalls = [];
}

/**
 * Helper to find API calls matching criteria
 * @param {Object} state - State from createLibraryState()
 * @param {string} method - HTTP method
 * @param {string|RegExp} urlPattern - URL pattern to match
 * @returns {Array} Matching API calls
 */
export function findApiCalls(state, method, urlPattern) {
  return state.apiCalls.filter((call) => {
    if (call.method !== method) return false;
    if (typeof urlPattern === 'string') {
      return call.url.includes(urlPattern);
    }
    return urlPattern.test(call.url);
  });
}
