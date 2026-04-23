/**
 * Library API
 *
 * Track management, scanning, artwork, and missing track operations.
 */

import { ApiError, request, tauriInvoke } from './shared.js';

export const library = {
  /**
   * Get filtered count and total duration without loading track data
   * @param {object} params - Filter parameters
   * @param {string} [params.search] - Search query
   * @param {string} [params.artist] - Artist filter
   * @param {string} [params.album] - Album filter
   * @returns {Promise<{total: number, total_duration: number}>}
   */
  async getCount(params = {}) {
    const result = await tauriInvoke('library_get_count', {
      search: params.search || null,
      artist: params.artist || null,
      album: params.album || null,
    });
    if (result !== null) return result;
    const query = new URLSearchParams();
    if (params.search) query.set('search', params.search);
    const queryString = query.toString();
    return request(`/library/count${queryString ? `?${queryString}` : ''}`);
  },

  /**
   * Find the 0-based offset of the first row matching a prefix in the current sort order
   * @param {object} params - Filter/sort parameters plus prefix
   * @param {string} params.prefix - Prefix to search for
   * @param {string} [params.search] - Search query
   * @param {string} [params.sort] - Sort field
   * @param {string} [params.order] - Sort order
   * @param {string} [params.ignoreWords] - Ignore words for sort
   * @returns {Promise<number|null>} 0-based offset or null
   */
  async findOffset(params = {}) {
    const result = await tauriInvoke('library_find_offset', {
      search: params.search || null,
      artist: params.artist || null,
      album: params.album || null,
      sortBy: params.sort || null,
      sortOrder: params.order || null,
      ignoreWords: params.ignoreWords || null,
      prefix: params.prefix,
    });
    if (result !== null) return result;
    return null;
  },

  /**
   * Get all tracks in library (uses Tauri command)
   * @param {object} params - Query parameters
   * @param {string} [params.search] - Search query
   * @param {string} [params.sort] - Sort field
   * @param {string} [params.order] - Sort order ('asc' or 'desc')
   * @param {number} [params.limit] - Max results
   * @param {number} [params.offset] - Offset for pagination
   * @returns {Promise<{tracks: Array, total: number, limit: number, offset: number}>}
   */
  async getTracks(params = {}) {
    const result = await tauriInvoke('library_get_all', {
      search: params.search || null,
      artist: params.artist || null,
      album: params.album || null,
      sortBy: params.sort || null,
      sortOrder: params.order || null,
      limit: params.limit || null,
      offset: params.offset || null,
      ignoreWords: params.ignoreWords || null,
    });
    if (result !== null) return result;
    // Fallback to HTTP
    const query = new URLSearchParams();
    if (params.search) query.set('search', params.search);
    if (params.sort) query.set('sort_by', params.sort);
    if (params.order) query.set('sort_order', params.order);
    if (params.limit) query.set('limit', params.limit.toString());
    if (params.offset) query.set('offset', params.offset.toString());
    const queryString = query.toString();
    return request(`/library${queryString ? `?${queryString}` : ''}`);
  },

  /**
   * Get a complete view model for any library section in a single call.
   * Returns tracks, authoritative stats, pagination metadata, and a revision
   * number for cache invalidation — all from the same DB transaction.
   * @param {object} params
   * @param {string} params.section - 'all', 'liked', 'top25', 'recent', 'added', or 'playlist-{id}'
   * @param {string} [params.search] - Search query (all section only)
   * @param {string} [params.artist] - Artist filter (all section only)
   * @param {string} [params.album] - Album filter (all section only)
   * @param {string} [params.sort] - Sort field (all section only)
   * @param {string} [params.order] - Sort order (all section only)
   * @param {number} [params.limit] - Page size / result limit
   * @param {number} [params.offset] - Page offset (all section only)
   * @param {string} [params.ignoreWords] - Ignore words for sort (all section only)
   * @param {number} [params.days] - Days lookback (recent/added sections)
   * @returns {Promise<{section: string, tracks: Array, total_tracks: number, total_duration: number, page: number|null, page_size: number|null, has_more: boolean, revision: number}>}
   */
  async getSection(params = {}) {
    const result = await tauriInvoke('library_get_section', {
      section: params.section,
      search: params.search || null,
      artist: params.artist || null,
      album: params.album || null,
      sortBy: params.sort || null,
      sortOrder: params.order || null,
      limit: params.limit || null,
      offset: params.offset || null,
      ignoreWords: params.ignoreWords || null,
      days: params.days || null,
    });
    if (result !== null) return result;
    // HTTP fallback: dispatch to the appropriate REST endpoint per section
    const section = params.section || 'all';

    // Playlist sections use the playlists REST endpoint
    const playlistMatch = section.match(/^playlist-(\d+)$/);
    if (playlistMatch) {
      const data = await request(`/playlists/${playlistMatch[1]}`);
      const tracks = (data.tracks || []).map((item) => item.track || item);
      const totalDuration = tracks.reduce((sum, t) => sum + (t.duration || 0), 0);
      return {
        section,
        tracks,
        total_tracks: tracks.length,
        total_duration: totalDuration,
        page: null,
        page_size: null,
        has_more: false,
        revision: 0,
      };
    }

    // All other sections compose from /library + /library/count
    const query = new URLSearchParams();
    if (params.search) query.set('search', params.search);
    if (params.artist) query.set('artist', params.artist);
    if (params.album) query.set('album', params.album);
    if (params.sort) query.set('sort_by', params.sort);
    if (params.order) query.set('sort_order', params.order);
    if (params.limit) query.set('limit', params.limit.toString());
    if (params.offset) query.set('offset', params.offset.toString());
    const qs = query.toString();
    const [trackData, countData] = await Promise.all([
      request(`/library${qs ? `?${qs}` : ''}`),
      request(`/library/count${qs ? `?${qs}` : ''}`),
    ]);
    return {
      section,
      tracks: trackData.tracks || [],
      total_tracks: countData.total ?? (trackData.tracks || []).length,
      total_duration: countData.total_duration ?? 0,
      page: params.offset != null ? Math.floor(params.offset / (params.limit || 50)) : null,
      page_size: params.limit || null,
      has_more: trackData.total > (params.offset || 0) + (trackData.tracks || []).length,
      revision: 0,
    };
  },

  /**
   * Get a single track by ID (uses Tauri command)
   * @param {number} id - Track ID
   * @returns {Promise<object|null>} Track object or null
   */
  async getTrack(id) {
    const result = await tauriInvoke('library_get_track', { trackId: id });
    if (result !== null) return result;
    return request(`/library/${encodeURIComponent(id)}`);
  },

  /**
   * Scan paths for music files and add to library (uses Tauri command)
   * @param {string[]} paths - File or directory paths to scan
   * @param {boolean} [recursive=true] - Scan subdirectories
   * @returns {Promise<{added_count: number, modified_count: number, unchanged_count: number, deleted_count: number, error_count: number}>}
   */
  async scan(paths, recursive = true) {
    const result = await tauriInvoke('scan_paths_to_library', { paths, recursive });
    if (result !== null) {
      // Map response to expected format
      return {
        added: result.added_count || 0,
        skipped: result.unchanged_count || 0,
        errors: result.error_count || 0,
        tracks: [], // The new API doesn't return tracks
      };
    }
    return request('/library/scan', {
      method: 'POST',
      body: JSON.stringify({ paths, recursive }),
    });
  },

  /**
   * Get library statistics (uses Tauri command)
   * @returns {Promise<{total_tracks: number, total_duration: number, total_size: number, total_artists: number, total_albums: number}>}
   */
  async getStats() {
    const result = await tauriInvoke('library_get_stats');
    if (result !== null) return result;
    return request('/library/stats');
  },

  /**
   * Delete a track from library (uses Tauri command)
   * @param {number} id - Track ID
   * @returns {Promise<boolean>} True if deleted
   */
  async deleteTrack(id) {
    const result = await tauriInvoke('library_delete_track', { trackId: id });
    if (result !== null) return result;
    return request(`/library/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  },

  /**
   * Update play count for a track (uses Tauri command)
   * @param {number} id - Track ID
   * @returns {Promise<object>} Updated track object
   */
  async updatePlayCount(id) {
    const result = await tauriInvoke('library_update_play_count', { trackId: id });
    if (result !== null) return result;
    return request(`/library/${encodeURIComponent(id)}/play-count`, {
      method: 'PUT',
    });
  },

  /**
   * Rescan a track's metadata from its file (uses Tauri command)
   * @param {number} id - Track ID
   * @returns {Promise<object>} Updated track object
   */
  async rescanTrack(id) {
    const result = await tauriInvoke('library_rescan_track', { trackId: id });
    if (result !== null) return result;
    return request(`/library/${encodeURIComponent(id)}/rescan`, {
      method: 'PUT',
    });
  },

  /**
   * Get album artwork for a track (uses Tauri command)
   * @param {number} id - Track ID
   * @returns {Promise<{data: string, mime_type: string, source: string}|null>}
   */
  async getArtwork(id) {
    try {
      const result = await tauriInvoke('library_get_artwork', { trackId: id });
      if (result !== null) return result;
    } catch (error) {
      if (error.message.includes('not found')) {
        return null;
      }
      throw error;
    }
    try {
      return await request(`/library/${encodeURIComponent(id)}/artwork`);
    } catch (error) {
      if (error.status === 404) {
        return null;
      }
      throw error;
    }
  },

  /**
   * Get artwork as data URL for use in img src (uses Tauri command)
   * @param {number} id - Track ID
   * @returns {Promise<string|null>} Data URL or null
   */
  async getArtworkUrl(id) {
    if (window.__TAURI__?.core?.invoke) {
      try {
        return await window.__TAURI__.core.invoke('library_get_artwork_url', { trackId: id });
      } catch (error) {
        if (error.toString().includes('not found')) {
          return null;
        }
        console.error('[api.library.getArtworkUrl] Tauri error:', error);
        throw new ApiError(500, error.toString());
      }
    }
    // HTTP fallback - get artwork and convert to data URL
    const artwork = await this.getArtwork(id);
    if (artwork && artwork.data) {
      return `data:${artwork.mime_type};base64,${artwork.data}`;
    }
    return null;
  },

  /**
   * Get all tracks marked as missing (uses Tauri command)
   * @returns {Promise<{tracks: Array, total: number}>}
   */
  async getMissing() {
    const result = await tauriInvoke('library_get_missing');
    if (result !== null) return result;
    return request('/library/missing');
  },

  /**
   * Locate a missing track by providing a new file path (uses Tauri command)
   * @param {number} id - Track ID
   * @param {string} newPath - New file path
   * @returns {Promise<object>} Updated track object
   */
  async locate(id, newPath) {
    const result = await tauriInvoke('library_locate_track', { trackId: id, newPath });
    if (result !== null) return result;
    return request(`/library/${encodeURIComponent(id)}/locate`, {
      method: 'POST',
      body: JSON.stringify({ new_path: newPath }),
    });
  },

  /**
   * Check if a track's file exists and update its missing status (uses Tauri command)
   * @param {number} id - Track ID
   * @returns {Promise<object>} Updated track object with current missing status
   */
  async checkStatus(id) {
    const result = await tauriInvoke('library_check_status', { trackId: id });
    if (result !== null) return result;
    return request(`/library/${encodeURIComponent(id)}/check-status`, {
      method: 'POST',
    });
  },

  /**
   * Mark a track as missing (uses Tauri command)
   * @param {number} id - Track ID
   * @returns {Promise<object>} Updated track object
   */
  async markMissing(id) {
    const result = await tauriInvoke('library_mark_missing', { trackId: id });
    if (result !== null) return result;
    return request(`/library/${encodeURIComponent(id)}/mark-missing`, {
      method: 'POST',
    });
  },

  /**
   * Mark a track as present (not missing) (uses Tauri command)
   * @param {number} id - Track ID
   * @returns {Promise<object>} Updated track object
   */
  async markPresent(id) {
    const result = await tauriInvoke('library_mark_present', { trackId: id });
    if (result !== null) return result;
    return request(`/library/${encodeURIComponent(id)}/mark-present`, {
      method: 'POST',
    });
  },
};
