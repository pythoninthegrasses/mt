/**
 * Favorites API
 *
 * Liked songs, top played, recently played/added operations.
 */

import { ApiError, invoke, request } from './shared.js';

export const favorites = {
  /**
   * Get favorited tracks (Liked Songs) with pagination (uses Tauri command)
   * @param {object} params - Query parameters
   * @param {number} [params.limit] - Max results (default 100)
   * @param {number} [params.offset] - Offset for pagination (default 0)
   * @returns {Promise<{tracks: Array, total: number, limit: number, offset: number}>}
   */
  async get(params = {}) {
    if (invoke) {
      try {
        return await invoke('favorites_get', {
          limit: params.limit ?? null,
          offset: params.offset ?? null,
        });
      } catch (error) {
        console.error('[api.favorites.get] Tauri error:', error);
        throw new ApiError(500, error.toString());
      }
    }
    // Fallback to HTTP
    const query = new URLSearchParams();
    if (params.limit) query.set('limit', params.limit.toString());
    if (params.offset) query.set('offset', params.offset.toString());
    const queryString = query.toString();
    return request(`/favorites${queryString ? `?${queryString}` : ''}`);
  },

  /**
   * Check if a track is favorited (uses Tauri command)
   * @param {number} trackId - Track ID
   * @returns {Promise<{is_favorite: boolean, favorited_date: string|null}>}
   */
  async check(trackId) {
    if (invoke) {
      try {
        return await invoke('favorites_check', { trackId });
      } catch (error) {
        console.error('[api.favorites.check] Tauri error:', error);
        throw new ApiError(500, error.toString());
      }
    }
    return request(`/favorites/${encodeURIComponent(trackId)}`);
  },

  /**
   * Add a track to favorites (uses Tauri command)
   * @param {number} trackId - Track ID
   * @returns {Promise<{success: boolean, favorited_date: string}>}
   */
  async add(trackId) {
    if (invoke) {
      try {
        return await invoke('favorites_add', { trackId });
      } catch (error) {
        console.error('[api.favorites.add] Tauri error:', error);
        // Check for specific error messages
        if (error.toString().includes('already favorited')) {
          throw new ApiError(409, 'Track is already favorited');
        }
        if (error.toString().includes('not found')) {
          throw new ApiError(404, error.toString());
        }
        throw new ApiError(500, error.toString());
      }
    }
    return request(`/favorites/${encodeURIComponent(trackId)}`, {
      method: 'POST',
    });
  },

  /**
   * Remove a track from favorites (uses Tauri command)
   * @param {number} trackId - Track ID
   * @returns {Promise<void>}
   */
  async remove(trackId) {
    if (invoke) {
      try {
        return await invoke('favorites_remove', { trackId });
      } catch (error) {
        console.error('[api.favorites.remove] Tauri error:', error);
        if (error.toString().includes('not in favorites')) {
          throw new ApiError(404, error.toString());
        }
        throw new ApiError(500, error.toString());
      }
    }
    return request(`/favorites/${encodeURIComponent(trackId)}`, {
      method: 'DELETE',
    });
  },

  /**
   * Get top 25 most played tracks (uses Tauri command)
   * @returns {Promise<{tracks: Array}>}
   */
  async getTop25() {
    if (invoke) {
      try {
        return await invoke('favorites_get_top25');
      } catch (error) {
        console.error('[api.favorites.getTop25] Tauri error:', error);
        throw new ApiError(500, error.toString());
      }
    }
    return request('/favorites/top25');
  },

  /**
   * Get tracks played within the last N days (uses Tauri command)
   * @param {object} params - Query parameters
   * @param {number} [params.days] - Number of days to look back (default 14)
   * @param {number} [params.limit] - Max results (default 100)
   * @returns {Promise<{tracks: Array, days: number}>}
   */
  async getRecentlyPlayed(params = {}) {
    if (invoke) {
      try {
        return await invoke('favorites_get_recently_played', {
          days: params.days ?? null,
          limit: params.limit ?? null,
        });
      } catch (error) {
        console.error('[api.favorites.getRecentlyPlayed] Tauri error:', error);
        throw new ApiError(500, error.toString());
      }
    }
    // Fallback to HTTP
    const query = new URLSearchParams();
    if (params.days) query.set('days', params.days.toString());
    if (params.limit) query.set('limit', params.limit.toString());
    const queryString = query.toString();
    return request(`/favorites/recently-played${queryString ? `?${queryString}` : ''}`);
  },

  /**
   * Get tracks added within the last N days (uses Tauri command)
   * @param {object} params - Query parameters
   * @param {number} [params.days] - Number of days to look back (default 14)
   * @param {number} [params.limit] - Max results (default 100)
   * @returns {Promise<{tracks: Array, days: number}>}
   */
  async getRecentlyAdded(params = {}) {
    if (invoke) {
      try {
        return await invoke('favorites_get_recently_added', {
          days: params.days ?? null,
          limit: params.limit ?? null,
        });
      } catch (error) {
        console.error('[api.favorites.getRecentlyAdded] Tauri error:', error);
        throw new ApiError(500, error.toString());
      }
    }
    // Fallback to HTTP
    const query = new URLSearchParams();
    if (params.days) query.set('days', params.days.toString());
    if (params.limit) query.set('limit', params.limit.toString());
    const queryString = query.toString();
    return request(`/favorites/recently-added${queryString ? `?${queryString}` : ''}`);
  },
};
