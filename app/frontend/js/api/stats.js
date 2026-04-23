/**
 * Stats API
 *
 * Listening statistics and chart grid generation.
 */

import { tauriInvoke } from './shared.js';

export const stats = {
  /**
   * Get listening statistics overview
   * @param {string} range - 'AllTime', 'Last7Days', or 'Last30Days'
   * @returns {Promise<{total_plays: number, total_tracks_played: number, total_artists_played: number, total_listening_time: number}>}
   */
  async getOverview(range = 'AllTime') {
    const result = await tauriInvoke('stats_get_overview', { range });
    if (result !== null) return result;
    throw new Error('Stats require Tauri runtime');
  },

  /**
   * Get top artists by play count
   * @param {string} range - Date range
   * @param {number} [limit=25] - Max results
   * @returns {Promise<Array<{artist: string, play_count: number, track_id: number|null}>>}
   */
  async getTopArtists(range = 'AllTime', limit = 25) {
    const result = await tauriInvoke('stats_get_top_artists', { range, limit });
    if (result !== null) return result;
    throw new Error('Stats require Tauri runtime');
  },

  /**
   * Get genre breakdown
   * @param {string} range - Date range
   * @param {number} [limit=20] - Max results
   * @returns {Promise<Array<{genre: string, play_count: number, track_count: number}>>}
   */
  async getGenres(range = 'AllTime', limit = 20) {
    const result = await tauriInvoke('stats_get_genres', { range, limit });
    if (result !== null) return result;
    throw new Error('Stats require Tauri runtime');
  },

  /**
   * Get plays over time
   * @param {string} range - Date range
   * @returns {Promise<Array<{label: string, count: number}>>}
   */
  async getPlaysOverTime(range = 'AllTime') {
    const result = await tauriInvoke('stats_get_plays_over_time', { range });
    if (result !== null) return result;
    throw new Error('Stats require Tauri runtime');
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
    const result = await tauriInvoke('stats_generate_chart_grid', { request });
    if (result !== null) return result;
    throw new Error('Stats require Tauri runtime');
  },
};
