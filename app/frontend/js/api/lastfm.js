/**
 * Last.fm API
 *
 * Scrobbling, authentication, loved tracks, and now-playing operations.
 */

import { request, tauriInvoke } from './shared.js';

export const lastfm = {
  /**
   * Get Last.fm settings (uses Tauri command)
   * @returns {Promise<{enabled: boolean, username: string|null, authenticated: boolean, configured: boolean, scrobble_threshold: number}>}
   */
  async getSettings() {
    const result = await tauriInvoke('lastfm_get_settings');
    if (result !== null) return result;
    return request('/lastfm/settings');
  },

  /**
   * Update Last.fm settings (uses Tauri command)
   * @param {object} settings - Settings to update
   * @param {boolean} [settings.enabled] - Enable/disable scrobbling
   * @param {number} [settings.scrobble_threshold] - Scrobble threshold percentage (25-100)
   * @returns {Promise<{updated: string[]}>}
   */
  async updateSettings(settings) {
    const result = await tauriInvoke('lastfm_update_settings', { settingsUpdate: settings });
    if (result !== null) return result;
    return request('/lastfm/settings', {
      method: 'PUT',
      body: JSON.stringify(settings),
    });
  },

  /**
   * Get Last.fm authentication URL (uses Tauri command)
   * @returns {Promise<{auth_url: string, token: string}>}
   */
  async getAuthUrl() {
    const result = await tauriInvoke('lastfm_get_auth_url');
    if (result !== null) return result;
    return request('/lastfm/auth-url');
  },

  /**
   * Complete Last.fm authentication (uses Tauri command)
   * @param {string} token - Authentication token from callback
   * @returns {Promise<{status: string, username: string, message: string}>}
   */
  async completeAuth(token) {
    const result = await tauriInvoke('lastfm_auth_callback', { token });
    if (result !== null) return result;
    const query = new URLSearchParams({ token });
    return request(`/lastfm/auth-callback?${query}`);
  },

  /**
   * Scrobble a track (uses Tauri command)
   * @param {object} scrobbleData - Track scrobble data
   * @param {string} scrobbleData.artist - Artist name
   * @param {string} scrobbleData.track - Track title
   * @param {string} [scrobbleData.album] - Album name
   * @param {number} scrobbleData.timestamp - Unix timestamp when track finished
   * @param {number} scrobbleData.duration - Track duration in seconds
   * @param {number} scrobbleData.played_time - Time played in seconds
   * @returns {Promise<{status: string, message?: string}>}
   */
  async scrobble(scrobbleData) {
    const result = await tauriInvoke('lastfm_scrobble', { request: scrobbleData });
    if (result !== null) return result;
    return request('/lastfm/scrobble', {
      method: 'POST',
      body: JSON.stringify(scrobbleData),
    });
  },

  /**
   * Update 'Now Playing' status on Last.fm (uses Tauri command)
   * @param {object} nowPlayingData - Now playing track data
   * @param {string} nowPlayingData.artist - Artist name
   * @param {string} nowPlayingData.track - Track title
   * @param {string} [nowPlayingData.album] - Album name
   * @param {number} [nowPlayingData.duration] - Track duration in seconds
   * @returns {Promise<{status: string, message?: string}>}
   */
  async updateNowPlaying(nowPlayingData) {
    const result = await tauriInvoke('lastfm_now_playing', { request: nowPlayingData });
    if (result !== null) return result;
    return request('/lastfm/now-playing', {
      method: 'POST',
      body: JSON.stringify(nowPlayingData),
    });
  },

  /**
   * Import user's loved tracks from Last.fm (uses Tauri command)
   * @returns {Promise<{status: string, total_loved_tracks: number, imported_count: number, message: string}>}
   */
  async importLovedTracks() {
    const result = await tauriInvoke('lastfm_import_loved_tracks');
    if (result !== null) return result;
    return request('/lastfm/import-loved-tracks', {
      method: 'POST',
    });
  },

  /**
   * Disconnect from Last.fm (uses Tauri command)
   * @returns {Promise<{status: string, message: string}>}
   */
  async disconnect() {
    const result = await tauriInvoke('lastfm_disconnect');
    if (result !== null) return result;
    return request('/lastfm/disconnect', {
      method: 'DELETE',
    });
  },

  /**
   * Get scrobble queue status (uses Tauri command)
   * @returns {Promise<{queued_scrobbles: number}>}
   */
  async getQueueStatus() {
    const result = await tauriInvoke('lastfm_queue_status');
    if (result !== null) return result;
    return request('/lastfm/queue/status');
  },

  /**
   * Manually retry queued scrobbles (uses Tauri command)
   * @returns {Promise<{status: string, remaining_queued: number}>}
   */
  async retryQueuedScrobbles() {
    const result = await tauriInvoke('lastfm_queue_retry');
    if (result !== null) return result;
    return request('/lastfm/queue/retry', {
      method: 'POST',
    });
  },

  /**
   * Cache loved tracks from Last.fm (with incremental support)
   * @returns {Promise<{status: string, fetched: number, new_tracks: number, total_cached: number}>}
   */
  async cacheLovedTracks() {
    const result = await tauriInvoke('lastfm_cache_loved_tracks');
    if (result !== null) return result;
    return request('/lastfm/cache-loved-tracks', {
      method: 'POST',
    });
  },

  /**
   * Match cached loved tracks against local library (no API call)
   * @returns {Promise<{status: string, matched: number, already_matched: number, not_found: number, new_favorites: number}>}
   */
  async matchLovedTracks() {
    const result = await tauriInvoke('lastfm_match_loved_tracks');
    if (result !== null) return result;
    return request('/lastfm/match-loved-tracks', {
      method: 'POST',
    });
  },

  /**
   * Get loved tracks cache statistics
   * @returns {Promise<{total_cached: number, matched: number, unmatched: number, most_recent_loved: number|null}>}
   */
  async getLovedStats() {
    const result = await tauriInvoke('lastfm_loved_stats');
    if (result !== null) return result;
    return request('/lastfm/loved-stats');
  },

  /**
   * Reset loved tracks cache (does not affect favorites)
   * @returns {Promise<{status: string, cleared: number, message: string}>}
   */
  async resetLovedCache() {
    const result = await tauriInvoke('lastfm_reset_loved_cache');
    if (result !== null) return result;
    return request('/lastfm/reset-loved-cache', { method: 'POST' });
  },
};
