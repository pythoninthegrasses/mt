import { api } from '../api.js';
import { formatDuration } from '../utils/formatting.js';

export function createArtistsBrowser(Alpine) {
  Alpine.data('artistsBrowser', () => ({
    selectedArtist: null,
    artworkCache: {},
    contextMenu: null,

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

    init() {
      this._loadPlaylists();
      window.addEventListener('mt:playlists-updated', () => this._loadPlaylists());

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

    /**
     * Build a map of album → canonical artist (shortest album_artist across all
     * tracks in that album). This keeps multi-artist albums grouped under one entry.
     */
    get _canonicalArtistMap() {
      const v = this.$store.library._dataVersion;
      if (this._canonicalMapVersion === v) return this._cachedCanonicalMap;

      const map = new Map();
      for (const track of this._allTracks) {
        const album = track.album || '';
        const artist = (track.album_artist || track.artist || '').replace(/;+$/, '').trim();
        if (!artist) continue;
        const existing = map.get(album);
        if (!existing || artist.length < existing.length) {
          map.set(album, artist);
        }
      }
      this._cachedCanonicalMap = map;
      this._canonicalMapVersion = v;
      return map;
    },

    /**
     * Case-insensitive dedup: group canonical artists by lowercase name,
     * pick the most-frequent form as the display name.
     */
    get _artistDisplayNames() {
      const canonicalMap = this._canonicalArtistMap;
      const countMap = new Map();
      for (const canonical of canonicalMap.values()) {
        if (!canonical) continue;
        const lower = canonical.toLowerCase();
        if (!countMap.has(lower)) countMap.set(lower, new Map());
        const formCounts = countMap.get(lower);
        formCounts.set(canonical, (formCounts.get(canonical) || 0) + 1);
      }
      const displayMap = new Map();
      for (const [lower, formCounts] of countMap) {
        let bestForm = '';
        let bestCount = 0;
        for (const [form, count] of formCounts) {
          if (count > bestCount) {
            bestCount = count;
            bestForm = form;
          }
        }
        displayMap.set(lower, bestForm);
      }
      return displayMap;
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
      // Find all albums where the canonical artist matches (case-insensitive)
      const selectedLower = this.selectedArtist.toLowerCase();
      const matchingAlbums = new Set();
      for (const [album, canonical] of canonicalMap) {
        if (canonical.toLowerCase() === selectedLower) {
          matchingAlbums.add(album);
        }
      }
      return this._allTracks
        .filter((t) => matchingAlbums.has(t.album || ''))
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
      const tracks = this.selectedArtistTracks;
      const albumMap = {};

      for (const track of tracks) {
        const albumKey = track.album || 'Unknown Album';
        if (!albumMap[albumKey]) {
          albumMap[albumKey] = {
            name: albumKey,
            year: track.date || '',
            genre: track.genre || '',
            tracks: [],
            representativeTrackId: track.id,
          };
        }
        albumMap[albumKey].tracks.push(track);
        if (track.date && !albumMap[albumKey].year) {
          albumMap[albumKey].year = track.date;
        }
        if (track.genre && !albumMap[albumKey].genre) {
          albumMap[albumKey].genre = track.genre;
        }
      }

      // Sort each album's tracks: disc → track, with null disc inheriting
      // the album's most common disc number so tracks interleave correctly.
      for (const album of Object.values(albumMap)) {
        const discCounts = {};
        for (const t of album.tracks) {
          if (t.disc_number != null) {
            const d = this._parseDiscNumber(t.disc_number);
            discCounts[d] = (discCounts[d] || 0) + 1;
          }
        }
        const dominantDisc = Number(
          Object.entries(discCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 1,
        );
        album.tracks.sort((a, b) => {
          const discA = a.disc_number != null ? this._parseDiscNumber(a.disc_number) : dominantDisc;
          const discB = b.disc_number != null ? this._parseDiscNumber(b.disc_number) : dominantDisc;
          if (discA !== discB) return discA - discB;
          return this._parseTrackNumber(a.track_number) -
            this._parseTrackNumber(b.track_number);
        });
      }

      return Object.values(albumMap).sort((a, b) => {
        const yearA = parseInt(a.year) || 0;
        const yearB = parseInt(b.year) || 0;
        if (yearA !== yearB) return yearB - yearA;
        return a.name.localeCompare(b.name);
      });
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
        const url = await api.library.getArtworkUrl(trackId);
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
      this.queue._updating = true;
      try {
        await this.queue.clear();
        if (this.queue.shuffle) {
          await this.queue.add(allTracks, false);
          if (index >= 0 && index < this.queue.items.length) {
            this.queue.currentIndex = index;
            this.queue._shuffleItems();
            await this.queue._syncQueueToBackend();
            await this.queue.playIndex(0);
          } else {
            await this.player.playTrack(track);
          }
        } else {
          if (index >= 0 && index < allTracks.length) {
            await this.queue.add([track], false);
            if (index + 1 < allTracks.length) {
              const subsequentTracks = allTracks.slice(index + 1);
              await this.queue.add(subsequentTracks, false);
            }
            await this.queue.playIndex(0);
          } else {
            await this.player.playTrack(track);
          }
        }
      } finally {
        setTimeout(() => {
          this.queue._updating = false;
        }, 200);
      }
    },

    async _loadPlaylists() {
      try {
        const playlists = await api.playlists.getAll();
        this.playlists = playlists.map((p) => ({ id: p.id, name: p.name }));
      } catch {
        this.playlists = [];
      }
    },

    handleContextMenu(event, track) {
      event.preventDefault();

      const menuItems = [
        {
          label: 'Play Now',
          action: () => this._playTrack(track),
        },
        {
          label: 'Add to Queue',
          action: () => this._addToQueue(track),
        },
        { type: 'separator' },
        {
          label: 'Play Next',
          action: () => this._playNext(track),
        },
        {
          label: 'Add to Playlist',
          hasSubmenu: true,
          action: () => {
            this.showPlaylistSubmenu = !this.showPlaylistSubmenu;
          },
        },
        { type: 'separator' },
        {
          label: 'Show in Finder',
          action: () => this._showInFinder(track),
        },
      ];

      const menuHeight = 220;
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

    closeContextMenu() {
      this.contextMenu = null;
      this.showPlaylistSubmenu = false;
    },

    async _playTrack(track) {
      this.closeContextMenu();
      await this.queue.clear();
      await this.queue.add([track], false);
      await this.queue.playIndex(0);
    },

    async _addToQueue(track) {
      this.closeContextMenu();
      await this.queue.add([track], false);
      this.$store.ui.toast('Added to queue', 'success');
    },

    async _playNext(track) {
      this.closeContextMenu();
      const pos = this.queue.currentIndex >= 0 ? this.queue.currentIndex + 1 : 0;
      await api.queue.add([track.id], pos);
      await this.queue._loadFromBackend();
      this.$store.ui.toast('Playing next', 'success');
    },

    async addToPlaylist(playlistId) {
      const track = this.contextMenu?.track;
      this.closeContextMenu();
      if (!track) return;

      try {
        const result = await api.playlists.addTracks(playlistId, [track.id]);
        const playlist = this.playlists.find((p) => p.id === playlistId);
        const playlistName = playlist?.name || 'playlist';

        if (result.added > 0) {
          this.$store.ui.toast(`Added to "${playlistName}"`, 'success');
        } else {
          this.$store.ui.toast(`Already in "${playlistName}"`, 'info');
        }

        window.dispatchEvent(new CustomEvent('mt:playlists-updated'));
      } catch {
        this.$store.ui.toast('Failed to add to playlist', 'error');
      }
    },

    createPlaylistWithTracks() {
      const track = this.contextMenu?.track;
      this.closeContextMenu();
      if (!track) return;

      window.dispatchEvent(
        new CustomEvent('mt:create-playlist-with-tracks', { detail: { trackIds: [track.id] } }),
      );
    },

    async _showInFinder(track) {
      this.closeContextMenu();
      if (window.__TAURI__?.core?.invoke && track.filepath) {
        try {
          await window.__TAURI__.core.invoke('show_in_folder', { path: track.filepath });
        } catch (err) {
          console.error('[artists] Failed to show in finder:', err);
        }
      }
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

export default createArtistsBrowser;
