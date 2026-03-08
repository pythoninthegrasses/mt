/**
 * Stats View Component
 *
 * Listening statistics dashboard with artist rankings, genre breakdown,
 * plays-over-time chart, and album art chart grid generator.
 */

import { stats } from '../api/stats.js';
import { library } from '../api/library.js';

export function createStatsView(Alpine) {
  Alpine.data('statsView', () => ({
    dateRange: 'AllTime',
    loading: false,

    overview: null,
    topArtists: [],
    genres: [],
    playsOverTime: [],
    artistArtwork: {},

    chartGrid: {
      rows: 3,
      columns: 3,
      cellSize: 300,
      padding: 2,
      sortBy: 'play_count',
      generating: false,
      imageDataUrl: null,
    },

    async init() {
      await this.loadStats();
    },

    async loadStats() {
      this.loading = true;
      try {
        const [overview, topArtists, genres, playsOverTime] = await Promise.all([
          stats.getOverview(this.dateRange),
          stats.getTopArtists(this.dateRange, 25),
          stats.getGenres(this.dateRange, 20),
          stats.getPlaysOverTime(this.dateRange),
        ]);

        this.overview = overview;
        this.topArtists = topArtists;
        this.genres = genres;
        this.playsOverTime = playsOverTime;

        this.loadArtistArtwork(topArtists);
      } catch (error) {
        console.error('[stats] Failed to load stats:', error);
        Alpine.store('ui').toast('Failed to load statistics', 'error');
      } finally {
        this.loading = false;
      }
    },

    async loadArtistArtwork(artists) {
      for (const artist of artists) {
        if (artist.track_id && !this.artistArtwork[artist.track_id]) {
          try {
            const url = await library.getArtworkUrl(artist.track_id);
            if (url) {
              this.artistArtwork[artist.track_id] = url;
            }
          } catch (_e) {
            // Artwork loading is best-effort
          }
        }
      }
    },

    async onDateRangeChange() {
      await this.loadStats();
    },

    maxArtistPlays() {
      if (!this.topArtists.length) return 1;
      return this.topArtists[0]?.play_count || 1;
    },

    artistBarWidth(playCount) {
      const pct = (playCount / this.maxArtistPlays()) * 100;
      return `width: ${Math.max(pct, 2)}%`;
    },

    maxPlaysInTimePeriod() {
      if (!this.playsOverTime.length) return 1;
      return Math.max(...this.playsOverTime.map((p) => p.count)) || 1;
    },

    timeBarWidth(count) {
      const pct = (count / this.maxPlaysInTimePeriod()) * 100;
      return `width: ${Math.max(pct, 2)}%`;
    },

    formatDuration(seconds) {
      if (!seconds || seconds <= 0) return '0m';
      const days = Math.floor(seconds / 86400);
      const hours = Math.floor((seconds % 86400) / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);

      if (days > 0) return `${days}d ${hours}h`;
      if (hours > 0) return `${hours}h ${minutes}m`;
      return `${minutes}m`;
    },

    async generateChartGrid() {
      this.chartGrid.generating = true;
      try {
        const url = await stats.generateChartGrid({
          rows: this.chartGrid.rows,
          columns: this.chartGrid.columns,
          cell_size: this.chartGrid.cellSize,
          padding: this.chartGrid.padding,
          sort_by: this.chartGrid.sortBy,
          date_range: this.dateRange,
        });
        this.chartGrid.imageDataUrl = url;
      } catch (error) {
        console.error('[stats] Failed to generate chart grid:', error);
        Alpine.store('ui').toast('Failed to generate chart grid', 'error');
      } finally {
        this.chartGrid.generating = false;
      }
    },

    async exportChartGrid() {
      if (!this.chartGrid.imageDataUrl || !window.__TAURI__) return;

      try {
        const { save } = window.__TAURI__.dialog;
        const path = await save({
          defaultPath: `chart_${this.chartGrid.rows}x${this.chartGrid.columns}.png`,
          filters: [{ name: 'PNG Images', extensions: ['png'] }],
        });

        if (!path) return;

        // Convert data URL to bytes and write
        const base64Data = this.chartGrid.imageDataUrl.split(',')[1];
        const binaryString = atob(base64Data);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }

        const { writeFile } = window.__TAURI__.fs;
        await writeFile(path, bytes);
        Alpine.store('ui').toast('Chart exported', 'success');
      } catch (error) {
        console.error('[stats] Failed to export chart grid:', error);
        Alpine.store('ui').toast('Failed to export chart grid', 'error');
      }
    },
  }));
}
