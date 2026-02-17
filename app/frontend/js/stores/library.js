/**
 * Library Store - manages music library state
 *
 * Handles track loading, searching, sorting, and
 * library scanning via Python backend.
 */

import { api } from '../api.js';
import { promptToAddWatchedFolders } from '../utils/watched-folders.js';

const { listen } = window.__TAURI__?.event ?? { listen: () => Promise.resolve(() => {}) };

export function createLibraryStore(Alpine) {
  const getInitialSection = () => {
    let section = 'all';

    if (window.settings?.initialized) {
      section = window.settings.get('sidebar:activeSection', section);
    } else {
      const legacySidebar = localStorage.getItem('mt:sidebar');
      if (legacySidebar) {
        try {
          const parsed = JSON.parse(legacySidebar);
          if (parsed?.activeSection) {
            section = parsed.activeSection;
          }
        } catch (_e) {
          // Ignore malformed legacy sidebar storage
        }
      }
    }

    return section;
  };

  Alpine.store('library', {
    // Track data
    tracks: [], // All tracks in library
    filteredTracks: [], // Tracks after search/filter

    // Search and filter state
    searchQuery: '',
    sortBy: 'default', // 'default', 'artist', 'album', 'title', 'index', 'dateAdded', 'duration'
    sortOrder: 'asc', // 'asc', 'desc'
    currentSection: getInitialSection(),

    // Loading state
    loading: false,
    scanning: false,
    scanProgress: 0, // 0-100
    scanStatus: null, // Current scan status string
    scanJobId: null, // Current scan job ID

    // Statistics
    totalTracks: 0,
    totalDuration: 0, // milliseconds

    // Internal
    _searchDebounce: null,
    _saveCacheDebounce: null, // Debounce timer for cache persistence
    _watchedFolderListener: null,
    _lastLoadedSection: null, // Track which section the current data belongs to
    _sectionCache: {}, // { sectionId: { totalTracks, totalDuration, timestamp } } — summary only, no track arrays
    _backgroundRefreshing: false, // Prevent concurrent background refreshes

    /**
     * Initialize library from backend
     */
    async init() {
      // Load persistent cache first - shows cached data immediately (no spinner)
      const hasCachedData = this._loadCacheFromSettings();

      if (hasCachedData) {
        // Show cached summary stats immediately (sidebar totals)
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
        // Fetch actual tracks from backend (spinner shows only if tracks truly empty)
        await this.load({ forceReload: true });
      } else {
        // No cache - do a full load (will show spinner)
        await this.load({ forceReload: true });
      }

      await this._setupWatchedFolderListener();
    },

    /**
     * Listen for watched folder scan results to auto-reload library
     */
    async _setupWatchedFolderListener() {
      this._watchedFolderListener = await listen('watched-folder:results', (event) => {
        const { added, updated, deleted } = event.payload || {};
        console.log('[library] watched-folder:results', { added, updated, deleted });

        // Reload library if any tracks were added, updated, or deleted
        if (added > 0 || updated > 0 || deleted > 0) {
          console.log('[library] Reloading library after watched folder scan');
          this._clearCache(); // Clear cache so fresh data is fetched
          this.load({ forceReload: true });
        }
      });
    },

    /**
     * Update cache for a section with fresh data
     */
    _updateCache(section, data) {
      const tracks = data.tracks || [];
      this._sectionCache[section] = {
        totalTracks: data.total || tracks.length,
        totalDuration: tracks.reduce((sum, t) => sum + (t.duration || 0), 0),
        timestamp: Date.now(),
      };
      // Persist cache to settings (non-blocking)
      this._saveCacheToSettings();
    },

    /**
     * Clear all cached section data
     */
    _clearCache(section = null) {
      if (section) {
        delete this._sectionCache[section];
        console.log('[library] cache cleared for section:', section);
      } else {
        this._sectionCache = {};
        console.log('[library] cache cleared (all sections)');
      }
      // Persist cleared cache to settings (non-blocking)
      this._saveCacheToSettings();
    },

    /**
     * Load cached section data from persistent settings
     * Called during init() to show cached data immediately
     */
    _loadCacheFromSettings() {
      if (!window.settings?.initialized) {
        console.log('[library] settings not initialized, skipping cache load');
        return false;
      }

      try {
        const cached = window.settings.get('library:sectionCache', null);
        if (cached && typeof cached === 'object') {
          // Validate cache structure - include library sections and playlists
          const validSections = ['all', 'liked', 'recent', 'added', 'top25'];
          let loadedCount = 0;

          for (const [section, data] of Object.entries(cached)) {
            // Accept standard sections or playlist-* sections
            const isValidSection = validSections.includes(section) ||
              section.startsWith('playlist-');
            if (isValidSection && data?.totalTracks > 0) {
              // Strip any legacy tracks array from persisted cache to save memory
              const { tracks: _tracks, ...summary } = data;
              this._sectionCache[section] = summary;
              loadedCount++;
            }
          }

          if (loadedCount > 0) {
            console.log('[library] loaded persistent cache:', {
              sections: Object.keys(this._sectionCache),
              totalTracks: Object.values(this._sectionCache).reduce(
                (sum, s) => sum + (s.totalTracks || 0),
                0,
              ),
            });
            return true;
          }
        }
      } catch (error) {
        console.error('[library] failed to load cache from settings:', error);
      }
      return false;
    },

    /**
     * Save cached section data to persistent settings
     * Called after cache updates to persist across app restarts
     */
    _saveCacheToSettings() {
      if (!window.settings?.initialized) {
        return;
      }

      // Debounce saves to avoid excessive writes
      if (this._saveCacheDebounce) {
        clearTimeout(this._saveCacheDebounce);
      }

      this._saveCacheDebounce = setTimeout(async () => {
        try {
          await window.settings.set('library:sectionCache', this._sectionCache);
          console.log('[library] cache persisted to settings');
        } catch (error) {
          console.error('[library] failed to save cache to settings:', error);
        }
      }, 500); // 500ms debounce
    },

    /**
     * Fetch library data from backend API
     */
    async _fetchLibraryData() {
      // Map frontend sort keys to backend column names
      const sortKeyMap = {
        default: 'album',
        index: 'track_number',
        dateAdded: 'added_date',
        lastPlayed: 'last_played',
        playCount: 'play_count',
        year: 'date',
        genre: 'genre',
        trackTotal: 'track_total',
        discNumber: 'disc_number',
      };

      return await api.library.getTracks({
        search: this.searchQuery.trim() || null,
        sort: sortKeyMap[this.sortBy] || this.sortBy,
        order: this.sortOrder,
        limit: 999999,
        offset: 0,
      });
    },

    /**
     * Silently refresh data in background without showing spinner
     */
    async _backgroundRefresh(section) {
      // Prevent concurrent background refreshes for same section
      if (this._backgroundRefreshing) {
        return;
      }

      this._backgroundRefreshing = true;

      try {
        console.log('[library] background refresh starting for:', section);
        const data = await this._fetchLibraryData();

        // Only update if still on same section
        if (this.currentSection === section) {
          this.tracks = data.tracks || [];
          this.totalTracks = data.total || this.tracks.length;
          this.totalDuration = this.tracks.reduce((sum, t) => sum + (t.duration || 0), 0);
          this._updateCache(section, data);
          this.applyFilters();

          console.log('[library] background refresh complete:', {
            section,
            trackCount: this.tracks.length,
          });
        }
      } catch (error) {
        // Silent fail for background refresh
        console.log('[library] background refresh failed:', error.message);
      } finally {
        this._backgroundRefreshing = false;
      }
    },

    /**
     * Load library tracks from backend
     * @param {Object} options - Load options
     * @param {boolean} options.forceReload - Force reload even if data exists (default: false)
     */
    async load({ forceReload = false } = {}) {
      if (this.currentSection?.startsWith('playlist-')) {
        console.log('[library]', 'load_skipped', {
          reason: 'playlist_view',
          section: this.currentSection,
        });
        return;
      }

      const loadSection = this.currentSection;
      const cached = this._sectionCache[loadSection];

      // Show cached summary stats if available (previous tracks stay visible during fetch)
      if (cached && !forceReload) {
        console.log('[library]', 'load_with_cache_summary', {
          section: loadSection,
          totalTracks: cached.totalTracks,
          cacheAge: Math.round((Date.now() - cached.timestamp) / 1000) + 's',
        });
        this.totalTracks = cached.totalTracks;
        this.totalDuration = cached.totalDuration;
        this._lastLoadedSection = loadSection;
        // Fall through to fetch below — tracks stay from previous section (no flash)
      }

      console.log('[library]', 'load', {
        action: 'loading_library',
        section: loadSection,
        forceReload,
        hasCachedData: !!cached,
      });

      this.loading = true;
      // DON'T clear tracks - keep showing previous data while loading
      // This prevents spinner from showing when switching between sections
      // The spinner only shows when library.loading && library.tracks.length === 0

      try {
        const data = await this._fetchLibraryData();

        if (this.currentSection !== loadSection || this.currentSection?.startsWith('playlist-')) {
          console.log('[library]', 'load_discarded', {
            startedIn: loadSection,
            currentSection: this.currentSection,
          });
          return;
        }

        this.tracks = data.tracks || [];
        this.totalTracks = data.total || this.tracks.length;
        this.totalDuration = this.tracks.reduce((sum, t) => sum + (t.duration || 0), 0);
        this._lastLoadedSection = loadSection;
        this._updateCache(loadSection, data);

        this.applyFilters();

        console.log('[library]', 'load_complete', {
          trackCount: this.tracks.length,
          totalDuration: Math.round(this.totalDuration / 1000) + 's',
          section: loadSection,
        });
      } catch (error) {
        console.error('[library]', 'load_error', { error: error.message });
        // Ensure tracks stay cleared on error
        this.tracks = [];
        this.filteredTracks = [];
      } finally {
        this.loading = false;
      }
    },

    async loadFavorites() {
      const section = 'liked';
      const cached = this._sectionCache[section];

      // Show cached summary stats if available (previous tracks stay visible during fetch)
      if (cached) {
        console.log('[library]', 'loadFavorites_with_cache_summary', {
          totalTracks: cached.totalTracks,
        });
        this.totalTracks = cached.totalTracks;
        this.totalDuration = cached.totalDuration;
        this._lastLoadedSection = section;
      }

      this.loading = true;
      // DON'T clear tracks - keep showing previous data while loading
      try {
        const data = await api.favorites.get({ limit: 1000 });
        this.tracks = data.tracks || [];
        this.totalTracks = this.tracks.length;
        this.totalDuration = this.tracks.reduce((sum, t) => sum + (t.duration || 0), 0);
        this._lastLoadedSection = section;
        this._updateCache(section, { tracks: this.tracks, total: this.totalTracks });
        this.applyFilters();
      } catch (error) {
        console.error('Failed to load favorites:', error);
        this.tracks = [];
        this.filteredTracks = [];
      } finally {
        this.loading = false;
      }
    },

    async _backgroundRefreshFavorites() {
      if (this._backgroundRefreshing) return;
      this._backgroundRefreshing = true;
      try {
        const data = await api.favorites.get({ limit: 1000 });
        if (this.currentSection === 'liked' || this._lastLoadedSection === 'liked') {
          this.tracks = data.tracks || [];
          this.totalTracks = this.tracks.length;
          this.totalDuration = this.tracks.reduce((sum, t) => sum + (t.duration || 0), 0);
          this._updateCache('liked', { tracks: this.tracks, total: this.totalTracks });
          this.applyFilters();
        }
      } catch (e) {
        console.log('[library] background refresh favorites failed:', e.message);
      } finally {
        this._backgroundRefreshing = false;
      }
    },

    async loadRecentlyPlayed(days = 14) {
      const section = 'recent';
      const cached = this._sectionCache[section];

      // Show cached summary stats if available (previous tracks stay visible during fetch)
      if (cached) {
        console.log('[library]', 'loadRecentlyPlayed_with_cache_summary', {
          totalTracks: cached.totalTracks,
        });
        this.totalTracks = cached.totalTracks;
        this.totalDuration = cached.totalDuration;
        this._lastLoadedSection = section;
      }

      this.loading = true;
      // DON'T clear tracks - keep showing previous data while loading
      try {
        const data = await api.favorites.getRecentlyPlayed({ days, limit: 100 });
        this.tracks = data.tracks || [];
        this.totalTracks = this.tracks.length;
        this.totalDuration = this.tracks.reduce((sum, t) => sum + (t.duration || 0), 0);
        this._lastLoadedSection = section;
        this._updateCache(section, { tracks: this.tracks, total: this.totalTracks });
        this.applyFilters();
      } catch (error) {
        console.error('Failed to load recently played:', error);
        this.tracks = [];
        this.filteredTracks = [];
      } finally {
        this.loading = false;
      }
    },

    async _backgroundRefreshRecentlyPlayed(days = 14) {
      if (this._backgroundRefreshing) return;
      this._backgroundRefreshing = true;
      try {
        const data = await api.favorites.getRecentlyPlayed({ days, limit: 100 });
        if (this._lastLoadedSection === 'recent') {
          this.tracks = data.tracks || [];
          this.totalTracks = this.tracks.length;
          this.totalDuration = this.tracks.reduce((sum, t) => sum + (t.duration || 0), 0);
          this._updateCache('recent', { tracks: this.tracks, total: this.totalTracks });
          this.applyFilters();
        }
      } catch (e) {
        console.log('[library] background refresh recently played failed:', e.message);
      } finally {
        this._backgroundRefreshing = false;
      }
    },

    async loadRecentlyAdded(days = 14) {
      const section = 'added';
      const cached = this._sectionCache[section];

      // Show cached summary stats if available (previous tracks stay visible during fetch)
      if (cached) {
        console.log('[library]', 'loadRecentlyAdded_with_cache_summary', {
          totalTracks: cached.totalTracks,
        });
        this.totalTracks = cached.totalTracks;
        this.totalDuration = cached.totalDuration;
        this._lastLoadedSection = section;
      }

      this.loading = true;
      // DON'T clear tracks - keep showing previous data while loading
      try {
        const data = await api.favorites.getRecentlyAdded({ days, limit: 100 });
        this.tracks = data.tracks || [];
        this.totalTracks = this.tracks.length;
        this.totalDuration = this.tracks.reduce((sum, t) => sum + (t.duration || 0), 0);
        this._lastLoadedSection = section;
        this._updateCache(section, { tracks: this.tracks, total: this.totalTracks });
        this.applyFilters();
      } catch (error) {
        console.error('Failed to load recently added:', error);
        this.tracks = [];
        this.filteredTracks = [];
      } finally {
        this.loading = false;
      }
    },

    async _backgroundRefreshRecentlyAdded(days = 14) {
      if (this._backgroundRefreshing) return;
      this._backgroundRefreshing = true;
      try {
        const data = await api.favorites.getRecentlyAdded({ days, limit: 100 });
        if (this._lastLoadedSection === 'added') {
          this.tracks = data.tracks || [];
          this.totalTracks = this.tracks.length;
          this.totalDuration = this.tracks.reduce((sum, t) => sum + (t.duration || 0), 0);
          this._updateCache('added', { tracks: this.tracks, total: this.totalTracks });
          this.applyFilters();
        }
      } catch (e) {
        console.log('[library] background refresh recently added failed:', e.message);
      } finally {
        this._backgroundRefreshing = false;
      }
    },

    async loadTop25() {
      const section = 'top25';
      const cached = this._sectionCache[section];

      // Show cached summary stats if available (previous tracks stay visible during fetch)
      if (cached) {
        console.log('[library]', 'loadTop25_with_cache_summary', {
          totalTracks: cached.totalTracks,
        });
        this.totalTracks = cached.totalTracks;
        this.totalDuration = cached.totalDuration;
        this._lastLoadedSection = section;
      }

      this.loading = true;
      // DON'T clear tracks - keep showing previous data while loading
      try {
        const data = await api.favorites.getTop25();
        this.tracks = data.tracks || [];
        this.totalTracks = this.tracks.length;
        this.totalDuration = this.tracks.reduce((sum, t) => sum + (t.duration || 0), 0);
        this._lastLoadedSection = section;
        this._updateCache(section, { tracks: this.tracks, total: this.totalTracks });
        this.applyFilters();
      } catch (error) {
        console.error('Failed to load top 25:', error);
        this.tracks = [];
        this.filteredTracks = [];
      } finally {
        this.loading = false;
      }
    },

    async _backgroundRefreshTop25() {
      if (this._backgroundRefreshing) return;
      this._backgroundRefreshing = true;
      try {
        const data = await api.favorites.getTop25();
        if (this._lastLoadedSection === 'top25') {
          this.tracks = data.tracks || [];
          this.totalTracks = this.tracks.length;
          this.totalDuration = this.tracks.reduce((sum, t) => sum + (t.duration || 0), 0);
          this._updateCache('top25', { tracks: this.tracks, total: this.totalTracks });
          this.applyFilters();
        }
      } catch (e) {
        console.log('[library] background refresh top25 failed:', e.message);
      } finally {
        this._backgroundRefreshing = false;
      }
    },

    async loadPlaylist(playlistId) {
      const section = `playlist-${playlistId}`;
      const cached = this._sectionCache[section];

      // Show cached summary stats if available (previous tracks stay visible during fetch)
      if (cached) {
        console.log('[navigation]', 'load_playlist_with_cache_summary', {
          playlistId,
          totalTracks: cached.totalTracks,
        });
        this.totalTracks = cached.totalTracks;
        this.totalDuration = cached.totalDuration;
        this._lastLoadedSection = section;
      }

      console.log('[navigation]', 'load_playlist', {
        playlistId,
      });

      this.loading = true;
      // DON'T clear tracks - keep showing previous data while loading
      try {
        const data = await api.playlists.get(playlistId);
        this.tracks = (data.tracks || []).map((item) => item.track || item);
        this.totalTracks = this.tracks.length;
        this.totalDuration = this.tracks.reduce((sum, t) => sum + (t.duration || 0), 0);
        this._lastLoadedSection = section;

        // Cache playlist summary (no track arrays — saves memory)
        this._sectionCache[section] = {
          totalTracks: this.totalTracks,
          totalDuration: this.totalDuration,
          playlistName: data.name,
          timestamp: Date.now(),
        };
        this._saveCacheToSettings();

        this.applyFilters();

        console.log('[navigation]', 'load_playlist_complete', {
          playlistId,
          playlistName: data.name,
          trackCount: this.tracks.length,
        });

        return data;
      } catch (error) {
        console.error('[navigation]', 'load_playlist_error', {
          playlistId,
          error: error.message,
        });
        this.tracks = [];
        this.filteredTracks = [];
        return null;
      } finally {
        this.loading = false;
      }
    },

    async _backgroundRefreshPlaylist(playlistId) {
      if (this._backgroundRefreshing) return;
      this._backgroundRefreshing = true;
      const section = `playlist-${playlistId}`;
      try {
        const data = await api.playlists.get(playlistId);
        if (this._lastLoadedSection === section) {
          this.tracks = (data.tracks || []).map((item) => item.track || item);
          this.totalTracks = this.tracks.length;
          this.totalDuration = this.tracks.reduce((sum, t) => sum + (t.duration || 0), 0);
          this._sectionCache[section] = {
            totalTracks: this.totalTracks,
            totalDuration: this.totalDuration,
            playlistName: data.name,
            timestamp: Date.now(),
          };
          this._saveCacheToSettings();
          this.applyFilters();
        }
      } catch (e) {
        console.log('[library] background refresh playlist failed:', e.message);
      } finally {
        this._backgroundRefreshing = false;
      }
    },

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

    /**
     * Search tracks with debounce
     * @param {string} query - Search query
     */
    search(query) {
      this.searchQuery = query;

      if (this._searchDebounce) {
        clearTimeout(this._searchDebounce);
      }

      // Debounce and reload from backend with search parameter
      this._searchDebounce = setTimeout(() => {
        this.load({ forceReload: true });
      }, 150);
    },

    /**
     * Strip ignored prefixes from a string for sorting
     * @param {string} value - String to process
     * @param {string[]} ignoreWords - Array of prefixes to ignore
     * @returns {string} String with prefix removed
     */
    _stripIgnoredPrefix(value, ignoreWords) {
      if (!value || !ignoreWords || ignoreWords.length === 0) {
        return String(value || '').trim();
      }

      const str = String(value).trim();
      const lowerStr = str.toLowerCase();

      for (const word of ignoreWords) {
        const prefix = word.trim().toLowerCase();
        if (!prefix) continue;

        // Check if string starts with prefix followed by a space
        if (lowerStr.startsWith(prefix + ' ')) {
          return str.substring(prefix.length + 1).trim();
        }
      }

      return str;
    },

    /**
     * Apply client-side filters (ignore-words normalization only)
     * Backend now handles search and primary sorting
     */
    applyFilters() {
      // Backend already did search/sort, we only apply ignore-words normalization
      const result = [...this.tracks];

      // Skip client-side sorting for playlists - they should maintain their stored order
      const isPlaylistView = this.currentSection?.startsWith('playlist-');
      if (isPlaylistView) {
        this.filteredTracks = result;
        return;
      }

      const uiStore = Alpine.store('ui');
      const ignoreWordsEnabled = uiStore.sortIgnoreWords;
      const ignoreWords = ignoreWordsEnabled
        ? uiStore.sortIgnoreWordsList.split(',').map((w) => w.trim()).filter(Boolean)
        : [];

      // Only re-sort if ignore-words is enabled AND sorting by text field
      const textSortFields = ['artist', 'album', 'title', 'default'];
      if (ignoreWordsEnabled && ignoreWords.length > 0 && textSortFields.includes(this.sortBy)) {
        const sortKey = this.sortBy === 'default' ? 'album' : this.sortBy;
        const dir = this.sortOrder === 'desc' ? -1 : 1;

        // Build canonical artist per album (MIN of album_artist/artist across all tracks
        // in the same album). This keeps soundtrack/compilation albums together even when
        // per-track artists differ.
        const canonicalArtistMap = new Map();
        if (sortKey === 'artist') {
          for (const track of result) {
            const album = track.album || '';
            const artist = track.album_artist || track.artist || '';
            const existing = canonicalArtistMap.get(album);
            if (existing === undefined || artist < existing) {
              canonicalArtistMap.set(album, artist);
            }
          }
        }

        // Build dominant disc per album so null disc_number tracks sort alongside
        // their siblings instead of being forced to disc 1.
        const dominantDiscMap = new Map();
        for (const track of result) {
          const album = track.album || '';
          if (track.disc_number != null) {
            const d = parseInt(String(track.disc_number).split('/')[0], 10) || 1;
            const counts = dominantDiscMap.get(album) || new Map();
            counts.set(d, (counts.get(d) || 0) + 1);
            dominantDiscMap.set(album, counts);
          }
        }
        // Resolve each album to its most common disc number
        for (const [album, counts] of dominantDiscMap) {
          let bestDisc = 1;
          let bestCount = 0;
          for (const [disc, count] of counts) {
            if (count > bestCount) {
              bestCount = count;
              bestDisc = disc;
            }
          }
          dominantDiscMap.set(album, bestDisc);
        }

        result.sort((a, b) => {
          // Primary sort with ignore-words stripping
          // For artist sort, use canonical album artist to group albums together
          const aRaw = sortKey === 'artist'
            ? (canonicalArtistMap.get(a.album || '') || a.album_artist || a.artist || '')
            : (a[sortKey] || '');
          const bRaw = sortKey === 'artist'
            ? (canonicalArtistMap.get(b.album || '') || b.album_artist || b.artist || '')
            : (b[sortKey] || '');
          const aVal = this._stripIgnoredPrefix(aRaw, ignoreWords).toLowerCase();
          const bVal = this._stripIgnoredPrefix(bRaw, ignoreWords).toLowerCase();

          if (aVal < bVal) return -dir;
          if (aVal > bVal) return dir;

          // Tiebreaker 1: Album (if not primary sort key)
          if (sortKey !== 'album') {
            const aAlbum = this._stripIgnoredPrefix(a.album || '', ignoreWords).toLowerCase();
            const bAlbum = this._stripIgnoredPrefix(b.album || '', ignoreWords).toLowerCase();
            if (aAlbum < bAlbum) return -1;
            if (aAlbum > bAlbum) return 1;
          }

          // Tiebreaker 2: Disc Number (null inherits album's dominant disc)
          const aDisc = a.disc_number != null
            ? (parseInt(String(a.disc_number).split('/')[0], 10) || 1)
            : (dominantDiscMap.get(a.album || '') || 1);
          const bDisc = b.disc_number != null
            ? (parseInt(String(b.disc_number).split('/')[0], 10) || 1)
            : (dominantDiscMap.get(b.album || '') || 1);
          if (aDisc < bDisc) return -1;
          if (aDisc > bDisc) return 1;

          // Tiebreaker 3: Track Number
          const aTrack = parseInt(String(a.track_number || '').split('/')[0], 10) || 999999;
          const bTrack = parseInt(String(b.track_number || '').split('/')[0], 10) || 999999;
          if (aTrack < bTrack) return -1;
          if (aTrack > bTrack) return 1;

          // Tiebreaker 4: Artist (if not primary sort key)
          if (sortKey !== 'artist') {
            const aArtist = this._stripIgnoredPrefix(a.album_artist || a.artist || '', ignoreWords)
              .toLowerCase();
            const bArtist = this._stripIgnoredPrefix(b.album_artist || b.artist || '', ignoreWords)
              .toLowerCase();
            if (aArtist < bArtist) return -1;
            if (aArtist > bArtist) return 1;
          }

          return 0;
        });
      }

      this.filteredTracks = result;
    },

    /**
     * Set sort field
     * @param {string} field - Field to sort by
     */
    setSortBy(field) {
      console.log('[library]', 'setSortBy', { field });

      if (this.sortBy === field) {
        this.sortOrder = this.sortOrder === 'asc' ? 'desc' : 'asc';
      } else {
        this.sortBy = field;
        this.sortOrder = 'asc';
      }

      // Reload from backend with new sort parameters
      this.load({ forceReload: true });
    },

    /**
     * Scan paths for music files
     * @param {string[]} paths - File or directory paths to scan
     * @param {boolean} [recursive=true] - Scan subdirectories
     */
    async scan(paths, recursive = true) {
      if (!paths || paths.length === 0) {
        console.log('[library] scan: no paths provided');
        return { added: 0, skipped: 0, errors: 0 };
      }

      console.log('[library] scan: scanning', paths.length, 'paths:', paths);
      this.scanning = true;
      this.scanProgress = 0;

      try {
        const result = await api.library.scan(paths, recursive);
        console.log('[library] scan result:', result);

        await this.load({ forceReload: true });

        return result;
      } catch (error) {
        console.error('[library] scan failed:', error);
        throw error;
      } finally {
        this.scanning = false;
        this.scanProgress = 0;
      }
    },

    async openAddMusicDialog() {
      try {
        console.log('[library] opening add music dialog...');

        if (!window.__TAURI__) {
          throw new Error('Tauri not available');
        }

        const { invoke } = window.__TAURI__.core;
        const paths = await invoke('open_add_music_dialog');

        console.log('[library] dialog returned paths:', paths);

        if (paths && (Array.isArray(paths) ? paths.length > 0 : paths)) {
          const pathArray = Array.isArray(paths) ? paths : [paths];
          const result = await this.scan(pathArray);
          const ui = Alpine.store('ui');
          if (result.added > 0) {
            ui.toast(
              `Added ${result.added} track${result.added === 1 ? '' : 's'} to library`,
              'success',
            );
          } else if (result.skipped > 0) {
            ui.toast(
              `All ${result.skipped} track${result.skipped === 1 ? '' : 's'} already in library`,
              'info',
            );
          } else {
            ui.toast('No audio files found', 'info');
          }

          // Prompt to add parent directories to watched folders
          try {
            await promptToAddWatchedFolders(pathArray);
          } catch (error) {
            console.error('[library] Failed to add watched folders:', error);
            // Don't block - scan already succeeded
          }

          return result;
        } else {
          console.log('[library] dialog cancelled or no paths selected');
        }
        return null;
      } catch (error) {
        console.error('[library] openAddMusicDialog failed:', error);
        Alpine.store('ui').toast('Failed to add music', 'error');
        throw error;
      }
    },

    /**
     * Remove track from library
     * @param {string} trackId - Track ID to remove
     */
    async remove(trackId) {
      try {
        await api.library.deleteTrack(trackId);

        // Update local state
        this.tracks = this.tracks.filter((t) => t.id !== trackId);
        this.totalTracks = this.tracks.length;
        this.totalDuration = this.tracks.reduce((sum, t) => sum + (t.duration || 0), 0);
        this.applyFilters();

        // Also remove from queue if present
        const queue = Alpine.store('queue');
        const queueIndex = queue.items.findIndex((t) => t.id === trackId);
        if (queueIndex >= 0) {
          await queue.remove(queueIndex);
        }
      } catch (error) {
        console.error('Failed to remove track:', error);
        throw error;
      }
    },

    /**
     * Get track by ID
     * @param {string} trackId - Track ID
     * @returns {Object|null} Track object or null
     */
    getTrack(trackId) {
      return this.tracks.find((t) => t.id === trackId) || null;
    },

    /**
     * Add track to queue
     * @param {Object} track - Track to add
     * @param {boolean} playNow - Start playing immediately
     */
    async addToQueue(track, playNow = false) {
      await Alpine.store('queue').add(track, playNow);
    },

    /**
     * Add all filtered tracks to queue
     * @param {boolean} playNow - Start playing immediately
     */
    async addAllToQueue(playNow = false) {
      await Alpine.store('queue').add(this.filteredTracks, playNow);
    },

    /**
     * Play track immediately (clears queue and plays)
     * @param {Object} track - Track to play
     */
    async playNow(track) {
      const queue = Alpine.store('queue');
      await queue.clear();
      await queue.add(track, true);
    },

    /**
     * Format total duration for display
     */
    get formattedTotalDuration() {
      const hours = Math.floor(this.totalDuration / 3600000);
      const minutes = Math.floor((this.totalDuration % 3600000) / 60000);

      if (hours > 0) {
        return `${hours}h ${minutes}m`;
      }
      return `${minutes} min`;
    },

    /**
     * Get unique artists
     */
    get artists() {
      const artistSet = new Set(this.tracks.map((t) => t.artist).filter(Boolean));
      return Array.from(artistSet).sort();
    },

    /**
     * Get unique albums
     */
    get albums() {
      const albumSet = new Set(this.tracks.map((t) => t.album).filter(Boolean));
      return Array.from(albumSet).sort();
    },

    /**
     * Get tracks grouped by artist
     */
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

    /**
     * Set scan progress from Tauri event
     * @param {Object} progress - Scan progress data
     */
    setScanProgress(progress) {
      const { jobId, status, scanned, found, errors, currentPath } = progress;

      this.scanning = true;
      this.scanJobId = jobId;
      this.scanStatus = status;

      // Calculate progress percentage if we have total info
      // For now, just indicate we're scanning
      if (scanned > 0) {
        this.scanProgress = Math.min(99, scanned); // Cap at 99% until complete
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

    /**
     * Clear scan progress state (called when scan completes)
     */
    clearScanProgress() {
      this.scanning = false;
      this.scanProgress = 0;
      this.scanStatus = null;
      this.scanJobId = null;
    },

    /**
     * Fetch tracks from backend (alias for load with forceReload)
     * Used by event system for responding to external changes
     */
    async fetchTracks() {
      this._clearCache(); // Clear cache to ensure fresh data
      await this.load({ forceReload: true });
    },
  });
}
