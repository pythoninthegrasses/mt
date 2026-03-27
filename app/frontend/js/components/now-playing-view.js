import { queueDragReorderMixin } from '../mixins/queue-drag-reorder.js';
import { lyrics as lyricsApi } from '../api/lyrics.js';

export function createNowPlayingView(Alpine) {
  Alpine.data('nowPlayingView', () => ({
    ...queueDragReorderMixin(),

    // Lyrics state
    lyrics: null,
    lyricsLoading: false,
    _lyricsTrackKey: null,
    _lyricsFetchId: 0,
    _lyricsScrollTop: 0,
    _lyricsCanScrollMore: false,
    _lyricsContentWidth: null,
    _lyricsLayoutObserver: null,

    // Virtual scroll state
    _rowHeight: 41,
    _scrollTop: 0,
    _containerHeight: 0,
    _bufferRows: 10,
    _rafId: null,
    _resizeObserver: null,

    init() {
      const container = this.$refs.queueList;
      if (container) {
        this._containerHeight = container.clientHeight;
        container.addEventListener('scroll', () => this._onScroll(), { passive: true });

        this._resizeObserver = new ResizeObserver(() => {
          this._containerHeight = container.clientHeight;
        });
        this._resizeObserver.observe(container);
      }

      // Watch for track changes and view visibility to fetch lyrics
      this.$watch('$store.player.currentTrack', () => this._onTrackOrViewChange());
      this.$watch('$store.ui.view', () => this._onTrackOrViewChange());
    },

    destroy() {
      if (this._resizeObserver) {
        this._resizeObserver.disconnect();
        this._resizeObserver = null;
      }
      if (this._lyricsLayoutObserver) {
        this._lyricsLayoutObserver.disconnect();
        this._lyricsLayoutObserver = null;
      }
      if (this._rafId) {
        cancelAnimationFrame(this._rafId);
        this._rafId = null;
      }
    },

    _onTrackOrViewChange() {
      const track = this.$store.player.currentTrack;
      const isVisible = this.$store.ui.view === 'nowPlaying';

      if (!track || !isVisible) {
        return;
      }

      // Build a cache key from artist+title to detect track changes
      const trackKey = `${track.artist || ''}::${track.title || ''}`;

      if (trackKey === this._lyricsTrackKey) {
        return;
      }

      this._lyricsTrackKey = trackKey;
      this._fetchLyrics(track);
    },

    async _fetchLyrics(track) {
      const fetchId = ++this._lyricsFetchId;
      this.lyrics = null;
      this._lyricsContentWidth = null;
      this.lyricsLoading = true;

      try {
        const durationSecs = track.duration ? Math.round(track.duration / 1000) : null;
        const result = await lyricsApi.get({
          artist: track.artist || '',
          title: track.title || '',
          album: track.album || '',
          duration: durationSecs,
        });

        // Check if this fetch was superseded
        if (this._lyricsFetchId !== fetchId) return;

        if (result && result.plain_lyrics) {
          this.lyrics = result.plain_lyrics;
          this.$nextTick(() => this._updateLyricsScrollState());
        } else {
          this.lyrics = null;
        }
      } catch (error) {
        console.error('[now-playing] Failed to fetch lyrics:', error);
        if (this._lyricsFetchId !== fetchId) return;
        this.lyrics = null;
      } finally {
        if (this._lyricsFetchId === fetchId) {
          this.lyricsLoading = false;
        }
      }
    },

    _onLyricsScroll(event) {
      const el = event.target;
      this._lyricsScrollTop = el.scrollTop;
      this._lyricsCanScrollMore = el.scrollTop + el.clientHeight < el.scrollHeight - 10;
    },

    _updateLyricsScrollState() {
      const panel = this.$refs.lyricsPanel;
      if (!panel) return;
      panel.scrollTop = 0;
      this._lyricsScrollTop = 0;
      this._lyricsCanScrollMore = panel.scrollHeight > panel.clientHeight + 10;
      this._measureLyricsWidth();
      this._observeLyricsLayout();
    },

    _measureLyricsWidth() {
      const panel = this.$refs.lyricsPanel;
      if (!panel) return;
      const p = panel.querySelector('[data-testid="lyrics-text"]');
      if (!p) return;
      const prev = p.style.width;
      p.style.width = 'max-content';
      // Add padding (pr-2 = 8px) to the measured text width
      this._lyricsContentWidth = p.offsetWidth + 8;
      p.style.width = prev;
    },

    _observeLyricsLayout() {
      if (this._lyricsLayoutObserver) return;
      const layout = this.$el.querySelector('[data-testid="lyrics-layout"]');
      if (!layout) return;
      this._lyricsLayoutObserver = new ResizeObserver(() => {
        if (this.lyrics) this._measureLyricsWidth();
      });
      this._lyricsLayoutObserver.observe(layout);
    },

    _onScroll() {
      if (this._rafId) return;
      this._rafId = requestAnimationFrame(() => {
        const container = this.$refs.queueList;
        if (container) {
          this._scrollTop = container.scrollTop;
          this._containerHeight = container.clientHeight;
        }
        this._rafId = null;
      });
    },

    get queueStartIndex() {
      const items = this.$store.queue.playOrderItems;
      if (items.length === 0) return 0;
      return Math.max(0, Math.floor(this._scrollTop / this._rowHeight) - this._bufferRows);
    },

    get queueEndIndex() {
      const items = this.$store.queue.playOrderItems;
      if (items.length === 0) return 0;
      const visibleRows = Math.ceil(this._containerHeight / this._rowHeight);
      return Math.min(
        items.length,
        Math.floor(this._scrollTop / this._rowHeight) + visibleRows + this._bufferRows,
      );
    },

    get visibleQueueItems() {
      const items = this.$store.queue.playOrderItems;
      const end = Math.min(this.queueEndIndex, items.length);
      const result = [];
      for (let i = this.queueStartIndex; i < end; i++) {
        result.push({ ...items[i], displayIndex: i });
      }
      return result;
    },

    get queueTotalHeight() {
      return this.$store.queue.playOrderItems.length * this._rowHeight;
    },

    get queueOffsetY() {
      return this.queueStartIndex * this._rowHeight;
    },
  }));
}

export default createNowPlayingView;
