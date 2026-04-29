/**
 * Stats View Component
 *
 * Listening statistics dashboard with artist rankings, genre breakdown,
 * plays-over-time chart, and album art chart grid generator.
 * Layout inspired by Last.fm's library statistics page.
 */

import { stats } from '../api/stats.js';
import { library } from '../api/library.js';
import { tauriInvoke } from '../api/shared.js';
import { formatDurationShorthand } from '../utils/formatting.js';

const DATE_RANGE_OPTIONS = [
  { value: 'Last7Days', label: 'Last 7 days' },
  { value: 'Last30Days', label: 'Last 30 days' },
  { value: 'Last90Days', label: 'Last 90 days' },
  { value: 'Last180Days', label: 'Last 180 days' },
  { value: 'Last365Days', label: 'Last 365 days' },
  { value: 'AllTime', label: 'All time' },
];

const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

export function createStatsView(Alpine) {
  Alpine.data('statsView', () => ({
    dateRange: 'AllTime',
    dateDropdownOpen: false,
    dateRangeOptions: DATE_RANGE_OPTIONS,
    loading: false,

    // Scroll state for gradient overlays
    _artistsScrollTop: 0,
    _artistsCanScrollMore: false,

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

        // Update scroll state after DOM renders
        this.$nextTick(() => this._updateArtistsScrollState());
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

    _onArtistsScroll(event) {
      const el = event.target;
      this._artistsScrollTop = el.scrollTop;
      this._artistsCanScrollMore = el.scrollTop + el.clientHeight < el.scrollHeight - 10;
    },

    _updateArtistsScrollState() {
      const panel = this.$refs.artistsPanel;
      if (!panel) return;
      this._artistsScrollTop = panel.scrollTop;
      this._artistsCanScrollMore = panel.scrollHeight > panel.clientHeight + 10;
    },

    dateRangeLabel() {
      const opt = DATE_RANGE_OPTIONS.find((o) => o.value === this.dateRange);
      return opt ? opt.label : this.dateRange;
    },

    selectDateRange(value) {
      this.dateRange = value;
      this.dateDropdownOpen = false;
      this.loadStats();
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

    /**
     * Format time period labels for display.
     * "2024" -> "2024", "2024-03" -> "Mar 2024", "2024-03-15" -> "15 Mar"
     */
    formatTimeLabel(label) {
      if (!label) return '';
      const parts = label.split('-');
      if (parts.length === 1) return label; // Year only
      if (parts.length === 2) {
        const monthIdx = parseInt(parts[1], 10) - 1;
        return `${MONTH_NAMES[monthIdx]} ${parts[0]}`;
      }
      // Full date: show "15 Mar"
      const monthIdx = parseInt(parts[1], 10) - 1;
      return `${parseInt(parts[2], 10)} ${MONTH_NAMES[monthIdx]}`;
    },

    formatDuration: formatDurationShorthand,

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

        const base64Data = this.chartGrid.imageDataUrl.split(',')[1];
        await tauriInvoke('save_file', { path, base64Data });
        Alpine.store('ui').toast('Chart exported', 'success');
      } catch (error) {
        console.error('[stats] Failed to export chart grid:', error);
        Alpine.store('ui').toast('Failed to export chart grid', 'error');
      }
    },
  }));
}
