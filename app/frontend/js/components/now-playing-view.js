import { queueDragReorderMixin } from '../mixins/queue-drag-reorder.js';
import { singleTrackContextMenuMixin } from '../mixins/single-track-context-menu.js';
import { lyrics as lyricsApi } from '../api/lyrics.js';
import { favorites } from '../api/favorites.js';

export function createNowPlayingView(Alpine) {
  Alpine.data('nowPlayingView', () => ({
    ...queueDragReorderMixin(),
    ...singleTrackContextMenuMixin(),

    // Context menu state
    contextMenu: null,
    playlists: [],
    showPlaylistSubmenu: false,
    submenuOnLeft: false,
    submenuY: 0,
    submenuCloseTimeout: null,

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

    get queue() {
      return this.$store.queue;
    },

    get library() {
      return this.$store.library;
    },

    get player() {
      return this.$store.player;
    },

    get ui() {
      return this.$store.ui;
    },

    // Override mixin's handleContextMenu with queue-specific menu items
    handleContextMenu(event, track, originalIndex) {
      event.preventDefault();

      const isCurrentTrack = originalIndex === this.$store.queue.currentIndex;

      const menuItems = [
        { label: 'Play Now', action: () => this._ctxPlayInQueue(originalIndex) },
        {
          label: 'Play Next',
          action: () => this._ctxPlayNextInQueue(track),
          disabled: isCurrentTrack,
        },
        { type: 'separator' },
        {
          label: 'Add to Playlist',
          hasSubmenu: true,
          action: () => {
            this.showPlaylistSubmenu = !this.showPlaylistSubmenu;
          },
        },
        { label: 'Add to Liked Songs', action: () => this._ctxToggleFavorite(track) },
        { type: 'separator' },
        { label: 'Show in Finder', action: () => this._ctxShowInFinder(track) },
        { type: 'separator' },
        {
          label: 'Remove from Queue',
          danger: true,
          action: () => this._ctxRemoveFromQueue(originalIndex),
          disabled: isCurrentTrack,
        },
      ];

      // Check favorite status and update label
      favorites.check(track.id).then((result) => {
        if (!this.contextMenu) return;
        const favoriteItem = this.contextMenu.items.find(
          (i) => i.label === 'Add to Liked Songs' || i.label === 'Remove from Liked Songs',
        );
        if (favoriteItem) {
          favoriteItem.label = result.is_favorite
            ? 'Remove from Liked Songs'
            : 'Add to Liked Songs';
        }
      }).catch(() => {});

      const menuHeight = 280;
      const menuWidth = 200;
      const submenuWidth = 200;
      let x = event.clientX;
      let y = event.clientY;

      if (x + menuWidth > window.innerWidth) {
        x = window.innerWidth - menuWidth - 10;
      }
      if (y + menuHeight > window.innerHeight) {
        y = window.innerHeight - menuHeight - 10;
      }

      this.contextMenu = { x, y, track, items: menuItems };
      this.showPlaylistSubmenu = false;
      this.submenuOnLeft = (x + menuWidth + 45 + submenuWidth) > window.innerWidth;
    },

    _ctxPlayInQueue(originalIndex) {
      this.closeContextMenu();
      this.$store.queue.playIndex(originalIndex);
    },

    async _ctxPlayNextInQueue(track) {
      this.closeContextMenu();
      await this.$store.queue.playNextTracks([track]);
      this.$store.ui.toast('Playing next', 'success');
    },

    _ctxRemoveFromQueue(originalIndex) {
      this.closeContextMenu();
      this.$store.queue.remove(originalIndex);
    },

    init() {
      this._loadPlaylists();
      this._onPlaylistsUpdated = () => this._loadPlaylists();
      window.addEventListener('mt:playlists-updated', this._onPlaylistsUpdated);

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

      // Listen for scroll-to-current-track requests from the bottom bar
      this._scrollToCurrentHandler = () => this.scrollToCurrentTrack();
      window.addEventListener('mt:scroll-to-current-in-queue', this._scrollToCurrentHandler);
    },

    destroy() {
      if (this._onPlaylistsUpdated) {
        window.removeEventListener('mt:playlists-updated', this._onPlaylistsUpdated);
        this._onPlaylistsUpdated = null;
      }
      if (this._scrollToCurrentHandler) {
        window.removeEventListener('mt:scroll-to-current-in-queue', this._scrollToCurrentHandler);
        this._scrollToCurrentHandler = null;
      }
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
      let measured = p.offsetWidth + 8;
      p.style.width = prev;

      // Cap to available space so lyrics wrap instead of pushing the queue off-viewport.
      // Layout: album art (w-80 = 320px) + gap-10 (40px) + pl-4 (16px) = 376px fixed.
      const layout = this.$el.querySelector('[data-testid="lyrics-layout"]');
      if (layout) {
        const maxAvailable = layout.clientWidth - 376;
        if (maxAvailable > 0 && measured > maxAvailable) {
          measured = maxAvailable;
        }
      }

      this._lyricsContentWidth = measured;
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

    scrollToCurrentTrack() {
      const container = this.$refs.queueList;
      if (!container) return;

      // Current track is always at index 0 in playOrderItems
      container.scrollTo({ top: 0, behavior: 'smooth' });

      // Flash highlight on the current track row after scroll completes
      const flashCurrentRow = () => {
        const currentRow = container.querySelector('.queue-item.bg-primary\\/20');
        if (currentRow) {
          currentRow.classList.remove('queue-highlight-flash');
          void currentRow.offsetWidth; // force reflow for re-trigger
          currentRow.classList.add('queue-highlight-flash');
          currentRow.addEventListener(
            'animationend',
            () => currentRow.classList.remove('queue-highlight-flash'),
            { once: true },
          );
        }
      };

      // Use scrollend if supported, otherwise fall back to a short delay
      if ('onscrollend' in window) {
        container.addEventListener('scrollend', flashCurrentRow, { once: true });
      } else {
        setTimeout(flashCurrentRow, 300);
      }
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
