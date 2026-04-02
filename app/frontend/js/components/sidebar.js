import { playlists } from '../api/playlists.js';
import { playlistReorderMixin } from '../mixins/playlist-reorder.js';
import { playlistCrudMixin } from '../mixins/playlist-crud.js';

export function createSidebar(Alpine) {
  Alpine.data('sidebar', () => ({
    // Settings (backed by Rust settings store)
    activeSection: 'all',
    playlists: [],
    isCollapsed: false,

    editingPlaylist: null,
    editingName: '',
    editingIsNew: false,
    dragOverPlaylistId: null,

    reorderDraggingIndex: null,
    reorderDragOverIndex: null,
    reorderDragY: 0,
    reorderDragStartY: 0,

    selectedPlaylistIds: [],
    selectionAnchorIndex: null,

    sections: [
      { id: 'all', label: 'Music', icon: 'music' },
      { id: 'artists', label: 'Artists', icon: 'users' },
      { id: 'albums', label: 'Albums', icon: 'disc' },
      { id: 'nowPlaying', label: 'Now Playing', icon: 'speaker' },
      { id: 'liked', label: 'Liked Songs', icon: 'heart' },
      { id: 'recent', label: 'Recently Played', icon: 'clock' },
      { id: 'added', label: 'Recently Added', icon: 'sparkles' },
      { id: 'top25', label: 'Top 25', icon: 'fire' },
      { id: 'genius', label: 'Genius', icon: 'genius' },
    ],

    // Merge mixins
    ...playlistReorderMixin(),
    ...playlistCrudMixin(),

    contextMenuPlaylist: null,
    contextMenuX: 0,
    contextMenuY: 0,

    _onPlaylistsUpdated: null,

    init() {
      this._initSettings();
      console.log('[Sidebar] Component initialized, drag handlers available:', {
        handlePlaylistDragOver: typeof this.handlePlaylistDragOver,
        handlePlaylistDragLeave: typeof this.handlePlaylistDragLeave,
        handlePlaylistDrop: typeof this.handlePlaylistDrop,
      });
      this._migrateOldStorage();
      this.loadPlaylists();
      // Use loadPlaylist for playlist sections, loadSection for built-in sections
      if (this.activeSection.startsWith('playlist-')) {
        this.loadPlaylist(this.activeSection);
      } else {
        this.loadSection(this.activeSection);
      }

      window.addEventListener('mt:create-playlist-with-tracks', async (e) => {
        await this.createPlaylistWithTracks(e.detail?.trackIds || []);
      });

      this._onPlaylistsUpdated = () => {
        this.loadPlaylists();
      };
      window.addEventListener('mt:playlists-updated', this._onPlaylistsUpdated);
    },

    destroy() {
      if (this._onPlaylistsUpdated) {
        window.removeEventListener('mt:playlists-updated', this._onPlaylistsUpdated);
        this._onPlaylistsUpdated = null;
      }
    },

    /**
     * Initialize settings from backend and setup watchers.
     */
    _initSettings() {
      if (!window.settings || !window.settings.initialized) {
        console.log('[Sidebar] Settings service not available, using defaults');
        return;
      }

      this.activeSection = window.settings.get('sidebar:activeSection', 'all');
      this.isCollapsed = window.settings.get('sidebar:isCollapsed', false);

      console.log('[Sidebar] Loaded settings from backend');

      this.$nextTick(() => {
        this.$watch('activeSection', (value) => {
          window.settings.set('sidebar:activeSection', value).catch((err) =>
            console.error('[Sidebar] Failed to sync activeSection:', err)
          );
        });

        this.$watch('isCollapsed', (value) => {
          window.settings.set('sidebar:isCollapsed', value).catch((err) =>
            console.error('[Sidebar] Failed to sync isCollapsed:', err)
          );
        });
      });
    },

    _migrateOldStorage() {
      const oldData = localStorage.getItem('mt:sidebar');
      if (oldData) {
        try {
          const data = JSON.parse(oldData);
          if (data.activeSection) this.activeSection = data.activeSection;
          if (data.isCollapsed !== undefined) this.isCollapsed = data.isCollapsed;
          localStorage.removeItem('mt:sidebar');
        } catch (_e) {
          localStorage.removeItem('mt:sidebar');
        }
      }
    },

    get library() {
      return this.$store.library;
    },

    get ui() {
      return this.$store.ui;
    },

    async loadSection(sectionId) {
      this.activeSection = sectionId;

      this.ui.setView('library');
      this.library.setSection(sectionId);

      switch (sectionId) {
        case 'all':
          this.library.searchQuery = '';
          this.library.sortBy = 'artist';
          this.library.sortOrder = 'asc';
          await this.library.load();
          break;
        case 'artists':
          this.ui.setView('artists');
          if (this.library.tracks.length === 0) {
            await this.library.load();
          }
          return;
        case 'albums':
          this.ui.setView('albums');
          if (this.library.tracks.length === 0) {
            await this.library.load();
          }
          return;
        case 'nowPlaying':
          this.ui.setView('nowPlaying');
          return;
        case 'liked':
          this.library.searchQuery = '';
          this.library.sortBy = 'artist';
          this.library.sortOrder = 'asc';
          await this.library.loadFavorites();
          break;
        case 'recent':
          this.library.searchQuery = '';
          this.library.sortBy = 'lastPlayed';
          this.library.sortOrder = 'desc';
          await this.library.loadRecentlyPlayed(14);
          break;
        case 'added':
          this.library.searchQuery = '';
          this.library.sortBy = 'dateAdded';
          this.library.sortOrder = 'desc';
          await this.library.loadRecentlyAdded(14);
          break;
        case 'top25':
          this.library.searchQuery = '';
          this.library.sortBy = 'playCount';
          this.library.sortOrder = 'desc';
          await this.library.loadTop25();
          break;
        case 'genius':
          this.ui.setView('genius');
          return;
      }
    },

    async loadPlaylists() {
      try {
        const data = await playlists.getAll();
        this.playlists = data.map((p) => ({
          id: `playlist-${p.id}`,
          playlistId: p.id,
          name: p.name,
        }));
      } catch (error) {
        console.error('Failed to load playlists:', error);
        this.playlists = [];
      }
    },

    async loadPlaylist(sectionId) {
      this.activeSection = sectionId;
      this.ui.setView('library');
      this.library.setSection(sectionId);

      const playlistId = parseInt(sectionId.replace('playlist-', ''), 10);
      if (isNaN(playlistId)) {
        this.ui.toast('Invalid playlist', 'error');
        return;
      }

      this.library.searchQuery = '';
      // Don't set sortBy for playlists - they should maintain their stored order
      // Setting sortBy to null/default prevents the sort indicator from showing
      // and preserves the playlist's custom track order
      this.library.sortBy = 'default';
      this.library.sortOrder = 'asc';
      await this.library.loadPlaylist(playlistId);
    },

    handlePlaylistClick(event, playlist, index) {
      if (event.button !== 0) return;

      // Ignore clicks that immediately follow a drag operation or playlist reorder
      if (
        window._mtInternalDragActive || window._mtDragJustEnded ||
        window._mtPlaylistReorderActive || window._mtPlaylistReorderJustEnded
      ) {
        console.log('[Sidebar] Ignoring click - drag or reorder in progress or just ended');
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      const isMeta = event.metaKey || event.ctrlKey;
      const isShift = event.shiftKey;

      if (isMeta) {
        const idx = this.selectedPlaylistIds.indexOf(playlist.playlistId);
        if (idx >= 0) {
          this.selectedPlaylistIds.splice(idx, 1);
        } else {
          this.selectedPlaylistIds.push(playlist.playlistId);
        }
        this.selectionAnchorIndex = index;
      } else if (isShift && this.selectionAnchorIndex !== null) {
        const start = Math.min(this.selectionAnchorIndex, index);
        const end = Math.max(this.selectionAnchorIndex, index);
        this.selectedPlaylistIds = [];
        for (let i = start; i <= end; i++) {
          this.selectedPlaylistIds.push(this.playlists[i].playlistId);
        }
      } else {
        this.selectedPlaylistIds = [];
        this.selectionAnchorIndex = index;
        this.loadPlaylist(playlist.id);
      }
    },

    isPlaylistSelected(playlistId) {
      return this.selectedPlaylistIds.includes(playlistId);
    },

    clearPlaylistSelection() {
      this.selectedPlaylistIds = [];
      this.selectionAnchorIndex = null;
    },

    handlePlaylistDragOver(event, playlist) {
      const hasTrackData = event.dataTransfer?.types?.includes('application/json') ||
        window._mtDraggedTrackIds;

      console.log('[Sidebar] handlePlaylistDragOver called', {
        playlistId: playlist.playlistId,
        playlistName: playlist.name,
        reorderDraggingIndex: this.reorderDraggingIndex,
        dataTransferTypes: event.dataTransfer?.types ? [...event.dataTransfer.types] : [],
        hasTrackData,
        globalTrackIds: !!window._mtDraggedTrackIds,
      });

      if (this.reorderDraggingIndex !== null) {
        console.log('[Sidebar] Ignoring dragover - reorder in progress');
        return;
      }

      if (!hasTrackData) {
        console.log('[Sidebar] Ignoring dragover - no track data');
        return;
      }

      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
      this.dragOverPlaylistId = playlist.playlistId;
    },

    handlePlaylistDragLeave(_event, playlist) {
      console.log('[Sidebar] handlePlaylistDragLeave called', {
        playlistId: playlist?.playlistId,
        playlistName: playlist?.name,
      });
      this.dragOverPlaylistId = null;
    },

    async handlePlaylistDrop(event, playlist) {
      console.log('[Sidebar] handlePlaylistDrop called', {
        playlistId: playlist.playlistId,
        playlistName: playlist.name,
        reorderDraggingIndex: this.reorderDraggingIndex,
        dataTransferTypes: event.dataTransfer?.types ? [...event.dataTransfer.types] : [],
        globalTrackIds: window._mtDraggedTrackIds,
      });

      if (this.reorderDraggingIndex !== null) {
        console.log('[Sidebar] Ignoring drop - reorder in progress');
        return;
      }
      event.preventDefault();
      this.dragOverPlaylistId = null;

      // Try dataTransfer first, fall back to global variable (Tauri workaround)
      let trackIdsJson = event.dataTransfer.getData('application/json');

      if (!trackIdsJson && window._mtDraggedTrackIds) {
        console.log('[Sidebar] Using global _mtDraggedTrackIds workaround');
        trackIdsJson = JSON.stringify(window._mtDraggedTrackIds);
      }

      console.log('[Sidebar] Retrieved trackIdsJson:', trackIdsJson);

      if (!trackIdsJson) {
        console.warn('[Sidebar] No trackIdsJson available - drop aborted');
        return;
      }

      try {
        const trackIds = JSON.parse(trackIdsJson);
        console.log('[Sidebar] Parsed trackIds:', trackIds);

        if (!Array.isArray(trackIds) || trackIds.length === 0) {
          console.warn('[Sidebar] trackIds empty or not an array - drop aborted');
          return;
        }

        console.log('[Sidebar] Calling playlists.addTracks', {
          playlistId: playlist.playlistId,
          trackIds: trackIds,
        });
        const result = await playlists.addTracks(playlist.playlistId, trackIds);
        console.log('[Sidebar] playlists.addTracks result:', result);

        if (result.added > 0) {
          this.ui.toast(
            `Added ${result.added} track${result.added > 1 ? 's' : ''} to "${playlist.name}"`,
            'success',
          );
        } else {
          this.ui.toast(
            `Track${trackIds.length > 1 ? 's' : ''} already in "${playlist.name}"`,
            'info',
          );
        }
        window.dispatchEvent(new CustomEvent('mt:playlists-updated'));
      } catch (error) {
        console.error('[Sidebar] Failed to add tracks to playlist:', error);
        this.ui.toast('Failed to add tracks to playlist', 'error');
      }
    },

    isPlaylistDragOver(playlistId) {
      return this.dragOverPlaylistId === playlistId;
    },

    toggleCollapse() {
      this.isCollapsed = !this.isCollapsed;
    },

    isActive(sectionId) {
      return this.activeSection === sectionId;
    },
  }));
}

export default createSidebar;
