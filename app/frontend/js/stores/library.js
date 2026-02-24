/**
 * Library Store - manages music library state
 *
 * Handles track loading, searching, sorting, and
 * library scanning via Tauri backend.
 */

import { api } from '../api.js';
import {
  buildCacheEntry,
  createCacheSaver,
  loadCacheFromSettings,
} from '../utils/library-cache.js';
import {
  applySectionData,
  backgroundRefreshLibrary,
  backgroundRefreshSection,
  getInitialSection,
  loadLibraryData,
  loadSection,
  openAddMusicDialogOp,
  removeFromQueue,
  removeTracksLocallyOp,
  scanPaths,
} from '../utils/library-operations.js';

const { listen } = window.__TAURI__?.event ?? { listen: () => Promise.resolve(() => {}) };

// Re-export for use in library-operations.js (they call store._updateCache etc.)
export { applySectionData };

export function createLibraryStore(Alpine) {
  Alpine.store('library', {
    // Track data
    tracks: [],
    filteredTracks: [],
    allTracks: [],

    // Search and filter state
    searchQuery: '',
    sortBy: 'default',
    sortOrder: 'asc',
    currentSection: getInitialSection(),

    // Loading state
    loading: false,
    scanning: false,
    scanProgress: 0,
    scanStatus: null,
    scanJobId: null,

    // Statistics
    totalTracks: 0,
    totalDuration: 0,

    // Internal
    _searchDebounce: null,
    _saveCacheDebounce: null,
    _watchedFolderListener: null,
    _lastLoadedSection: null,
    _sectionCache: {},
    _backgroundRefreshing: false,
    _dataVersion: 0,
    _saveCache: null,

    async init() {
      this._saveCache = createCacheSaver(window.settings);
      const { cache, loaded: hasCachedData } = loadCacheFromSettings(window.settings);

      if (hasCachedData) {
        this._sectionCache = cache;
        const cached = this._sectionCache[this.currentSection];
        if (cached) {
          this.totalTracks = cached.totalTracks;
          this.totalDuration = cached.totalDuration;
          this._lastLoadedSection = this.currentSection;
          console.log('[library] showing cached summary on init:', {
            section: this.currentSection,
            totalTracks: cached.totalTracks,
          });
        }
      }

      await this.load({ forceReload: true });
      await this._setupWatchedFolderListener();
    },

    async _setupWatchedFolderListener() {
      this._watchedFolderListener = await listen('watched-folder:results', (event) => {
        const { added, updated, deleted } = event.payload || {};
        console.log('[library] watched-folder:results', { added, updated, deleted });

        if (added > 0 || updated > 0 || deleted > 0) {
          console.log('[library] Reloading library after watched folder scan');
          this._clearCache();
          this.load({ forceReload: true });
        }
      });
    },

    _updateCache(section, data) {
      this._sectionCache[section] = buildCacheEntry(data);
      this._persistCache();
    },

    _persistCache() {
      if (this._saveCache) {
        this._saveCacheDebounce = this._saveCache(
          this._sectionCache,
          this._saveCacheDebounce,
        );
      }
    },

    _filterByLibrary(tracks) {
      if (this.allTracks.length === 0) return [];
      const ids = new Set(this.allTracks.map((t) => t.id));
      return tracks.filter((t) => ids.has(t.id));
    },

    _clearCache(section = null) {
      if (section) {
        delete this._sectionCache[section];
        console.log('[library] cache cleared for section:', section);
      } else {
        this._sectionCache = {};
        console.log('[library] cache cleared (all sections)');
      }
      this._persistCache();
    },

    async _fetchLibraryData() {
      const sortKeyMap = {
        default: 'artist',
        index: 'track_number',
        dateAdded: 'added_date',
        lastPlayed: 'last_played',
        playCount: 'play_count',
        year: 'date',
        genre: 'genre',
        trackTotal: 'track_total',
        discNumber: 'disc_number',
      };

      const uiStore = Alpine.store('ui');
      const ignoreWords = uiStore.sortIgnoreWords ? uiStore.sortIgnoreWordsList : null;

      return await api.library.getTracks({
        search: this.searchQuery.trim() || null,
        sort: sortKeyMap[this.sortBy] || this.sortBy,
        order: this.sortOrder,
        limit: 999999,
        offset: 0,
        ignoreWords,
      });
    },

    // -----------------------------------------------------------------------
    // Section loading — thin wrappers delegating to library-operations.js
    // -----------------------------------------------------------------------

    _loadSection(section, fetchFn, opts = {}) {
      return loadSection(this, section, fetchFn, opts);
    },

    _backgroundRefreshSection(section, fetchFn, opts = {}) {
      return backgroundRefreshSection(this, section, fetchFn, opts);
    },

    _backgroundRefresh(section) {
      return backgroundRefreshLibrary(this, section);
    },

    load(opts) {
      return loadLibraryData(this, opts);
    },

    loadFavorites() {
      return this._loadSection('liked', () => api.favorites.get({ limit: 1000 }));
    },

    _backgroundRefreshFavorites() {
      // Preserve original matching: currentSection === 'liked' OR _lastLoadedSection === 'liked'
      const section = (this.currentSection === 'liked' || this._lastLoadedSection === 'liked')
        ? 'liked'
        : null;
      if (!section) return;
      return this._backgroundRefreshSection(
        'liked',
        () => api.favorites.get({ limit: 1000 }),
      );
    },

    loadRecentlyPlayed(days = 14) {
      return this._loadSection(
        'recent',
        () => api.favorites.getRecentlyPlayed({ days, limit: 100 }),
      );
    },

    _backgroundRefreshRecentlyPlayed(days = 14) {
      return this._backgroundRefreshSection(
        'recent',
        () => api.favorites.getRecentlyPlayed({ days, limit: 100 }),
      );
    },

    loadRecentlyAdded(days = 14) {
      return this._loadSection(
        'added',
        () => api.favorites.getRecentlyAdded({ days, limit: 100 }),
      );
    },

    _backgroundRefreshRecentlyAdded(days = 14) {
      return this._backgroundRefreshSection(
        'added',
        () => api.favorites.getRecentlyAdded({ days, limit: 100 }),
      );
    },

    loadTop25() {
      return this._loadSection('top25', () => api.favorites.getTop25());
    },

    _backgroundRefreshTop25() {
      return this._backgroundRefreshSection(
        'top25',
        () => api.favorites.getTop25(),
      );
    },

    loadPlaylist(playlistId) {
      const section = `playlist-${playlistId}`;
      const transformPlaylist = (_rawTracks, data) =>
        (data.tracks || []).map((item) => item.track || item);

      const cachePlaylist = (data) => {
        this._sectionCache[section] = {
          totalTracks: this.totalTracks,
          totalDuration: this.totalDuration,
          playlistName: data.name,
          timestamp: Date.now(),
        };
        this._persistCache();

        console.log('[navigation]', 'load_playlist_complete', {
          playlistId,
          playlistName: data.name,
          trackCount: this.tracks.length,
        });
        return data;
      };

      console.log('[navigation]', 'load_playlist', { playlistId });

      return this._loadSection(section, () => api.playlists.get(playlistId), {
        transform: transformPlaylist,
        onSuccess: cachePlaylist,
        logTag: 'navigation',
      });
    },

    _backgroundRefreshPlaylist(playlistId) {
      const section = `playlist-${playlistId}`;
      const transformPlaylist = (_rawTracks, data) =>
        (data.tracks || []).map((item) => item.track || item);

      return this._backgroundRefreshSection(
        section,
        () => api.playlists.get(playlistId),
        {
          transform: transformPlaylist,
          onSuccess: (data) => {
            this._sectionCache[section] = {
              totalTracks: this.totalTracks,
              totalDuration: this.totalDuration,
              playlistName: data.name,
              timestamp: Date.now(),
            };
            this._persistCache();
          },
        },
      );
    },

    // -----------------------------------------------------------------------
    // Navigation and search
    // -----------------------------------------------------------------------

    setSection(section) {
      console.log('[navigation]', 'switch_section', {
        previousSection: this.currentSection,
        newSection: section,
      });

      this.currentSection = section;
      window.dispatchEvent(new CustomEvent('mt:section-change', { detail: { section } }));
    },

    refreshIfLikedSongs() {
      if (this.currentSection === 'liked') {
        this.loadFavorites();
      }
    },

    search(query) {
      this.searchQuery = query;

      if (this._searchDebounce) {
        clearTimeout(this._searchDebounce);
      }

      this._searchDebounce = setTimeout(() => {
        this.load({ forceReload: true });
      }, 150);
    },

    applyFilters() {
      this.filteredTracks = [...this.tracks];
    },

    setSortBy(field) {
      console.log('[library]', 'setSortBy', { field });

      if (this.sortBy === field) {
        this.sortOrder = this.sortOrder === 'asc' ? 'desc' : 'asc';
      } else {
        this.sortBy = field;
        this.sortOrder = 'asc';
      }

      this.load({ forceReload: true });
    },

    // -----------------------------------------------------------------------
    // Scan operations — thin wrappers
    // -----------------------------------------------------------------------

    scan(paths, recursive = true) {
      return scanPaths(this, paths, recursive);
    },

    openAddMusicDialog() {
      return openAddMusicDialogOp(this, Alpine);
    },

    // -----------------------------------------------------------------------
    // Track state management — thin wrappers
    // -----------------------------------------------------------------------

    removeTracksLocally(trackIds) {
      return removeTracksLocallyOp(this, Alpine, trackIds);
    },

    _removeFromQueue(idSet) {
      return removeFromQueue(Alpine, idSet);
    },

    async remove(trackId) {
      try {
        await api.library.deleteTrack(trackId);
        this.removeTracksLocally([trackId]);
      } catch (error) {
        console.error('Failed to remove track:', error);
        throw error;
      }
    },

    getTrack(trackId) {
      return this.tracks.find((t) => t.id === trackId) || null;
    },

    // -----------------------------------------------------------------------
    // Queue operations
    // -----------------------------------------------------------------------

    async addToQueue(track, playNow = false) {
      await Alpine.store('queue').add(track, playNow);
    },

    async addAllToQueue(playNow = false) {
      await Alpine.store('queue').add(this.filteredTracks, playNow);
    },

    async playNow(track) {
      const queue = Alpine.store('queue');
      await queue.clear();
      await queue.add(track, true);
    },

    // -----------------------------------------------------------------------
    // Computed properties
    // -----------------------------------------------------------------------

    get formattedTotalDuration() {
      const hours = Math.floor(this.totalDuration / 3600000);
      const minutes = Math.floor((this.totalDuration % 3600000) / 60000);

      if (hours > 0) {
        return `${hours}h ${minutes}m`;
      }
      return `${minutes} min`;
    },

    get artists() {
      const artistSet = new Set(this.tracks.map((t) => t.artist).filter(Boolean));
      return Array.from(artistSet).sort();
    },

    get albums() {
      const albumSet = new Set(this.tracks.map((t) => t.album).filter(Boolean));
      return Array.from(albumSet).sort();
    },

    get tracksByArtist() {
      const grouped = {};
      for (const track of this.filteredTracks) {
        const artist = track.artist || 'Unknown Artist';
        if (!grouped[artist]) {
          grouped[artist] = [];
        }
        grouped[artist].push(track);
      }
      return grouped;
    },

    get tracksByAlbum() {
      const grouped = {};
      for (const track of this.filteredTracks) {
        const album = track.album || 'Unknown Album';
        if (!grouped[album]) {
          grouped[album] = [];
        }
        grouped[album].push(track);
      }
      return grouped;
    },

    // -----------------------------------------------------------------------
    // Rescan and scan progress
    // -----------------------------------------------------------------------

    async rescanTrack(trackId) {
      try {
        const updatedTrack = await api.library.rescanTrack(trackId);
        if (updatedTrack) {
          const index = this.tracks.findIndex((t) => t.id === trackId);
          if (index >= 0) {
            this.tracks[index] = updatedTrack;
            this.applyFilters();
          }
        }
      } catch (error) {
        console.error('[library] Failed to rescan track:', error);
      }
    },

    setScanProgress(progress) {
      const { jobId, status, scanned, found, errors, currentPath } = progress;

      this.scanning = true;
      this.scanJobId = jobId;
      this.scanStatus = status;

      if (scanned > 0) {
        this.scanProgress = Math.min(99, scanned);
      }

      console.log('[library] scan progress:', {
        jobId,
        status,
        scanned,
        found,
        errors,
        currentPath,
      });
    },

    clearScanProgress() {
      this.scanning = false;
      this.scanProgress = 0;
      this.scanStatus = null;
      this.scanJobId = null;
    },

    async fetchTracks() {
      this._clearCache();
      await this.load({ forceReload: true });
    },
  });
}
