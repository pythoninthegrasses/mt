/**
 * Playlists API
 *
 * Playlist CRUD, track management, and reordering operations.
 */

import { ApiError, invoke, request } from './shared.js';

export const playlists = {
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
};
