/**
 * Albums Browser Component
 *
 * Provides album grid and album detail views, modeled after iTunes/Apple Music.
 * Two states: grid (responsive album cards) and detail (single album with track list).
 */

import { api } from '../api.js';
import { formatDuration } from '../utils/formatting.js';

export function createAlbumsBrowser(Alpine) {
  Alpine.data('albumsBrowser', () => ({
    // View state: 'grid' or 'detail'
    subView: 'grid',

    // Album detail state
    selectedAlbum: null,
    selectedAlbumTracks: [],
    selectedAlbumArtwork: null,

    // Artwork cache for grid cards: { albumName: { url, trackId } }
    artworkCache: {},

    // IntersectionObserver for lazy loading
    _observer: null,

    // Scroll position preservation
    _gridScrollTop: 0,

    // Context menu
    contextMenu: null,

    init() {
      this._setupLazyLoading();
    },

    destroy() {
      if (this._observer) {
        this._observer.disconnect();
        this._observer = null;
      }
    },

    get library() {
      return this.$store.library;
    },
    get queue() {
      return this.$store.queue;
    },
    get ui() {
      return this.$store.ui;
    },
    get player() {
      return this.$store.player;
    },

    isPlaying(trackId) {
      return this.player.currentTrack?.id === trackId;
    },

    /**
     * Get album data enriched with metadata from first track
     */
    get albumList() {
      const tracksByAlbum = this.library.tracksByAlbum;
      const albums = [];

      for (const [albumName, tracks] of Object.entries(tracksByAlbum)) {
        const firstTrack = tracks[0];
        albums.push({
          name: albumName,
          artist: firstTrack.album_artist || firstTrack.artist || 'Unknown Artist',
          year: firstTrack.date ? String(firstTrack.date).slice(0, 4) : '',
          genre: firstTrack.genre || '',
          trackCount: tracks.length,
          firstTrackId: firstTrack.id,
          totalDuration: tracks.reduce((sum, t) => sum + (t.duration || 0), 0),
        });
      }

      albums.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
      return albums;
    },

    // --- Lazy Artwork Loading ---

    _setupLazyLoading() {
      this._observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) {
              const card = entry.target;
              const trackId = card.dataset.trackId;
              const albumName = card.dataset.albumName;
              if (trackId && albumName) {
                this._loadArtwork(albumName, parseInt(trackId, 10), card);
              }
              this._observer.unobserve(card);
            }
          }
        },
        { rootMargin: '200px' },
      );
    },

    observeCard(el, albumName, trackId) {
      if (!el || !this._observer) return;
      el.dataset.trackId = trackId;
      el.dataset.albumName = albumName;

      // Check cache first
      if (this.artworkCache[albumName]) {
        return;
      }

      this._observer.observe(el);
    },

    async _loadArtwork(albumName, trackId, _card) {
      if (this.artworkCache[albumName]) return;

      try {
        const url = await api.library.getArtworkUrl(trackId);
        this.artworkCache[albumName] = url || null;
      } catch {
        this.artworkCache[albumName] = null;
      }
    },

    getArtworkUrl(albumName) {
      return this.artworkCache[albumName] || null;
    },

    // --- Navigation ---

    openAlbumDetail(album) {
      // Save scroll position
      const grid = this.$refs.gridContainer;
      if (grid) {
        this._gridScrollTop = grid.scrollTop;
      }

      this.selectedAlbum = album;
      this.selectedAlbumTracks = this._getAlbumTracks(album.name);
      this._loadDetailArtwork(album.firstTrackId);
      this.subView = 'detail';
    },

    backToGrid() {
      this.subView = 'grid';
      this.selectedAlbum = null;
      this.selectedAlbumTracks = [];
      this.selectedAlbumArtwork = null;

      // Restore scroll position
      this.$nextTick(() => {
        const grid = this.$refs.gridContainer;
        if (grid) {
          grid.scrollTop = this._gridScrollTop;
        }
      });
    },

    navigateToArtist(artistName) {
      this.ui.setView('artists');
      // Emit event for the artists view to pick up
      window.dispatchEvent(
        new CustomEvent('mt:navigate-to-artist', { detail: { artist: artistName } }),
      );
    },

    // --- Album Detail ---

    _getAlbumTracks(albumName) {
      const tracks = this.library.tracksByAlbum[albumName] || [];
      return [...tracks].sort((a, b) => {
        // Sort by disc number then track number
        const discA = a.disc_number || 1;
        const discB = b.disc_number || 1;
        if (discA !== discB) return discA - discB;
        const trackA = a.track_number || 0;
        const trackB = b.track_number || 0;
        return trackA - trackB;
      });
    },

    async _loadDetailArtwork(trackId) {
      try {
        this.selectedAlbumArtwork = await api.library.getArtworkUrl(trackId);
      } catch {
        this.selectedAlbumArtwork = null;
      }
    },

    formatTrackDuration(seconds) {
      return formatDuration(seconds);
    },

    formatTotalDuration(seconds) {
      const hours = Math.floor(seconds / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);
      if (hours > 0) {
        return `${hours} hr ${minutes} min`;
      }
      return `${minutes} min`;
    },

    // --- Playback ---

    async playAlbum(album) {
      const tracks = this._getAlbumTracks(album.name);
      if (tracks.length === 0) return;

      await this.queue.clear();
      await this.queue.addTracks(tracks, true);
      this.contextMenu = null;
    },

    async shuffleAlbum(album) {
      const tracks = this._getAlbumTracks(album.name);
      if (tracks.length === 0) return;

      await this.queue.clear();

      // Shuffle a copy before adding
      const shuffled = [...tracks];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }

      await this.queue.addTracks(shuffled, true);
      this.contextMenu = null;
    },

    async playTrack(_track, index) {
      const tracks = this.selectedAlbumTracks;
      await this.queue.clear();
      await this.queue.addTracks(tracks);
      await this.queue.playIndex(index);
    },

    async addAlbumToQueue(album) {
      const tracks = this._getAlbumTracks(album.name);
      if (tracks.length > 0) {
        await this.queue.addTracks(tracks);
        this.ui.toast(`Added ${tracks.length} tracks to queue`, 'success');
      }
      this.contextMenu = null;
    },

    async playAlbumNext(album) {
      const tracks = this._getAlbumTracks(album.name);
      if (tracks.length > 0) {
        await this.queue.playNextTracks(tracks);
        this.ui.toast(`Playing ${tracks.length} tracks next`, 'success');
      }
      this.contextMenu = null;
    },

    // --- Context Menus ---

    showAlbumContextMenu(event, album) {
      event.preventDefault();

      const items = [
        {
          icon: '\u25B6',
          label: 'Play Album',
          action: () => this.playAlbum(album),
        },
        {
          icon: '\u21BB',
          label: 'Shuffle Album',
          action: () => this.shuffleAlbum(album),
        },
        { type: 'separator' },
        {
          icon: '\u229A',
          label: 'Add to Queue',
          action: () => this.addAlbumToQueue(album),
        },
        {
          icon: '\u21BB',
          label: 'Play Next',
          action: () => this.playAlbumNext(album),
        },
      ];

      let x = event.clientX;
      let y = event.clientY;
      const menuWidth = 200;
      const menuHeight = items.length * 36;
      if (x + menuWidth > window.innerWidth) x = window.innerWidth - menuWidth - 10;
      if (y + menuHeight > window.innerHeight) y = window.innerHeight - menuHeight - 10;

      this.contextMenu = { x, y, items };
    },

    showTrackContextMenu(event, track, index) {
      event.preventDefault();

      const items = [
        {
          icon: '\u25B6',
          label: 'Play',
          action: () => this.playTrack(track, index),
        },
        {
          icon: '\u229A',
          label: 'Add to Queue',
          action: async () => {
            await this.queue.addTracks([track]);
            this.ui.toast('Added to queue', 'success');
            this.contextMenu = null;
          },
        },
        {
          icon: '\u21BB',
          label: 'Play Next',
          action: async () => {
            await this.queue.playNextTracks([track]);
            this.contextMenu = null;
          },
        },
      ];

      let x = event.clientX;
      let y = event.clientY;
      const menuWidth = 180;
      const menuHeight = items.length * 36;
      if (x + menuWidth > window.innerWidth) x = window.innerWidth - menuWidth - 10;
      if (y + menuHeight > window.innerHeight) y = window.innerHeight - menuHeight - 10;

      this.contextMenu = { x, y, items };
    },
  }));
}
