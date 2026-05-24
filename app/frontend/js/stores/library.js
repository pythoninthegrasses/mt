/**
 * Library Store - manages music library state
 *
 * Handles track loading, searching, sorting, and
 * library scanning via Tauri backend.
 *
 * Uses a sparse page map for the "all" section to avoid loading
 * the entire library into JS memory. Other sections (favorites,
 * recent, playlists) load all tracks in a single fetch.
 */

import { library as libraryApi } from '../api/library.js';
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

const { listen } = window.__TAURI__?.event ?? {
  listen: () => Promise.resolve(() => {}),
};

// Re-export for use in library-operations.js (they call store._updateCache etc.)
export { applySectionData };

export function createLibraryStore(Alpine) {
  Alpine.store('library', {
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

    // Statistics (from count endpoint for "all" section, or computed for other sections)
    totalTracks: 0,
    totalDuration: 0,
    totalFileSize: 0,
    // Local-only file count for "all" section footer display (excludes remote Plex tracks)
    localFileCount: 0,

    // Sparse page map for paginated loading (used by "all" section)
    _trackPages: {},
    _loadingPages: {},
    _pageSize: 1500,
    _loadGeneration: 0,
    _allPagesLoaded: false,

    // Non-paginated track storage (used by non-"all" sections: favorites, recent, playlists)
    _sectionTracks: null,

    // Plex
    showRemote: true,

    // Internal
    _searchDebounce: null,
    _saveCacheDebounce: null,
    _watchedFolderListener: null,
    _plexListeners: null,
    _plexBatch: null,
    _plexBatchDismissTimer: null,
    _plexBatchDismissToastId: null,
    _lastLoadedSection: null,
    _sectionCache: {},
    _backgroundRefreshing: false,
    _dataVersion: 0,
    _lastRevision: undefined,
    _saveCache: null,

    async init() {
      this._saveCache = createCacheSaver(window.settings);

      const savedShowRemote = await window.settings.get('library:showRemote');
      if (savedShowRemote !== null && savedShowRemote !== undefined) {
        this.showRemote = savedShowRemote;
      }

      const { cache, loaded: hasCachedData } = loadCacheFromSettings(
        window.settings,
      );

      if (hasCachedData) {
        this._sectionCache = cache;
        const cached = this._sectionCache[this.currentSection];
        if (cached) {
          // Only cache totalDuration for display — do NOT set totalTracks here.
          // Setting totalTracks while _trackPages is empty causes Alpine to
          // render placeholder rows (FOUC) before loadLibraryData populates
          // page 0 and sets totalTracks atomically via disableEffectScheduling.
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
      await this._setupPlexListeners();
    },

    async _setupWatchedFolderListener() {
      this._watchedFolderListener = await listen(
        'watched-folder:results',
        (event) => {
          const { added, updated, deleted } = event.payload || {};
          console.log('[library] watched-folder:results', {
            added,
            updated,
            deleted,
          });

          if (added > 0 || updated > 0 || deleted > 0) {
            console.log(
              '[library] Reloading library after watched folder scan',
            );
            this._clearCache();
            this.load({ forceReload: true });
          }
        },
      );
    },

    async _setupPlexListeners() {
      const unlistenProgress = await listen('plex_download_progress', (event) => {
        const { track_id, percent } = event.payload || {};
        // Only refresh play-flow (non-batch) completions — batch tracks are
        // refreshed by downloadFromPlex after the invoke resolves.
        if (percent != null && percent >= 100 && !this._plexBatch?.pendingIds.has(track_id)) {
          this._refreshPlexTrack(track_id);
        }
      });

      const unlistenFailed = await listen('plex_download_failed', (event) => {
        const { track_id, error } = event.payload || {};
        // Batch failures are counted by the catch block in downloadFromPlex.
        if (!this._plexBatch?.pendingIds.has(track_id)) {
          Alpine.store('ui').toast(`Plex download failed: ${error}`, 'error', 5000);
        }
      });

      const unlistenSync = await listen('plex-sync-complete', () => {
        this._onPlexSyncComplete();
      });

      this._plexListeners = () => {
        unlistenProgress();
        unlistenFailed();
        unlistenSync();
      };
    },

    _startPlexBatch(trackIds) {
      const ui = Alpine.store('ui');
      if (this._plexBatchDismissTimer) {
        clearTimeout(this._plexBatchDismissTimer);
        if (this._plexBatchDismissToastId) {
          ui.dismissToast(this._plexBatchDismissToastId);
          this._plexBatchDismissToastId = null;
        }
        this._plexBatchDismissTimer = null;
      }
      if (this._plexBatch?.toastId) {
        for (const id of trackIds) this._plexBatch.pendingIds.add(id);
        this._plexBatch.total += trackIds.length;
        ui.updateToast(this._plexBatch.toastId, this._plexBatchMessage());
        return;
      }
      const total = trackIds.length;
      const toastId = ui.toast(`0 / ${total} tracks downloaded`, 'info', 0);
      this._plexBatch = { total, completed: 0, failed: 0, toastId, pendingIds: new Set(trackIds) };
    },

    _plexBatchMessage() {
      const { total, completed, failed } = this._plexBatch;
      const base = `${completed} / ${total} tracks downloaded`;
      return failed > 0 ? `${base} (${failed} failed)` : base;
    },

    _plexBatchTrackDone(trackId, succeeded) {
      if (!this._plexBatch) return;
      this._plexBatch.pendingIds.delete(trackId);
      if (succeeded) {
        this._plexBatch.completed++;
      } else {
        this._plexBatch.failed++;
      }
      const { total, completed, failed, toastId } = this._plexBatch;
      const ui = Alpine.store('ui');
      if (completed + failed >= total) {
        const delay = failed > 0 ? 5000 : 3000;
        if (failed === 0) {
          ui.updateToast(toastId, `${total} track${total === 1 ? '' : 's'} downloaded`);
        } else {
          ui.updateToast(toastId, `${completed} downloaded, ${failed} failed`, 'warning');
        }
        this._plexBatch = null;
        this._plexBatchDismissToastId = toastId;
        this._plexBatchDismissTimer = setTimeout(() => {
          ui.dismissToast(toastId);
          this._plexBatchDismissTimer = null;
          this._plexBatchDismissToastId = null;
        }, delay);
      } else {
        ui.updateToast(toastId, this._plexBatchMessage());
      }
    },

    async _refreshPlexTrack(trackId) {
      try {
        const updated = await libraryApi.getTrack(trackId);
        if (!updated) return;
        if (this._sectionTracks) {
          const idx = this._sectionTracks.findIndex((t) => t.id === trackId);
          if (idx >= 0) {
            this._sectionTracks[idx] = updated;
            this._dataVersion++;
          }
        } else {
          for (const page of Object.values(this._trackPages)) {
            const idx = page.findIndex((t) => t.id === trackId);
            if (idx >= 0) {
              page[idx] = updated;
              this._dataVersion++;
              break;
            }
          }
        }
      } catch (e) {
        console.error('[library] Failed to refresh Plex track:', e);
      }
    },

    isRemote(track) {
      return (
        track?.source === 'plex' &&
        (track.filepath?.startsWith('http://') || track.filepath?.startsWith('https://'))
      );
    },

    setShowRemote(value) {
      this.showRemote = value;
      window.settings.set('library:showRemote', value).catch((err) =>
        console.error('[library] Failed to save showRemote:', err)
      );
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
      if (this._isPaginated()) {
        // With paginated loading, we don't have all tracks to filter against.
        // Just return the tracks as-is since non-"all" sections filter independently.
        return tracks;
      }
      const allTracks = this.filteredTracks;
      if (allTracks.length === 0) return [];
      const ids = new Set(allTracks.map((t) => t.id));
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

    // -----------------------------------------------------------------------
    // Pagination helpers
    // -----------------------------------------------------------------------

    _isPaginated() {
      return this._sectionTracks === null;
    },

    _resetPages() {
      this._loadGeneration++;
      this._trackPages = {};
      this._loadingPages = {};
      this._allPagesLoaded = false;
      this._sectionTracks = null;
    },

    _setSectionTracks(tracks) {
      this._sectionTracks = tracks;
      this._trackPages = {};
      this._loadingPages = {};
      this._allPagesLoaded = true;
    },

    _fetchPage(pageIndex) {
      if (this._trackPages[pageIndex]) return;
      // Return the in-flight promise so concurrent awaiters share one IPC round-trip
      if (this._loadingPages[pageIndex]) return this._loadingPages[pageIndex];
      const gen = this._loadGeneration;
      const promise = this._doFetchPage(pageIndex, gen);
      this._loadingPages[pageIndex] = promise;
      return promise;
    },

    async _doFetchPage(pageIndex, gen) {
      try {
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

        const data = await libraryApi.getTracks({
          search: this.searchQuery.trim() || null,
          sort: sortKeyMap[this.sortBy] || this.sortBy,
          order: this.sortOrder,
          limit: this._pageSize,
          offset: pageIndex * this._pageSize,
          ignoreWords,
        });

        // Discard stale response
        if (this._loadGeneration !== gen) return;

        const tracks = data.tracks || [];
        this._trackPages[pageIndex] = tracks;

        if (tracks.length < this._pageSize) {
          this._allPagesLoaded = true;
        }

        // Trigger Alpine reactivity by incrementing version
        this._dataVersion++;

        console.log('[library] page loaded:', {
          pageIndex,
          trackCount: tracks.length,
          totalPages: Math.ceil(this.totalTracks / this._pageSize),
        });
      } catch (error) {
        console.error('[library] page fetch failed:', {
          pageIndex,
          error: error.message,
        });
      } finally {
        if (this._loadGeneration === gen) {
          delete this._loadingPages[pageIndex];
        }
      }
    },

    _ensurePage(pageIndex) {
      if (pageIndex < 0) return;
      const maxPage = Math.ceil(this.totalTracks / this._pageSize) - 1;
      if (pageIndex > maxPage) return;
      if (!this._trackPages[pageIndex] && !this._loadingPages[pageIndex]) {
        this._fetchPage(pageIndex);
      }
    },

    getTrackAtIndex(i) {
      if (this._sectionTracks) {
        return this._sectionTracks[i] || null;
      }
      const pageIndex = Math.floor(i / this._pageSize);
      const page = this._trackPages[pageIndex];
      if (!page) return null;
      return page[i % this._pageSize] || null;
    },

    async _loadAllPages() {
      if (this._allPagesLoaded) return;
      const totalPages = Math.ceil(this.totalTracks / this._pageSize);
      const unloaded = [];
      for (let i = 0; i < totalPages; i++) {
        if (!this._trackPages[i] && !this._loadingPages[i]) {
          unloaded.push(i);
        }
      }
      // Fetch in batches of 4
      for (let i = 0; i < unloaded.length; i += 4) {
        const batch = unloaded.slice(i, i + 4);
        await Promise.all(batch.map((p) => this._fetchPage(p)));
      }
      this._allPagesLoaded = true;
    },

    // -----------------------------------------------------------------------
    // Backward-compatible getters for code that iterates all loaded tracks
    // -----------------------------------------------------------------------

    get filteredTracks() {
      void this._dataVersion;
      // For non-paginated sections, return the flat array
      const base = this._sectionTracks ?? (() => {
        const result = [];
        const pageCount = Math.ceil(this.totalTracks / this._pageSize);
        for (let i = 0; i < pageCount; i++) {
          const page = this._trackPages[i];
          if (page) result.push(...page);
        }
        return result;
      })();

      if (!this.showRemote) {
        return base.filter((t) => !this.isRemote(t));
      }
      return base;
    },

    get tracks() {
      return this.filteredTracks;
    },

    get allTracks() {
      return this.filteredTracks;
    },

    // Setters for backward compat (used by applySectionData, removeTracksLocallyOp, etc.)
    set filteredTracks(val) {
      this._setSectionTracks(val);
    },

    set tracks(val) {
      this._setSectionTracks(val);
    },

    set allTracks(_val) {
      // No-op — allTracks is derived from tracks/filteredTracks
    },

    // -----------------------------------------------------------------------
    // Sort/filter params for API calls
    // -----------------------------------------------------------------------

    _getSortParams() {
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
      return {
        search: this.searchQuery.trim() || null,
        sort: sortKeyMap[this.sortBy] || this.sortBy,
        order: this.sortOrder,
        ignoreWords: uiStore.sortIgnoreWords ? uiStore.sortIgnoreWordsList : null,
      };
    },

    _getFilterParams() {
      return this._getSortParams();
    },

    async _fetchLibraryData() {
      const params = this._getSortParams();
      return await libraryApi.getTracks({
        ...params,
        limit: 999999,
        offset: 0,
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
      return this._loadSection('liked', null);
    },

    _backgroundRefreshFavorites() {
      // Preserve original matching: currentSection === 'liked' OR _lastLoadedSection === 'liked'
      const section = this.currentSection === 'liked' || this._lastLoadedSection === 'liked'
        ? 'liked'
        : null;
      if (!section) return;
      return this._backgroundRefreshSection('liked', null);
    },

    loadRecentlyPlayed(days = 14) {
      return this._loadSection('recent', null, { days });
    },

    _backgroundRefreshRecentlyPlayed(days = 14) {
      return this._backgroundRefreshSection('recent', null, { days });
    },

    loadRecentlyAdded(days = 14) {
      return this._loadSection('added', null, { days });
    },

    _backgroundRefreshRecentlyAdded(days = 14) {
      return this._backgroundRefreshSection('added', null, { days });
    },

    loadTop25() {
      return this._loadSection('top25', null);
    },

    _backgroundRefreshTop25() {
      return this._backgroundRefreshSection('top25', null);
    },

    loadPlaylist(playlistId) {
      const section = `playlist-${playlistId}`;

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
          trackCount: this.filteredTracks.length,
        });
        return data;
      };

      console.log('[navigation]', 'load_playlist', { playlistId });

      // The unified endpoint returns flat Track objects for playlists
      return this._loadSection(section, null, {
        onSuccess: cachePlaylist,
        logTag: 'navigation',
      });
    },

    _backgroundRefreshPlaylist(playlistId) {
      const section = `playlist-${playlistId}`;

      return this._backgroundRefreshSection(section, null, {
        onSuccess: (data) => {
          this._sectionCache[section] = {
            totalTracks: this.totalTracks,
            totalDuration: this.totalDuration,
            playlistName: data.name,
            timestamp: Date.now(),
          };
          this._persistCache();
        },
      });
    },

    _onPlexSyncComplete() {
      this._backgroundRefresh('all');
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
      window.dispatchEvent(
        new CustomEvent('mt:section-change', { detail: { section } }),
      );
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
      // No-op for paginated mode — filtering is done server-side.
      // For non-paginated sections this is called by applySectionData which
      // sets _sectionTracks directly.
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

    // Filter track IDs from the current view without recomputing totals.
    // Authoritative totals come from the backend reconcile event.
    _removeFromView(idSet) {
      if (this._sectionTracks) {
        const newTracks = this._sectionTracks.filter((t) => !idSet.has(t.id));
        window.Alpine.disableEffectScheduling(() => {
          this._setSectionTracks(newTracks);
          this._dataVersion++;
        });
      } else {
        for (const [pageIdx, page] of Object.entries(this._trackPages)) {
          this._trackPages[pageIdx] = page.filter((t) => !idSet.has(t.id));
        }
        this._dataVersion++;
      }
      this._clearCache();
    },

    async remove(trackId) {
      try {
        // Optimistic visual removal; reconcile event will provide authoritative totals
        this._removeFromView(new Set([trackId]));
        this._removeFromQueue(new Set([trackId]));
        await libraryApi.deleteTrack(trackId);
      } catch (error) {
        console.error('Failed to remove track:', error);
        // Rollback: re-fetch from backend
        this.fetchTracks();
        throw error;
      }
    },

    getTrack(trackId) {
      // Search loaded pages/section tracks
      if (this._sectionTracks) {
        return this._sectionTracks.find((t) => t.id === trackId) || null;
      }
      for (const page of Object.values(this._trackPages)) {
        const found = page.find((t) => t.id === trackId);
        if (found) return found;
      }
      return null;
    },

    async getTrackAsync(trackId) {
      const local = this.getTrack(trackId);
      if (local) return local;
      try {
        return await libraryApi.getTrack(trackId);
      } catch (error) {
        console.error('[library] getTrackAsync failed:', error);
        return null;
      }
    },

    // -----------------------------------------------------------------------
    // Type-to-jump backend-assisted offset lookup
    // -----------------------------------------------------------------------

    async _jumpToPrefix(prefix) {
      try {
        const params = this._getSortParams();
        const offset = await libraryApi.findOffset({
          ...params,
          prefix,
        });
        if (offset === null || offset === undefined) return null;

        return offset;
      } catch (error) {
        console.error('[library] _jumpToPrefix failed:', error);
        return null;
      }
    },

    // -----------------------------------------------------------------------
    // Queue operations
    // -----------------------------------------------------------------------

    async addToQueue(track, playNow = false) {
      await Alpine.store('queue').add(track, playNow);
    },

    async addAllToQueue(playNow = false) {
      // For paginated mode, load all pages first
      if (this._isPaginated() && !this._allPagesLoaded) {
        await this._loadAllPages();
      }
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
      const tracks = this.filteredTracks;
      const artistSet = new Set(tracks.map((t) => t.artist).filter(Boolean));
      return Array.from(artistSet).sort();
    },

    get albums() {
      const tracks = this.filteredTracks;
      const albumSet = new Set(tracks.map((t) => t.album).filter(Boolean));
      return Array.from(albumSet).sort();
    },

    // -----------------------------------------------------------------------
    // Rescan and scan progress
    // -----------------------------------------------------------------------

    async rescanTrack(trackId) {
      try {
        const updatedTrack = await libraryApi.rescanTrack(trackId);
        if (updatedTrack) {
          // Update track in the appropriate storage
          if (this._sectionTracks) {
            const index = this._sectionTracks.findIndex(
              (t) => t.id === trackId,
            );
            if (index >= 0) {
              this._sectionTracks[index] = updatedTrack;
              this._dataVersion++;
            }
          } else {
            for (const page of Object.values(this._trackPages)) {
              const index = page.findIndex((t) => t.id === trackId);
              if (index >= 0) {
                page[index] = updatedTrack;
                this._dataVersion++;
                break;
              }
            }
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
