/**
 * PlaylistsAPI
 *
 * Playlist CRUD, track management, and reordering operations.
 */

import { request, tauriInvoke } from './shared.js';

export const playlists = {
  /**
   * Get all playlists (uses Tauri command)
   * @returns {Promise<Array>} Array of playlists
   */
  async getAll() {
    const result = await tauriInvoke('playlist_list');
    if (result !== null) return result.playlists || [];
    const response = await request('/playlists');
    return Array.isArray(response) ? response : (response.playlists || []);
  },

  /**
   * Generate a unique playlist name (uses Tauri command)
   * @param {string} [base='New playlist'] - Base name
   * @returns {Promise<{name: string}>}
   */
  async generateName(base = 'New playlist') {
    const result = await tauriInvoke('playlist_generate_name', { base });
    if (result !== null) return result;
    const query = new URLSearchParams({ base });
    return request(`/playlists/generate-name?${query}`);
  },

  /**
   * Create a new playlist (uses Tauri command)
   * @param {string} name - Playlist name
   * @returns {Promise<{playlist: object|null}>}
   */
  async create(name) {
    const result = await tauriInvoke('playlist_create', { name });
    if (result !== null) return result.playlist;
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
    const result = await tauriInvoke('playlist_get', { playlistId });
    if (result !== null) return result;
    return request(`/playlists/${playlistId}`);
  },

  /**
   * Rename a playlist (uses Tauri command)
   * @param {number} playlistId - Playlist ID
   * @param {string} name - New name
   * @returns {Promise<{playlist: object|null}>}
   */
  async rename(playlistId, name) {
    const result = await tauriInvoke('playlist_update', { playlistId, name });
    if (result !== null) return result;
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
    const result = await tauriInvoke('playlist_delete', { playlistId });
    if (result !== null) return result;
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
    const result = await tauriInvoke('playlist_add_tracks', {
      playlistId,
      trackIds,
      position: position ?? null,
    });
    if (result !== null) return result;
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
    const result = await tauriInvoke('playlist_remove_track', { playlistId, position });
    if (result !== null) return result;
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
    const result = await tauriInvoke('playlist_reorder_tracks', {
      playlistId,
      fromPosition,
      toPosition,
    });
    if (result !== null) return result;
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
    const result = await tauriInvoke('playlists_reorder', { fromPosition, toPosition });
    if (result !== null) return result;
    return request('/playlists/reorder', {
      method: 'POST',
      body: JSON.stringify({ from_position: fromPosition, to_position: toPosition }),
    });
  },
};
