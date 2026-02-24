/**
 * Library Section Cache — pure utility functions for managing
 * section summary caches (totalTracks, totalDuration, timestamp).
 *
 * Extracted from library.js to reduce cognitive complexity.
 * Cache entries never store track arrays — only summary statistics.
 */

const VALID_SECTIONS = ['all', 'liked', 'recent', 'added', 'top25'];
const SETTINGS_KEY = 'library:sectionCache';

/**
 * Compute summary stats for a section from fetched data.
 * @param {{ tracks?: Array, total?: number }} data - Backend response
 * @returns {{ totalTracks: number, totalDuration: number, timestamp: number }}
 */
export function buildCacheEntry(data) {
  const tracks = data.tracks || [];
  return {
    totalTracks: data.total || tracks.length,
    totalDuration: tracks.reduce((sum, t) => sum + (t.duration || 0), 0),
    timestamp: Date.now(),
  };
}

/**
 * Load cached section summaries from persistent settings.
 * @param {object} settings - window.settings instance
 * @returns {{ cache: Record<string, object>, loaded: boolean }}
 */
export function loadCacheFromSettings(settings) {
  const result = { cache: {}, loaded: false };

  if (!settings?.initialized) {
    return result;
  }

  try {
    const cached = settings.get(SETTINGS_KEY, null);
    if (!cached || typeof cached !== 'object') {
      return result;
    }

    let loadedCount = 0;
    for (const [section, data] of Object.entries(cached)) {
      const isValidSection = VALID_SECTIONS.includes(section) ||
        section.startsWith('playlist-');
      if (isValidSection && data?.totalTracks > 0) {
        // Strip any legacy tracks array to save memory
        const { tracks: _tracks, ...summary } = data;
        result.cache[section] = summary;
        loadedCount++;
      }
    }

    if (loadedCount > 0) {
      console.log('[library] loaded persistent cache:', {
        sections: Object.keys(result.cache),
        totalTracks: Object.values(result.cache).reduce(
          (sum, s) => sum + (s.totalTracks || 0),
          0,
        ),
      });
      result.loaded = true;
    }
  } catch (error) {
    console.error('[library] failed to load cache from settings:', error);
  }

  return result;
}

/**
 * Create a debounced save function for persisting cache to settings.
 * @param {object} settings - window.settings instance
 * @param {number} [delay=500] - Debounce delay in ms
 * @returns {(cache: Record<string, object>, currentTimer: number|null) => number|null}
 */
export function createCacheSaver(settings, delay = 500) {
  return (cache, currentTimer) => {
    if (!settings?.initialized) {
      return currentTimer;
    }

    if (currentTimer) {
      clearTimeout(currentTimer);
    }

    return setTimeout(async () => {
      try {
        await settings.set(SETTINGS_KEY, cache);
        console.log('[library] cache persisted to settings');
      } catch (error) {
        console.error('[library] failed to save cache to settings:', error);
      }
    }, delay);
  };
}
