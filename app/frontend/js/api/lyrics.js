/**
 * Lyrics API
 *
 * LRCLIB lyrics lookup with SQLite caching via Tauri commands.
 */

import { tauriInvoke } from './shared.js';

export const lyrics = {
  /**
   * Get lyrics for a track (checks cache, fetches from LRCLIB on miss)
   * @param {object} params
   * @param {string} params.artist - Artist name
   * @param {string} params.title - Track title
   * @param {string} [params.album] - Album name
   * @param {number} [params.duration] - Duration in seconds
   * @returns {Promise<{plain_lyrics: string|null, synced_lyrics: string|null, instrumental: boolean}|null>}
   */
  async get(params) {
    const result = await tauriInvoke('lyrics_get', {
      artist: params.artist,
      title: params.title,
      album: params.album ?? null,
      duration: params.duration ?? null,
    });
    if (result !== null) return result;
    return null;
  },

  /**
   * Clear all cached lyrics
   * @returns {Promise<void>}
   */
  clearCache() {
    return tauriInvoke('lyrics_clear_cache');
  },
};
