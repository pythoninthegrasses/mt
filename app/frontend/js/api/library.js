/**
 * Library API
 *
 * Track management, scanning, artwork, and missing track operations.
 */

import { ApiError, invoke, request } from './shared.js';

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
    if (invoke) {
      try {
        return await invoke('library_get_count', {
          search: params.search || null,
          artist: params.artist || null,
          album: params.album || null,
        });
      } catch (error) {
        console.error('[api.library.getCount] Tauri error:', error);
        throw new ApiError(500, error.toString());
      }
    }
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
    if (invoke) {
      try {
        return await invoke('library_find_offset', {
          search: params.search || null,
          artist: params.artist || null,
          album: params.album || null,
          sortBy: params.sort || null,
          sortOrder: params.order || null,
          ignoreWords: params.ignoreWords || null,
          prefix: params.prefix,
        });
      } catch (error) {
        console.error('[api.library.findOffset] Tauri error:', error);
        throw new ApiError(500, error.toString());
      }
    }
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
    if (invoke) {
      try {
        return await invoke('library_get_all', {
          search: params.search || null,
          artist: params.artist || null,
          album: params.album || null,
          sortBy: params.sort || null,
          sortOrder: params.order || null,
          limit: params.limit || null,
          offset: params.offset || null,
          ignoreWords: params.ignoreWords || null,
        });
      } catch (error) {
        console.error('[api.library.getTracks] Tauri error:', error);
        throw new ApiError(500, error.toString());
      }
    }
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
   * Get a single track by ID (uses Tauri command)
   * @param {number} id - Track ID
   * @returns {Promise<object|null>} Track object or null
   */
  async getTrack(id) {
    if (invoke) {
      try {
        return await invoke('library_get_track', { trackId: id });
      } catch (error) {
        console.error('[api.library.getTrack] Tauri error:', error);
        throw new ApiError(500, error.toString());
      }
    }
    return request(`/library/${encodeURIComponent(id)}`);
  },

  /**
   * Scan paths for music files and add to library (uses Tauri command)
   * @param {string[]} paths - File or directory paths to scan
   * @param {boolean} [recursive=true] - Scan subdirectories
   * @returns {Promise<{added_count: number, modified_count: number, unchanged_count: number, deleted_count: number, error_count: number}>}
   */
  async scan(paths, recursive = true) {
    if (invoke) {
      try {
        const result = await invoke('scan_paths_to_library', { paths, recursive });
        // Map response to expected format
        return {
          added: result.added_count || 0,
          skipped: result.unchanged_count || 0,
          errors: result.error_count || 0,
          tracks: [], // The new API doesn't return tracks
        };
      } catch (error) {
        console.error('[api.library.scan] Tauri error:', error);
        throw new ApiError(500, error.toString());
      }
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
    if (invoke) {
      try {
        return await invoke('library_get_stats');
      } catch (error) {
        console.error('[api.library.getStats] Tauri error:', error);
        throw new ApiError(500, error.toString());
      }
    }
    return request('/library/stats');
  },

  /**
   * Delete a track from library (uses Tauri command)
   * @param {number} id - Track ID
   * @returns {Promise<boolean>} True if deleted
   */
  async deleteTrack(id) {
    if (invoke) {
      try {
        return await invoke('library_delete_track', { trackId: id });
      } catch (error) {
        console.error('[api.library.deleteTrack] Tauri error:', error);
        throw new ApiError(500, error.toString());
      }
    }
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
    if (invoke) {
      try {
        return await invoke('library_update_play_count', { trackId: id });
      } catch (error) {
        console.error('[api.library.updatePlayCount] Tauri error:', error);
        throw new ApiError(500, error.toString());
      }
    }
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
    if (invoke) {
      try {
        return await invoke('library_rescan_track', { trackId: id });
      } catch (error) {
        console.error('[api.library.rescanTrack] Tauri error:', error);
        throw new ApiError(500, error.toString());
      }
    }
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
    if (invoke) {
      try {
        return await invoke('library_get_artwork', { trackId: id });
      } catch (error) {
        // Not found is returned as null, not an error
        if (error.toString().includes('not found')) {
          return null;
        }
        console.error('[api.library.getArtwork] Tauri error:', error);
        throw new ApiError(500, error.toString());
      }
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
    if (invoke) {
      try {
        return await invoke('library_get_artwork_url', { trackId: id });
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
    if (invoke) {
      try {
        return await invoke('library_get_missing');
      } catch (error) {
        console.error('[api.library.getMissing] Tauri error:', error);
        throw new ApiError(500, error.toString());
      }
    }
    return request('/library/missing');
  },

  /**
   * Locate a missing track by providing a new file path (uses Tauri command)
   * @param {number} id - Track ID
   * @param {string} newPath - New file path
   * @returns {Promise<object>} Updated track object
   */
  async locate(id, newPath) {
    if (invoke) {
      try {
        return await invoke('library_locate_track', { trackId: id, newPath });
      } catch (error) {
        console.error('[api.library.locate] Tauri error:', error);
        throw new ApiError(500, error.toString());
      }
    }
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
    if (invoke) {
      try {
        return await invoke('library_check_status', { trackId: id });
      } catch (error) {
        console.error('[api.library.checkStatus] Tauri error:', error);
        throw new ApiError(500, error.toString());
      }
    }
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
    if (invoke) {
      try {
        return await invoke('library_mark_missing', { trackId: id });
      } catch (error) {
        console.error('[api.library.markMissing] Tauri error:', error);
        throw new ApiError(500, error.toString());
      }
    }
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
    if (invoke) {
      try {
        return await invoke('library_mark_present', { trackId: id });
      } catch (error) {
        console.error('[api.library.markPresent] Tauri error:', error);
        throw new ApiError(500, error.toString());
      }
    }
    return request(`/library/${encodeURIComponent(id)}/mark-present`, {
      method: 'POST',
    });
  },
};
