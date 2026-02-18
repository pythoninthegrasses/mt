/**
 * Backend API Client
 *
 * Pure Tauri client - all backend operations use Rust via Tauri commands.
 * HTTP fallbacks are kept for browser-only development/testing.
 */

const API_BASE = 'http://127.0.0.1:8765/api';

// Get Tauri invoke function if available
const invoke = window.__TAURI__?.core?.invoke;

/**
 * Make an API request with error handling
 * @param {string} endpoint - API endpoint (e.g., '/library/tracks')
 * @param {object} options - Fetch options
 * @returns {Promise<any>} Response data
 */
async function request(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint}`;

  const config = {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  };

  try {
    const response = await fetch(url, config);

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: response.statusText }));
      throw new ApiError(response.status, error.detail || 'Request failed');
    }

    // Handle empty responses
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    // Network error or other fetch failure
    throw new ApiError(0, `Network error: ${error.message}`);
  }
}

/**
 * Custom API error class
 */
export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/**
 * API client object with all endpoints
 */
export const api = {
  /**
   * Health check
   * @returns {Promise<{status: string}>}
   */
  health() {
    return request('/health');
  },

  // ============================================
  // Library endpoints
  // ============================================

  library: {
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
  },

  // ============================================
  // Queue endpoints (uses Tauri commands)
  // ============================================

  queue: {
    /**
     * Get current queue (uses Tauri command)
     * @returns {Promise<{items: Array, count: number}>} Queue response
     */
    async get() {
      if (invoke) {
        try {
          return await invoke('queue_get');
        } catch (error) {
          console.error('[api.queue.get] Tauri error:', error);
          throw new ApiError(500, error.toString());
        }
      }
      return request('/queue');
    },

    /**
     * Add track(s) to queue by track IDs (uses Tauri command)
     * @param {number|number[]} trackIds - Track ID(s) to add
     * @param {number} [position] - Position to insert at (end if omitted)
     * @returns {Promise<{added: number, queue_length: number}>}
     */
    async add(trackIds, position) {
      const ids = Array.isArray(trackIds) ? trackIds : [trackIds];
      if (invoke) {
        try {
          return await invoke('queue_add', {
            trackIds: ids,
            position: position ?? null,
          });
        } catch (error) {
          console.error('[api.queue.add] Tauri error:', error);
          throw new ApiError(500, error.toString());
        }
      }
      return request('/queue/add', {
        method: 'POST',
        body: JSON.stringify({ track_ids: ids, position }),
      });
    },

    /**
     * Add files directly to queue (for drag-and-drop) (uses Tauri command)
     * @param {string[]} filepaths - File paths to add
     * @param {number} [position] - Position to insert at (end if omitted)
     * @returns {Promise<{added: number, queue_length: number, tracks: Array}>}
     */
    async addFiles(filepaths, position) {
      if (invoke) {
        try {
          return await invoke('queue_add_files', {
            filepaths,
            position: position ?? null,
          });
        } catch (error) {
          console.error('[api.queue.addFiles] Tauri error:', error);
          throw new ApiError(500, error.toString());
        }
      }
      return request('/queue/add-files', {
        method: 'POST',
        body: JSON.stringify({ filepaths, position }),
      });
    },

    /**
     * Remove track from queue (uses Tauri command)
     * @param {number} position - Position in queue to remove
     * @returns {Promise<void>}
     */
    async remove(position) {
      if (invoke) {
        try {
          return await invoke('queue_remove', { position });
        } catch (error) {
          console.error('[api.queue.remove] Tauri error:', error);
          throw new ApiError(500, error.toString());
        }
      }
      return request(`/queue/${position}`, {
        method: 'DELETE',
      });
    },

    /**
     * Clear the entire queue (uses Tauri command)
     * @returns {Promise<void>}
     */
    async clear() {
      if (invoke) {
        try {
          return await invoke('queue_clear');
        } catch (error) {
          console.error('[api.queue.clear] Tauri error:', error);
          throw new ApiError(500, error.toString());
        }
      }
      return request('/queue/clear', {
        method: 'POST',
      });
    },

    /**
     * Move track within queue (reorder) (uses Tauri command)
     * @param {number} from - Current position
     * @param {number} to - New position
     * @returns {Promise<{success: boolean, queue_length: number}>}
     */
    async move(from, to) {
      if (invoke) {
        try {
          return await invoke('queue_reorder', {
            fromPosition: from,
            toPosition: to,
          });
        } catch (error) {
          console.error('[api.queue.move] Tauri error:', error);
          throw new ApiError(500, error.toString());
        }
      }
      return request('/queue/reorder', {
        method: 'POST',
        body: JSON.stringify({ from_position: from, to_position: to }),
      });
    },

    /**
     * Shuffle the queue (uses Tauri command)
     * @param {boolean} [keepCurrent=true] - Keep currently playing track at position 0
     * @returns {Promise<{success: boolean, queue_length: number}>}
     */
    async shuffle(keepCurrent = true) {
      if (invoke) {
        try {
          return await invoke('queue_shuffle', { keepCurrent });
        } catch (error) {
          console.error('[api.queue.shuffle] Tauri error:', error);
          throw new ApiError(500, error.toString());
        }
      }
      return request('/queue/shuffle', {
        method: 'POST',
        body: JSON.stringify({ keep_current: keepCurrent }),
      });
    },

    save(state) {
      console.debug('Queue save (local only):', state);
    },

    /**
     * Get queue playback state (uses Tauri command)
     * @returns {Promise<{current_index: number, shuffle_enabled: boolean, loop_mode: string, original_order_json: string|null}>}
     */
    async getPlaybackState() {
      if (invoke) {
        try {
          return await invoke('queue_get_playback_state');
        } catch (error) {
          console.error('[api.queue.getPlaybackState] Tauri error:', error);
          throw new ApiError(500, error.toString());
        }
      }
      throw new ApiError(500, 'Queue playback state not available in browser mode');
    },

    /**
     * Set current index in queue (uses Tauri command)
     * @param {number} index - New current index
     * @returns {Promise<void>}
     */
    async setCurrentIndex(index) {
      if (invoke) {
        try {
          return await invoke('queue_set_current_index', { index });
        } catch (error) {
          console.error('[api.queue.setCurrentIndex] Tauri error:', error);
          throw new ApiError(500, error.toString());
        }
      }
      console.debug('Queue setCurrentIndex (no-op in browser):', index);
    },

    /**
     * Set shuffle enabled in queue (uses Tauri command)
     * @param {boolean} enabled - Whether shuffle is enabled
     * @returns {Promise<void>}
     */
    async setShuffle(enabled) {
      if (invoke) {
        try {
          return await invoke('queue_set_shuffle', { enabled });
        } catch (error) {
          console.error('[api.queue.setShuffle] Tauri error:', error);
          throw new ApiError(500, error.toString());
        }
      }
      console.debug('Queue setShuffle (no-op in browser):', enabled);
    },

    /**
     * Set loop mode in queue (uses Tauri command)
     * @param {string} mode - Loop mode ('none', 'all', 'one')
     * @returns {Promise<void>}
     */
    async setLoop(mode) {
      if (invoke) {
        try {
          return await invoke('queue_set_loop', { mode });
        } catch (error) {
          console.error('[api.queue.setLoop] Tauri error:', error);
          throw new ApiError(500, error.toString());
        }
      }
      console.debug('Queue setLoop (no-op in browser):', mode);
    },
  },

  // ============================================
  // Favorites endpoints (uses Tauri commands)
  // ============================================

  favorites: {
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
  },

  // ============================================
  // Playback endpoints (if sidecar handles playback state)
  // ============================================

  playback: {
    /**
     * Get current playback state
     * @returns {Promise<{playing: boolean, position: number, track: object|null}>}
     */
    getState() {
      return request('/playback/state');
    },

    /**
     * Update playback position (for sync)
     * @param {number} position - Position in seconds
     * @returns {Promise<void>}
     */
    updatePosition(position) {
      return request('/playback/position', {
        method: 'POST',
        body: JSON.stringify({ position }),
      });
    },
  },

  // ============================================
  // Preferences endpoints
  // ============================================

  preferences: {
    /**
     * Get all preferences
     * @returns {Promise<object>}
     */
    get() {
      return request('/preferences');
    },

    /**
     * Update preferences
     * @param {object} prefs - Preferences to update
     * @returns {Promise<object>}
     */
    update(prefs) {
      return request('/preferences', {
        method: 'PATCH',
        body: JSON.stringify(prefs),
      });
    },

    /**
     * Get a specific preference
     * @param {string} key - Preference key
     * @returns {Promise<any>}
     */
    getValue(key) {
      return request(`/preferences/${encodeURIComponent(key)}`);
    },

    /**
     * Set a specific preference
     * @param {string} key - Preference key
     * @param {any} value - Preference value
     * @returns {Promise<void>}
     */
    setValue(key, value) {
      return request(`/preferences/${encodeURIComponent(key)}`, {
        method: 'PUT',
        body: JSON.stringify({ value }),
      });
    },
  },

  // ============================================
  // Playlists endpoints (uses Tauri commands)
  // ============================================

  playlists: {
    /**
     * Get all playlists (uses Tauri command)
     * @returns {Promise<Array>} Array of playlists
     */
    async getAll() {
      if (invoke) {
        try {
          const response = await invoke('playlist_list');
          return response.playlists || [];
        } catch (error) {
          console.error('[api.playlists.getAll] Tauri error:', error);
          throw new ApiError(500, error.toString());
        }
      }
      const response = await request('/playlists');
      return Array.isArray(response) ? response : (response.playlists || []);
    },

    /**
     * Generate a unique playlist name (uses Tauri command)
     * @param {string} [base='New playlist'] - Base name
     * @returns {Promise<{name: string}>}
     */
    async generateName(base = 'New playlist') {
      if (invoke) {
        try {
          return await invoke('playlist_generate_name', { base });
        } catch (error) {
          console.error('[api.playlists.generateName] Tauri error:', error);
          throw new ApiError(500, error.toString());
        }
      }
      const query = new URLSearchParams({ base });
      return request(`/playlists/generate-name?${query}`);
    },

    /**
     * Create a new playlist (uses Tauri command)
     * @param {string} name - Playlist name
     * @returns {Promise<{playlist: object|null}>}
     */
    async create(name) {
      if (invoke) {
        try {
          const response = await invoke('playlist_create', { name });
          return response.playlist;
        } catch (error) {
          console.error('[api.playlists.create] Tauri error:', error);
          throw new ApiError(500, error.toString());
        }
      }
      return request('/playlists', {
        method: 'POST',
        body: JSON.stringify({ name }),
      });
    },

    /**
     * Get a playlist with its tracks (uses Tauri command)
     * @param {number} playlistId - Playlist ID
     * @returns {Promise<object|null>}
     */
    async get(playlistId) {
      if (invoke) {
        try {
          return await invoke('playlist_get', { playlistId });
        } catch (error) {
          console.error('[api.playlists.get] Tauri error:', error);
          throw new ApiError(500, error.toString());
        }
      }
      return request(`/playlists/${playlistId}`);
    },

    /**
     * Rename a playlist (uses Tauri command)
     * @param {number} playlistId - Playlist ID
     * @param {string} name - New name
     * @returns {Promise<{playlist: object|null}>}
     */
    async rename(playlistId, name) {
      if (invoke) {
        try {
          return await invoke('playlist_update', { playlistId, name });
        } catch (error) {
          console.error('[api.playlists.rename] Tauri error:', error);
          throw new ApiError(500, error.toString());
        }
      }
      return request(`/playlists/${playlistId}`, {
        method: 'PUT',
        body: JSON.stringify({ name }),
      });
    },

    /**
     * Delete a playlist (uses Tauri command)
     * @param {number} playlistId - Playlist ID
     * @returns {Promise<{success: boolean}>}
     */
    async delete(playlistId) {
      if (invoke) {
        try {
          return await invoke('playlist_delete', { playlistId });
        } catch (error) {
          console.error('[api.playlists.delete] Tauri error:', error);
          throw new ApiError(500, error.toString());
        }
      }
      return request(`/playlists/${playlistId}`, {
        method: 'DELETE',
      });
    },

    /**
     * Add tracks to a playlist (uses Tauri command)
     * @param {number} playlistId - Playlist ID
     * @param {number[]} trackIds - Track IDs to add
     * @param {number} [position] - Position to insert at
     * @returns {Promise<{added: number, track_count: number}>}
     */
    async addTracks(playlistId, trackIds, position) {
      if (invoke) {
        try {
          return await invoke('playlist_add_tracks', {
            playlistId,
            trackIds,
            position: position ?? null,
          });
        } catch (error) {
          console.error('[api.playlists.addTracks] Tauri error:', error);
          throw new ApiError(500, error.toString());
        }
      }
      return request(`/playlists/${playlistId}/tracks`, {
        method: 'POST',
        body: JSON.stringify({ track_ids: trackIds }),
      });
    },

    /**
     * Remove a track from a playlist (uses Tauri command)
     * @param {number} playlistId - Playlist ID
     * @param {number} position - Position of track to remove
     * @returns {Promise<{success: boolean}>}
     */
    async removeTrack(playlistId, position) {
      if (invoke) {
        try {
          return await invoke('playlist_remove_track', { playlistId, position });
        } catch (error) {
          console.error('[api.playlists.removeTrack] Tauri error:', error);
          throw new ApiError(500, error.toString());
        }
      }
      return request(`/playlists/${playlistId}/tracks/${position}`, {
        method: 'DELETE',
      });
    },

    /**
     * Reorder tracks within a playlist (uses Tauri command)
     * @param {number} playlistId - Playlist ID
     * @param {number} fromPosition - Current position
     * @param {number} toPosition - New position
     * @returns {Promise<{success: boolean}>}
     */
    async reorder(playlistId, fromPosition, toPosition) {
      if (invoke) {
        try {
          return await invoke('playlist_reorder_tracks', {
            playlistId,
            fromPosition,
            toPosition,
          });
        } catch (error) {
          console.error('[api.playlists.reorder] Tauri error:', error);
          throw new ApiError(500, error.toString());
        }
      }
      return request(`/playlists/${playlistId}/tracks/reorder`, {
        method: 'POST',
        body: JSON.stringify({ from_position: fromPosition, to_position: toPosition }),
      });
    },

    /**
     * Reorder playlists in sidebar (uses Tauri command)
     * @param {number} fromPosition - Current position
     * @param {number} toPosition - New position
     * @returns {Promise<{success: boolean}>}
     */
    async reorderPlaylists(fromPosition, toPosition) {
      if (invoke) {
        try {
          return await invoke('playlists_reorder', { fromPosition, toPosition });
        } catch (error) {
          console.error('[api.playlists.reorderPlaylists] Tauri error:', error);
          throw new ApiError(500, error.toString());
        }
      }
      return request('/playlists/reorder', {
        method: 'POST',
        body: JSON.stringify({ from_position: fromPosition, to_position: toPosition }),
      });
    },
  },

  // ============================================
  // Last.fm endpoints (uses Tauri commands)
  // ============================================

  lastfm: {
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
  },

  watchedFolders: {
    list() {
      return request('/watched-folders');
    },

    get(id) {
      return request(`/watched-folders/${id}`);
    },

    add(path, mode = 'continuous', cadenceMinutes = 10, enabled = true) {
      return request('/watched-folders', {
        method: 'POST',
        body: JSON.stringify({
          path,
          mode,
          cadence_minutes: cadenceMinutes,
          enabled,
        }),
      });
    },

    update(id, updates) {
      return request(`/watched-folders/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(updates),
      });
    },

    remove(id) {
      return request(`/watched-folders/${id}`, {
        method: 'DELETE',
      });
    },

    rescan(id) {
      return request(`/watched-folders/${id}/rescan`, {
        method: 'POST',
      });
    },
  },

  // ============================================
  // Settings endpoints (uses Tauri Store API)
  // ============================================

  settings: {
    /**
     * Get all settings (uses Tauri command)
     * @returns {Promise<{settings: object}>}
     */
    async getAll() {
      if (invoke) {
        try {
          return await invoke('settings_get_all');
        } catch (error) {
          console.error('[api.settings.getAll] Tauri error:', error);
          throw new ApiError(500, error.toString());
        }
      }
      // Fallback to HTTP (for backwards compatibility)
      return request('/settings');
    },

    /**
     * Get a single setting (uses Tauri command)
     * @param {string} key - Setting key
     * @returns {Promise<{key: string, value: any}>}
     */
    async get(key) {
      if (invoke) {
        try {
          return await invoke('settings_get', { key });
        } catch (error) {
          console.error('[api.settings.get] Tauri error:', error);
          throw new ApiError(500, error.toString());
        }
      }
      return request(`/settings/${encodeURIComponent(key)}`);
    },

    /**
     * Set a single setting (uses Tauri command)
     * @param {string} key - Setting key
     * @param {any} value - Setting value
     * @returns {Promise<{key: string, value: any}>}
     */
    async set(key, value) {
      if (invoke) {
        try {
          return await invoke('settings_set', { key, value });
        } catch (error) {
          console.error('[api.settings.set] Tauri error:', error);
          throw new ApiError(500, error.toString());
        }
      }
      return request(`/settings/${encodeURIComponent(key)}`, {
        method: 'PUT',
        body: JSON.stringify({ value }),
      });
    },

    /**
     * Update multiple settings at once (uses Tauri command)
     * @param {object} settings - Settings to update
     * @param {number} [settings.volume] - Volume (0-100)
     * @param {boolean} [settings.shuffle] - Shuffle enabled
     * @param {string} [settings.loop_mode] - Loop mode ("none", "all", "one")
     * @param {string} [settings.theme] - Theme name
     * @param {number} [settings.sidebar_width] - Sidebar width (100-500)
     * @param {number} [settings.queue_panel_height] - Queue panel height (100-800)
     * @returns {Promise<{updated: string[]}>}
     */
    async update(settings) {
      if (invoke) {
        try {
          return await invoke('settings_update', { settings });
        } catch (error) {
          console.error('[api.settings.update] Tauri error:', error);
          throw new ApiError(500, error.toString());
        }
      }
      return request('/settings', {
        method: 'PUT',
        body: JSON.stringify(settings),
      });
    },

    /**
     * Reset all settings to defaults (uses Tauri command)
     * @returns {Promise<{settings: object}>}
     */
    async reset() {
      if (invoke) {
        try {
          return await invoke('settings_reset');
        } catch (error) {
          console.error('[api.settings.reset] Tauri error:', error);
          throw new ApiError(500, error.toString());
        }
      }
      return request('/settings/reset', {
        method: 'POST',
      });
    },
  },
};

export default api;
