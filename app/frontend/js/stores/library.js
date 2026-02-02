/**
 * Library Store - manages music library state
 *
 * Handles track loading, searching, sorting, and
 * library scanning via Python backend.
 */

import { api } from '../api.js';

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
    _watchedFolderListener: null,

    /**
     * Initialize library from backend
     */
    async init() {
      await this.load();
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
          this.load();
        }
      });
    },

    async load() {
      if (this.currentSection?.startsWith('playlist-')) {
        console.log('[library]', 'load_skipped', {
          reason: 'playlist_view',
          section: this.currentSection,
        });
        return;
      }

      const loadSection = this.currentSection;

      console.log('[library]', 'load', {
        action: 'loading_library',
        section: loadSection,
      });

      this.loading = true;
      // Clear tracks immediately to prevent showing stale data
      this.tracks = [];
      this.filteredTracks = [];

      try {
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

        // Pass search/sort to backend, remove 10K limit
        const data = await api.library.getTracks({
          search: this.searchQuery.trim() || null,
          sort: sortKeyMap[this.sortBy] || this.sortBy,
          order: this.sortOrder,
          limit: 999999, // Effectively unlimited (backend defaults to 100 with null)
          offset: 0,
        });

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

        // Apply only ignore-words normalization (backend already sorted)
        this.applyFilters();

        console.log('[library]', 'load_complete', {
          trackCount: this.tracks.length,
          totalDuration: Math.round(this.totalDuration / 1000) + 's',
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
      this.loading = true;
      this.tracks = [];
      this.filteredTracks = [];
      try {
        const data = await api.favorites.get({ limit: 1000 });
        this.tracks = data.tracks || [];
        this.totalTracks = this.tracks.length;
        this.totalDuration = this.tracks.reduce((sum, t) => sum + (t.duration || 0), 0);
        this.applyFilters();
      } catch (error) {
        console.error('Failed to load favorites:', error);
        this.tracks = [];
        this.filteredTracks = [];
      } finally {
        this.loading = false;
      }
    },

    async loadRecentlyPlayed(days = 14) {
      this.loading = true;
      this.tracks = [];
      this.filteredTracks = [];
      try {
        const data = await api.favorites.getRecentlyPlayed({ days, limit: 100 });
        this.tracks = data.tracks || [];
        this.totalTracks = this.tracks.length;
        this.totalDuration = this.tracks.reduce((sum, t) => sum + (t.duration || 0), 0);
        this.applyFilters();
      } catch (error) {
        console.error('Failed to load recently played:', error);
        this.tracks = [];
        this.filteredTracks = [];
      } finally {
        this.loading = false;
      }
    },

    async loadRecentlyAdded(days = 14) {
      this.loading = true;
      this.tracks = [];
      this.filteredTracks = [];
      try {
        const data = await api.favorites.getRecentlyAdded({ days, limit: 100 });
        this.tracks = data.tracks || [];
        this.totalTracks = this.tracks.length;
        this.totalDuration = this.tracks.reduce((sum, t) => sum + (t.duration || 0), 0);
        this.applyFilters();
      } catch (error) {
        console.error('Failed to load recently added:', error);
        this.tracks = [];
        this.filteredTracks = [];
      } finally {
        this.loading = false;
      }
    },

    async loadTop25() {
      this.loading = true;
      this.tracks = [];
      this.filteredTracks = [];
      try {
        const data = await api.favorites.getTop25();
        this.tracks = data.tracks || [];
        this.totalTracks = this.tracks.length;
        this.totalDuration = this.tracks.reduce((sum, t) => sum + (t.duration || 0), 0);
        this.applyFilters();
      } catch (error) {
        console.error('Failed to load top 25:', error);
        this.tracks = [];
        this.filteredTracks = [];
      } finally {
        this.loading = false;
      }
    },

    async loadPlaylist(playlistId) {
      console.log('[navigation]', 'load_playlist', {
        playlistId,
      });

      this.loading = true;
      this.tracks = [];
      this.filteredTracks = [];
      try {
        const data = await api.playlists.get(playlistId);
        this.tracks = (data.tracks || []).map((item) => item.track || item);
        this.totalTracks = this.tracks.length;
        this.totalDuration = this.tracks.reduce((sum, t) => sum + (t.duration || 0), 0);
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
        this.load();
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

        result.sort((a, b) => {
          // Primary sort with ignore-words stripping
          const aVal = this._stripIgnoredPrefix(a[sortKey] || '', ignoreWords).toLowerCase();
          const bVal = this._stripIgnoredPrefix(b[sortKey] || '', ignoreWords).toLowerCase();

          if (aVal < bVal) return -dir;
          if (aVal > bVal) return dir;

          // Tiebreaker 1: Album (if not primary sort key)
          if (sortKey !== 'album') {
            const aAlbum = this._stripIgnoredPrefix(a.album || '', ignoreWords).toLowerCase();
            const bAlbum = this._stripIgnoredPrefix(b.album || '', ignoreWords).toLowerCase();
            if (aAlbum < bAlbum) return -1;
            if (aAlbum > bAlbum) return 1;
          }

          // Tiebreaker 2: Track Number
          const aTrack = parseInt(String(a.track_number || '').split('/')[0], 10) || 999999;
          const bTrack = parseInt(String(b.track_number || '').split('/')[0], 10) || 999999;
          if (aTrack < bTrack) return -1;
          if (aTrack > bTrack) return 1;

          // Tiebreaker 3: Artist (if not primary sort key)
          if (sortKey !== 'artist') {
            const aArtist = this._stripIgnoredPrefix(a.artist || '', ignoreWords).toLowerCase();
            const bArtist = this._stripIgnoredPrefix(b.artist || '', ignoreWords).toLowerCase();
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
      this.load();
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

        await this.load();

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

        // Use Rust command instead of JS plugin API for better reliability
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
     * Fetch tracks from backend (alias for load)
     * Used by event system for consistency
     */
    async fetchTracks() {
      await this.load();
    },
  });
}
