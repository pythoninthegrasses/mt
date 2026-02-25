import { library } from '../api/library.js';
import { formatDuration } from '../utils/formatting.js';
import {
  buildArtistDisplayNames,
  buildCanonicalArtistMap,
  groupTracksIntoAlbums,
} from '../utils/artist-utils.js';
import { handleDoubleClickPlay } from '../utils/queue-builder.js';
import { singleTrackContextMenuMixin } from '../mixins/single-track-context-menu.js';

export function createArtistsBrowser(Alpine) {
  Alpine.data('artistsBrowser', () => ({
    selectedArtist: null,
    artworkCache: {},
    contextMenu: null,
    _buildQueueGeneration: 0,

    // Memoization cache
    _artistsVersion: -1,
    _cachedArtists: [],
    _canonicalMapVersion: -1,
    _cachedCanonicalMap: null,
    playlists: [],
    showPlaylistSubmenu: false,
    submenuOnLeft: false,
    submenuY: 0,
    submenuCloseTimeout: null,

    // Merge context menu mixin
    ...singleTrackContextMenuMixin(),

    // Bound event handlers for cleanup
    _onNavigateToArtist: null,
    _onPlaylistsUpdated: null,

    init() {
      this._loadPlaylists();
      this._onPlaylistsUpdated = () => this._loadPlaylists();
      window.addEventListener('mt:playlists-updated', this._onPlaylistsUpdated);

      // Handle cross-view navigation to artist
      this._onNavigateToArtist = (e) => {
        const { artist } = e.detail;
        const matchedArtist = this.artists.find(
          (a) => a.toLowerCase() === artist.toLowerCase(),
        );
        if (matchedArtist) {
          this.ui.setView('artists');
          this.selectedArtist = matchedArtist;
          // Scroll detail panel to top after DOM updates
          this.$nextTick(() => {
            const detailPanel = document.querySelector('[data-testid="artist-detail"]');
            if (detailPanel) detailPanel.scrollTop = 0;
          });
        } else {
          this.ui.toast(`Artist not found: "${artist}"`, 'error');
        }
      };
      window.addEventListener('mt:navigate-to-artist', this._onNavigateToArtist);

      // Auto-select first artist when view becomes active
      this.$watch('$store.ui.view', (view) => {
        if (view === 'artists' && !this.selectedArtist && this.artists.length > 0) {
          this.selectedArtist = this.artists[0];
        }
      });

      // Select first artist on init if already on artists view
      if (this.$store.ui.view === 'artists' && this.artists.length > 0) {
        this.selectedArtist = this.artists[0];
      }
    },

    destroy() {
      if (this._onNavigateToArtist) {
        window.removeEventListener('mt:navigate-to-artist', this._onNavigateToArtist);
        this._onNavigateToArtist = null;
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

    get player() {
      return this.$store.player;
    },

    get queue() {
      return this.$store.queue;
    },

    get ui() {
      return this.$store.ui;
    },

    get _canonicalArtistMap() {
      const v = this.$store.library._dataVersion;
      if (this._canonicalMapVersion === v) return this._cachedCanonicalMap;

      const map = buildCanonicalArtistMap(this._allTracks);
      this._cachedCanonicalMap = map;
      this._canonicalMapVersion = v;
      return map;
    },

    get _artistDisplayNames() {
      return buildArtistDisplayNames(this._allTracks, this._canonicalArtistMap);
    },

    get artists() {
      const v = this.$store.library._dataVersion;
      if (this._artistsVersion === v) return this._cachedArtists;

      const displayMap = this._artistDisplayNames;
      const artists = Array.from(displayMap.values());
      const ignoreWords = this._ignoreWords;
      artists.sort((a, b) => {
        const aVal = this._stripIgnoredPrefix(a, ignoreWords).toLowerCase();
        const bVal = this._stripIgnoredPrefix(b, ignoreWords).toLowerCase();
        return aVal.localeCompare(bVal);
      });
      this._cachedArtists = artists;
      this._artistsVersion = v;
      return artists;
    },

    get _ignoreWords() {
      return this.ui.sortIgnoreWords
        ? this.ui.sortIgnoreWordsList.split(',').map((w) => w.trim()).filter(Boolean)
        : [];
    },

    _stripIgnoredPrefix(value, ignoreWords) {
      if (!value || !ignoreWords || ignoreWords.length === 0) {
        return String(value || '').trim();
      }
      const str = String(value).trim();
      const lowerStr = str.toLowerCase();
      for (const word of ignoreWords) {
        const prefix = word.trim().toLowerCase();
        if (!prefix) continue;
        if (lowerStr.startsWith(prefix + ' ')) {
          return str.slice(prefix.length + 1).trim();
        }
      }
      return str;
    },

    _parseDiscNumber(val) {
      return parseInt(String(val || '1').split('/')[0], 10) || 1;
    },

    _parseTrackNumber(val) {
      return parseInt(String(val || '').split('/')[0], 10) || 999999;
    },

    get selectedArtistTracks() {
      if (!this.selectedArtist) return [];
      const canonicalMap = this._canonicalArtistMap;
      const selectedLower = this.selectedArtist.toLowerCase();

      // Find albums where the canonical artist matches
      const matchingAlbums = new Set();
      for (const [album, canonical] of canonicalMap) {
        if (canonical.toLowerCase() === selectedLower) {
          matchingAlbums.add(album);
        }
      }

      return this._allTracks
        .filter((t) => {
          const album = t.album || '';
          if (matchingAlbums.has(album)) return true;
          if (!canonicalMap.has(album)) {
            const trackArtist = (t.album_artist || t.artist || '').replace(/;+$/, '').trim();
            return trackArtist.toLowerCase() === selectedLower;
          }
          return false;
        })
        .sort((a, b) => {
          const albumCmp = (a.album || '').localeCompare(b.album || '');
          if (albumCmp !== 0) return albumCmp;
          const discCmp = this._parseDiscNumber(a.disc_number) -
            this._parseDiscNumber(b.disc_number);
          if (discCmp !== 0) return discCmp;
          return this._parseTrackNumber(a.track_number) -
            this._parseTrackNumber(b.track_number);
        });
    },

    get selectedArtistAlbums() {
      return groupTracksIntoAlbums(
        this.selectedArtistTracks,
        this._parseDiscNumber,
        this._parseTrackNumber,
      );
    },

    get selectedArtistAlbumCount() {
      return this.selectedArtistAlbums.length;
    },

    get selectedArtistTrackCount() {
      return this.selectedArtistTracks.length;
    },

    selectArtist(artist) {
      this.selectedArtist = artist;
    },

    isSelectedArtist(artist) {
      return this.selectedArtist === artist;
    },

    isPlaying(trackId) {
      return this.player.currentTrack?.id === trackId;
    },

    formatDuration(seconds) {
      return formatDuration(seconds);
    },

    albumTotalDuration(albumTracks) {
      const totalSeconds = albumTracks.reduce((sum, t) => sum + (t.duration || 0), 0);
      const minutes = Math.floor(totalSeconds / 60);
      return minutes;
    },

    async getArtwork(trackId) {
      if (this.artworkCache[trackId] !== undefined) {
        return this.artworkCache[trackId];
      }
      try {
        const url = await library.getArtworkUrl(trackId);
        this.artworkCache[trackId] = url;
        return url;
      } catch {
        this.artworkCache[trackId] = null;
        return null;
      }
    },

    async loadArtwork(trackId, imgEl) {
      const url = await this.getArtwork(trackId);
      if (url && imgEl) {
        imgEl.src = url;
        imgEl.classList.remove('hidden');
        imgEl.nextElementSibling?.classList.add('hidden');
      }
    },

    async handleTrackDoubleClick(track, allTracks, index) {
      await handleDoubleClickPlay(this, track, allTracks, index, 'artists-browser');
    },
  }));
}

export default createArtistsBrowser;
