/**
 * Stats API
 *
 * Listening statistics and chart grid generation.
 */

import { ApiError, invoke } from './shared.js';

export const stats = {
  /**
   * Get listening statistics overview
   * @param {string} range - 'AllTime', 'Last7Days', or 'Last30Days'
   * @returns {Promise<{total_plays: number, total_tracks_played: number, total_artists_played: number, total_listening_time: number}>}
   */
  async getOverview(range = 'AllTime') {
    if (invoke) {
      try {
        return await invoke('stats_get_overview', { range });
      } catch (error) {
        console.error('[api.stats.getOverview] Tauri error:', error);
        throw new ApiError(500, error.toString());
      }
    }
    throw new ApiError(0, 'Stats require Tauri runtime');
  },

  /**
   * Get top artists by play count
   * @param {string} range - Date range
   * @param {number} [limit=25] - Max results
   * @returns {Promise<Array<{artist: string, play_count: number, track_id: number|null}>>}
   */
  async getTopArtists(range = 'AllTime', limit = 25) {
    if (invoke) {
      try {
        return await invoke('stats_get_top_artists', { range, limit });
      } catch (error) {
        console.error('[api.stats.getTopArtists] Tauri error:', error);
        throw new ApiError(500, error.toString());
      }
    }
    throw new ApiError(0, 'Stats require Tauri runtime');
  },

  /**
   * Get genre breakdown
   * @param {string} range - Date range
   * @param {number} [limit=20] - Max results
   * @returns {Promise<Array<{genre: string, play_count: number, track_count: number}>>}
   */
  async getGenres(range = 'AllTime', limit = 20) {
    if (invoke) {
      try {
        return await invoke('stats_get_genres', { range, limit });
      } catch (error) {
        console.error('[api.stats.getGenres] Tauri error:', error);
        throw new ApiError(500, error.toString());
      }
    }
    throw new ApiError(0, 'Stats require Tauri runtime');
  },

  /**
   * Get plays over time
   * @param {string} range - Date range
   * @returns {Promise<Array<{label: string, count: number}>>}
   */
  async getPlaysOverTime(range = 'AllTime') {
    if (invoke) {
      try {
        return await invoke('stats_get_plays_over_time', { range });
      } catch (error) {
        console.error('[api.stats.getPlaysOverTime] Tauri error:', error);
        throw new ApiError(500, error.toString());
      }
    }
    throw new ApiError(0, 'Stats require Tauri runtime');
  },

  /**
   * Generate chart grid image
   * @param {object} request - Chart grid parameters
   * @param {number} request.rows - Number of rows
   * @param {number} request.columns - Number of columns
   * @param {number} request.cell_size - Cell size in pixels
   * @param {number} request.padding - Padding between cells
   * @param {string} request.sort_by - Sort field ('play_count', 'album', 'artist')
   * @param {string} request.date_range - Date range
   * @returns {Promise<string>} Data URL (data:image/png;base64,...)
   */
  async generateChartGrid(request) {
    if (invoke) {
      try {
        return await invoke('stats_generate_chart_grid', { request });
      } catch (error) {
        console.error('[api.stats.generateChartGrid] Tauri error:', error);
        throw new ApiError(500, error.toString());
      }
    }
    throw new ApiError(0, 'Stats require Tauri runtime');
  },
};
