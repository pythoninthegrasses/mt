/**
 * Last.fm API
 *
 * Scrobbling, authentication, loved tracks, and now-playing operations.
 */

import { ApiError, invoke, request } from './shared.js';

export const lastfm = {
  /**
   * Get Last.fm settings (uses Tauri command)
   * @returns {Promise<{enabled: boolean, username: string|null, authenticated: boolean, configured: boolean, scrobble_threshold: number}>}
   */
  async getSettings() {
    if (invoke) {
      try {
        return await invoke('lastfm_get_settings');
      } catch (error) {
        console.error('[api.lastfm.getSettings] Tauri error:', error);
        throw new ApiError(500, error.toString());
      }
    }
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
    if (invoke) {
      try {
        return await invoke('lastfm_update_settings', { settingsUpdate: settings });
      } catch (error) {
        console.error('[api.lastfm.updateSettings] Tauri error:', error);
        throw new ApiError(500, error.toString());
      }
    }
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
    if (invoke) {
      try {
        return await invoke('lastfm_get_auth_url');
      } catch (error) {
        console.error('[api.lastfm.getAuthUrl] Tauri error:', error);
        throw new ApiError(500, error.toString());
      }
    }
    return request('/lastfm/auth-url');
  },

  /**
   * Complete Last.fm authentication (uses Tauri command)
   * @param {string} token - Authentication token from callback
   * @returns {Promise<{status: string, username: string, message: string}>}
   */
  async completeAuth(token) {
    if (invoke) {
      try {
        return await invoke('lastfm_auth_callback', { token });
      } catch (error) {
        console.error('[api.lastfm.completeAuth] Tauri error:', error);
        throw new ApiError(500, error.toString());
      }
    }
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
    if (invoke) {
      try {
        return await invoke('lastfm_scrobble', { request: scrobbleData });
      } catch (error) {
        console.error('[api.lastfm.scrobble] Tauri error:', error);
        throw new ApiError(500, error.toString());
      }
    }
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
    if (invoke) {
      try {
        return await invoke('lastfm_now_playing', { request: nowPlayingData });
      } catch (error) {
        console.error('[api.lastfm.updateNowPlaying] Tauri error:', error);
        throw new ApiError(500, error.toString());
      }
    }
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
    if (invoke) {
      try {
        return await invoke('lastfm_import_loved_tracks');
      } catch (error) {
        console.error('[api.lastfm.importLovedTracks] Tauri error:', error);
        throw new ApiError(500, error.toString());
      }
    }
    return request('/lastfm/import-loved-tracks', {
      method: 'POST',
    });
  },

  /**
   * Disconnect from Last.fm (uses Tauri command)
   * @returns {Promise<{status: string, message: string}>}
   */
  async disconnect() {
    if (invoke) {
      try {
        return await invoke('lastfm_disconnect');
      } catch (error) {
        console.error('[api.lastfm.disconnect] Tauri error:', error);
        throw new ApiError(500, error.toString());
      }
    }
    return request('/lastfm/disconnect', {
      method: 'DELETE',
    });
  },

  /**
   * Get scrobble queue status (uses Tauri command)
   * @returns {Promise<{queued_scrobbles: number}>}
   */
  async getQueueStatus() {
    if (invoke) {
      try {
        return await invoke('lastfm_queue_status');
      } catch (error) {
        console.error('[api.lastfm.getQueueStatus] Tauri error:', error);
        throw new ApiError(500, error.toString());
      }
    }
    return request('/lastfm/queue/status');
  },

  /**
   * Manually retry queued scrobbles (uses Tauri command)
   * @returns {Promise<{status: string, remaining_queued: number}>}
   */
  async retryQueuedScrobbles() {
    if (invoke) {
      try {
        return await invoke('lastfm_queue_retry');
      } catch (error) {
        console.error('[api.lastfm.retryQueuedScrobbles] Tauri error:', error);
        throw new ApiError(500, error.toString());
      }
    }
    return request('/lastfm/queue/retry', {
      method: 'POST',
    });
  },

  /**
   * Cache loved tracks from Last.fm (with incremental support)
   * @returns {Promise<{status: string, fetched: number, new_tracks: number, total_cached: number}>}
   */
  async cacheLovedTracks() {
    if (invoke) {
      try {
        return await invoke('lastfm_cache_loved_tracks');
      } catch (error) {
        console.error('[api.lastfm.cacheLovedTracks] Tauri error:', error);
        throw new ApiError(500, error.toString());
      }
    }
    return request('/lastfm/cache-loved-tracks', {
      method: 'POST',
    });
  },

  /**
   * Match cached loved tracks against local library (no API call)
   * @returns {Promise<{status: string, matched: number, already_matched: number, not_found: number, new_favorites: number}>}
   */
  async matchLovedTracks() {
    if (invoke) {
      try {
        return await invoke('lastfm_match_loved_tracks');
      } catch (error) {
        console.error('[api.lastfm.matchLovedTracks] Tauri error:', error);
        throw new ApiError(500, error.toString());
      }
    }
    return request('/lastfm/match-loved-tracks', {
      method: 'POST',
    });
  },

  /**
   * Get loved tracks cache statistics
   * @returns {Promise<{total_cached: number, matched: number, unmatched: number, most_recent_loved: number|null}>}
   */
  async getLovedStats() {
    if (invoke) {
      try {
        return await invoke('lastfm_loved_stats');
      } catch (error) {
        console.error('[api.lastfm.getLovedStats] Tauri error:', error);
        throw new ApiError(500, error.toString());
      }
    }
    return request('/lastfm/loved-stats');
  },

  /**
   * Reset loved tracks cache (does not affect favorites)
   * @returns {Promise<{status: string, cleared: number, message: string}>}
   */
  async resetLovedCache() {
    if (invoke) {
      try {
        return await invoke('lastfm_reset_loved_cache');
      } catch (error) {
        console.error('[api.lastfm.resetLovedCache] Tauri error:', error);
        throw new ApiError(500, error.toString());
      }
    }
    return request('/lastfm/reset-loved-cache', { method: 'POST' });
  },
};
