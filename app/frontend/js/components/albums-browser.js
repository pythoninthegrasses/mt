/**
 * Albums Browser Component
 *
 * Provides album grid and album detail views, modeled after iTunes/Apple Music.
 * Two states: grid (responsive album cards) and detail (single album with track list).
 */

import { library } from '../api/library.js';
import { favorites } from '../api/favorites.js';
import { playlists } from '../api/playlists.js';
import { formatDuration } from '../utils/formatting.js';

export function createAlbumsBrowser(Alpine) {
  Alpine.data('albumsBrowser', () => ({
    // View state: 'grid' or 'detail'
    subView: 'grid',

    // Album detail state
    selectedAlbum: null,
    selectedAlbumTracks: [],
    selectedAlbumArtwork: null,

    // Artwork cache for grid cards: { trackId: url }
    artworkCache: {},

    // IntersectionObserver for lazy loading
    _observer: null,

    // Scroll position preservation
    _gridScrollTop: 0,

    // Memoization cache for albumList getter
    _albumListVersion: -1,
    _cachedAlbumList: [],

    // Context menu
    contextMenu: null,
    playlists: [],
    showPlaylistSubmenu: false,
    submenuOnLeft: false,
    submenuY: 0,
    submenuCloseTimeout: null,

    // Flag to skip grid reset during programmatic navigation
    _skipGridReset: false,

    // Bound event handlers for cleanup
    _onNavigateToAlbum: null,
    _onPlaylistsUpdated: null,

    init() {
      this._setupLazyLoading();
      this._loadPlaylists();

      this._onPlaylistsUpdated = () => this._loadPlaylists();
      window.addEventListener('mt:playlists-updated', this._onPlaylistsUpdated);

      // Handle cross-view navigation to album
      this._onNavigateToAlbum = (e) => {
        const { album, albumArtist } = e.detail;
        const targetAlbum = this.albumList.find(
          (a) => a.name === album && a.albumArtist === albumArtist,
        );
        if (targetAlbum) {
          this._skipGridReset = true;
          this.ui.setView('albums');
          this.openAlbumDetail(targetAlbum);
          this._skipGridReset = false;
        } else {
          this.ui.toast(`Album not found: "${album}"`, 'error');
        }
      };
      window.addEventListener('mt:navigate-to-album', this._onNavigateToAlbum);

      // Reset to grid view when navigating back to albums (via sidebar)
      this.$watch('$store.ui.view', (view) => {
        if (view === 'albums' && this.subView === 'detail' && !this._skipGridReset) {
          this.backToGrid();
        }
      });
    },

    destroy() {
      if (this._observer) {
        this._observer.disconnect();
        this._observer = null;
      }
      if (this._onNavigateToAlbum) {
        window.removeEventListener('mt:navigate-to-album', this._onNavigateToAlbum);
        this._onNavigateToAlbum = null;
      }
      if (this._onPlaylistsUpdated) {
        window.removeEventListener('mt:playlists-updated', this._onPlaylistsUpdated);
        this._onPlaylistsUpdated = null;
      }
    },

    get _allTracks() {
      return this.$store.library.allTracks;
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

    get albumList() {
      const v = this.$store.library._dataVersion;
      if (this._albumListVersion === v) return this._cachedAlbumList;

      // Group by composite key (album + album_artist) to separate
      // identically named albums by different artists
      const tracksByKey = {};
      for (const track of this._allTracks) {
        const album = track.album || 'Unknown Album';
        const albumArtist = track.album_artist || track.artist || 'Unknown Artist';
        const key = `${album}|||${albumArtist}`;
        if (!tracksByKey[key]) tracksByKey[key] = [];
        tracksByKey[key].push(track);
      }
      const albums = [];

      for (const tracks of Object.values(tracksByKey)) {
        const firstTrack = tracks[0];
        const albumArtist = firstTrack.album_artist || firstTrack.artist || 'Unknown Artist';
        albums.push({
          name: firstTrack.album || 'Unknown Album',
          artist: albumArtist,
          albumArtist,
          year: firstTrack.date ? String(firstTrack.date).slice(0, 4) : '',
          genre: firstTrack.genre || '',
          trackCount: tracks.length,
          firstTrackId: firstTrack.id,
          totalDuration: tracks.reduce((sum, t) => sum + (t.duration || 0), 0),
        });
      }

      albums.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
      this._cachedAlbumList = albums;
      this._albumListVersion = v;
      return albums;
    },

    // --- Lazy Artwork Loading ---

    _setupLazyLoading() {
      this._observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) {
              const card = entry.target;
              const trackId = card.dataset.artworkTrackId;
              if (trackId) {
                this._loadArtwork(parseInt(trackId, 10), card);
              }
              this._observer.unobserve(card);
            }
          }
        },
        { rootMargin: '200px' },
      );
    },

    observeCard(el, trackId) {
      if (!el || !this._observer) return;
      el.dataset.artworkTrackId = trackId;

      // Check cache first
      if (this.artworkCache[trackId]) {
        return;
      }

      this._observer.observe(el);
    },

    async _loadArtwork(trackId, _card) {
      if (this.artworkCache[trackId]) return;

      try {
        const url = await library.getArtworkUrl(trackId);
        this.artworkCache[trackId] = url || null;
      } catch {
        this.artworkCache[trackId] = null;
      }
    },

    getArtworkUrl(trackId) {
      return this.artworkCache[trackId] || null;
    },

    // --- Navigation ---

    openAlbumDetail(album) {
      // Save scroll position
      const grid = this.$refs.gridContainer;
      if (grid) {
        this._gridScrollTop = grid.scrollTop;
      }

      this.selectedAlbum = album;
      this.selectedAlbumTracks = this._getAlbumTracks(album.name, album.albumArtist);
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

    _getAlbumTracks(albumName, albumArtist) {
      const tracks = this._allTracks.filter((t) => {
        if ((t.album || 'Unknown Album') !== albumName) return false;
        if (albumArtist) {
          const trackArtist = t.album_artist || t.artist || 'Unknown Artist';
          return trackArtist === albumArtist;
        }
        return true;
      });
      // Find dominant disc number for tracks missing disc metadata
      const discCounts = {};
      for (const t of tracks) {
        if (t.disc_number != null) {
          const d = parseInt(String(t.disc_number).split('/')[0], 10) || 1;
          discCounts[d] = (discCounts[d] || 0) + 1;
        }
      }
      const dominantDisc = Number(
        Object.entries(discCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 1,
      );
      return [...tracks].sort((a, b) => {
        const discA = a.disc_number != null
          ? (parseInt(String(a.disc_number).split('/')[0], 10) || 1)
          : dominantDisc;
        const discB = b.disc_number != null
          ? (parseInt(String(b.disc_number).split('/')[0], 10) || 1)
          : dominantDisc;
        if (discA !== discB) return discA - discB;
        const trackA = parseInt(a.track_number, 10) || 0;
        const trackB = parseInt(b.track_number, 10) || 0;
        return trackA - trackB;
      });
    },

    async _loadDetailArtwork(trackId) {
      try {
        this.selectedAlbumArtwork = await library.getArtworkUrl(trackId);
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
      const tracks = this._getAlbumTracks(album.name, album.albumArtist);
      if (tracks.length === 0) return;

      await this.queue.clear();
      await this.queue.addTracks(tracks, true);
      this.contextMenu = null;
    },

    async shuffleAlbum(album) {
      const tracks = this._getAlbumTracks(album.name, album.albumArtist);
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
      const tracks = this._getAlbumTracks(album.name, album.albumArtist);
      if (tracks.length > 0) {
        await this.queue.addTracks(tracks);
        this.ui.toast(`Added ${tracks.length} tracks to queue`, 'success');
      }
      this.contextMenu = null;
    },

    async playAlbumNext(album) {
      const tracks = this._getAlbumTracks(album.name, album.albumArtist);
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
        { type: 'separator' },
        {
          label: 'Add to Playlist',
          hasSubmenu: true,
          action: () => {
            this.showPlaylistSubmenu = !this.showPlaylistSubmenu;
          },
        },
      ];

      const tracks = this._getAlbumTracks(album.name, album.albumArtist);
      let x = event.clientX;
      let y = event.clientY;
      const menuWidth = 200;
      const submenuWidth = 200;
      const menuHeight = items.length * 36;
      if (x + menuWidth > window.innerWidth) x = window.innerWidth - menuWidth - 10;
      if (y + menuHeight > window.innerHeight) y = window.innerHeight - menuHeight - 10;

      this.contextMenu = { x, y, items, tracks };
      this.showPlaylistSubmenu = false;
      this.submenuOnLeft = (x + menuWidth + 45 + submenuWidth) > window.innerWidth;
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
            this.closeContextMenu();
          },
        },
        {
          icon: '\u21BB',
          label: 'Play Next',
          action: async () => {
            await this.queue.playNextTracks([track]);
            this.closeContextMenu();
          },
        },
        { type: 'separator' },
        {
          label: 'Add to Playlist',
          hasSubmenu: true,
          action: () => {
            this.showPlaylistSubmenu = !this.showPlaylistSubmenu;
          },
        },
        {
          label: 'Add to Liked Songs',
          action: () => this._toggleFavorite(track),
        },
      ];

      // Check favorite status and update label asynchronously
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

      let x = event.clientX;
      let y = event.clientY;
      const menuWidth = 200;
      const submenuWidth = 200;
      const menuHeight = items.length * 36;
      if (x + menuWidth > window.innerWidth) x = window.innerWidth - menuWidth - 10;
      if (y + menuHeight > window.innerHeight) y = window.innerHeight - menuHeight - 10;

      this.contextMenu = { x, y, items, tracks: [track] };
      this.showPlaylistSubmenu = false;
      this.submenuOnLeft = (x + menuWidth + 45 + submenuWidth) > window.innerWidth;
    },

    // --- Playlist ---

    closeContextMenu() {
      this.contextMenu = null;
      this.showPlaylistSubmenu = false;
    },

    async _loadPlaylists() {
      try {
        const data = await playlists.getAll();
        this.playlists = data.map((p) => ({ id: p.id, name: p.name }));
      } catch {
        this.playlists = [];
      }
    },

    async _toggleFavorite(track) {
      this.closeContextMenu();
      try {
        const result = await favorites.check(track.id);
        if (result.is_favorite) {
          await favorites.remove(track.id);
        } else {
          await favorites.add(track.id);
        }
        const player = this.$store.player;
        if (player.currentTrack?.id === track.id) {
          player.isFavorite = !result.is_favorite;
        }
        this.library.refreshIfLikedSongs();
      } catch (error) {
        console.error('[context-menu]', 'toggle_favorite_error', {
          trackId: track.id,
          error: error.message,
        });
        this.ui.toast('Failed to update liked songs', 'error');
      }
    },

    async addToPlaylist(playlistId) {
      const tracks = this.contextMenu?.tracks || [];
      this.closeContextMenu();
      if (tracks.length === 0) return;

      try {
        const trackIds = tracks.map((t) => t.id);
        const result = await playlists.addTracks(playlistId, trackIds);
        const playlist = this.playlists.find((p) => p.id === playlistId);
        const playlistName = playlist?.name || 'playlist';

        if (result.added > 0) {
          this.ui.toast(
            `Added ${result.added} track${result.added > 1 ? 's' : ''} to "${playlistName}"`,
            'success',
          );
        } else {
          this.ui.toast(
            `Track${tracks.length > 1 ? 's' : ''} already in "${playlistName}"`,
            'info',
          );
        }

        window.dispatchEvent(new CustomEvent('mt:playlists-updated'));
      } catch {
        this.ui.toast('Failed to add to playlist', 'error');
      }
    },

    createPlaylistWithTracks() {
      const tracks = this.contextMenu?.tracks || [];
      this.closeContextMenu();
      if (tracks.length === 0) return;

      const trackIds = tracks.map((t) => t.id);
      window.dispatchEvent(
        new CustomEvent('mt:create-playlist-with-tracks', { detail: { trackIds } }),
      );
    },

    handleSubmenuEnter() {
      if (this.submenuCloseTimeout) {
        clearTimeout(this.submenuCloseTimeout);
        this.submenuCloseTimeout = null;
      }
    },

    handleSubmenuLeave() {
      this.submenuCloseTimeout = setTimeout(() => {
        this.showPlaylistSubmenu = false;
      }, 200);
    },
  }));
}
