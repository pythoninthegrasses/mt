/**
 * Favorites API
 *
 * Liked songs, top played, recently played/added operations.
 */

import { ApiError, request, tauriInvoke } from './shared.js';

export const favorites = {
  /**
   * Get favorited tracks (Liked Songs) with pagination (uses Tauri command)
   * @param {object} params - Query parameters
   * @param {number} [params.limit] - Max results (default 100)
   * @param {number} [params.offset] - Offset for pagination (default 0)
   * @returns {Promise<{tracks: Array, total: number, limit: number, offset: number}>}
   */
  async get(params = {}) {
    const result = await tauriInvoke('favorites_get', {
      limit: params.limit ?? null,
      offset: params.offset ?? null,
    });
    if (result !== null) return result;
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
    const result = await tauriInvoke('favorites_check', { trackId });
    if (result !== null) return result;
    return request(`/favorites/${encodeURIComponent(trackId)}`);
  },

  /**
   * Add a track to favorites (uses Tauri command)
   * @param {number} trackId - Track ID
   * @returns {Promise<{success: boolean, favorited_date: string}>}
   */
  async add(trackId) {
    try {
      const result = await tauriInvoke('favorites_add', { trackId });
      if (result !== null) return result;
    } catch (error) {
      if (error.message.includes('already favorited')) {
        throw new ApiError(409, 'Track is already favorited');
      }
      if (error.message.includes('not found')) {
        throw new ApiError(404, error.message);
      }
      throw error;
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
    try {
      const result = await tauriInvoke('favorites_remove', { trackId });
      if (result !== null) return result;
    } catch (error) {
      if (error.message.includes('not in favorites')) {
        throw new ApiError(404, error.message);
      }
      throw error;
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
    const result = await tauriInvoke('favorites_get_top25');
    if (result !== null) return result;
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
    const result = await tauriInvoke('favorites_get_recently_played', {
      days: params.days ?? null,
      limit: params.limit ?? null,
    });
    if (result !== null) return result;
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
    const result = await tauriInvoke('favorites_get_recently_added', {
      days: params.days ?? null,
      limit: params.limit ?? null,
    });
    if (result !== null) return result;
    // Fallback to HTTP
    const query = new URLSearchParams();
    if (params.days) query.set('days', params.days.toString());
    if (params.limit) query.set('limit', params.limit.toString());
    const queryString = query.toString();
    return request(`/favorites/recently-added${queryString ? `?${queryString}` : ''}`);
  },
};
