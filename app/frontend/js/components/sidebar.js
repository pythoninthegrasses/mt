import { api } from '../api.js';

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


    selectedPlaylistIds: [],
    selectionAnchorIndex: null,

    sections: [
      { id: 'all', label: 'Music', icon: 'music' },
      { id: 'nowPlaying', label: 'Now Playing', icon: 'speaker' },
      { id: 'liked', label: 'Liked Songs', icon: 'heart' },
      { id: 'recent', label: 'Recently Played', icon: 'clock' },
      { id: 'added', label: 'Recently Added', icon: 'sparkles' },
      { id: 'top25', label: 'Top 25', icon: 'fire' },
    ],

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
    },

    /**
     * Initialize settings from backend and setup watchers.
     */
    _initSettings() {
      if (!window.settings || !window.settings.initialized) {
        console.log('[Sidebar] Settings service not available, using defaults');
        return;
      }

      // Load settings from backend
      this.activeSection = window.settings.get('sidebar:activeSection', 'all');
      this.isCollapsed = window.settings.get('sidebar:isCollapsed', false);

      console.log('[Sidebar] Loaded settings from backend');

      // Setup watchers to sync changes to backend
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
      }
    },

    async loadPlaylists() {
      try {
        const playlists = await api.playlists.getAll();
        this.playlists = playlists.map((p) => ({
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
      // This prevents navigation when dropping tracks on playlists or reordering
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

    async createPlaylist() {
      try {
        const { name: uniqueName } = await api.playlists.generateName();
        const playlist = await api.playlists.create(uniqueName);
        await this.loadPlaylists();

        // Notify other components (e.g., context menu) that playlists changed
        window.dispatchEvent(new CustomEvent('mt:playlists-updated'));

        const newPlaylist = this.playlists.find((p) => p.playlistId === playlist.id);
        if (newPlaylist) {
          this.startInlineRename(newPlaylist, true);
        }
      } catch (error) {
        console.error('Failed to create playlist:', error);
        this.ui.toast('Failed to create playlist', 'error');
      }
    },

    startInlineRename(playlist, isNew = false) {
      this.editingPlaylist = playlist;
      this.editingName = playlist.name;
      this.editingIsNew = isNew;
      this.$nextTick(() => {
        const input = document.querySelector('[data-testid="playlist-rename-input"]');
        if (input) {
          input.focus();
          input.select();
        }
      });
    },

    async commitInlineRename() {
      if (!this.editingPlaylist) return;

      const newName = this.editingName.trim();
      if (!newName) {
        if (this.editingIsNew) {
          this.cancelInlineRename();
        } else {
          this.editingName = this.editingPlaylist.name;
        }
        return;
      }

      if (newName === this.editingPlaylist.name) {
        const wasNew = this.editingIsNew;
        const playlistId = this.editingPlaylist.playlistId;
        this.editingPlaylist = null;
        if (wasNew) {
          this.loadPlaylist(`playlist-${playlistId}`);
        }
        return;
      }

      try {
        await api.playlists.rename(this.editingPlaylist.playlistId, newName);
        const wasNew = this.editingIsNew;
        const playlistId = this.editingPlaylist.playlistId;
        this.editingPlaylist = null;
        await this.loadPlaylists();
        window.dispatchEvent(new CustomEvent('mt:playlists-updated'));

        if (wasNew) {
          this.loadPlaylist(`playlist-${playlistId}`);
        }
      } catch (error) {
        console.error('Failed to rename playlist:', error);
        if (
          error.message?.includes('UNIQUE constraint') || error.message?.includes('already exists')
        ) {
          this.ui.toast('A playlist with that name already exists', 'error');
        } else {
          this.ui.toast('Failed to rename playlist', 'error');
          this.editingPlaylist = null;
        }
      }
    },

    async cancelInlineRename() {
      if (this.editingIsNew && this.editingPlaylist) {
        try {
          await api.playlists.delete(this.editingPlaylist.playlistId);
          await this.loadPlaylists();
        } catch (error) {
          console.error('Failed to delete cancelled playlist:', error);
        }
      }
      this.editingPlaylist = null;
      this.editingName = '';
      this.editingIsNew = false;
    },

    handleRenameKeydown(event) {
      if (event.key === 'Enter') {
        event.preventDefault();
        this.commitInlineRename();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        this.cancelInlineRename();
      }
    },

    handlePlaylistDragOver(event, playlist) {
      // Check if this is a track drag (from library or global workaround)
      const hasTrackData = event.dataTransfer?.types?.includes('application/json') ||
        window._mtDraggedTrackIds;

      console.log('[Sidebar] handlePlaylistDragOver called', {
        playlistId: playlist.playlistId,
        playlistName: playlist.name,
        dataTransferTypes: event.dataTransfer?.types ? [...event.dataTransfer.types] : [],
        hasTrackData,
        globalTrackIds: !!window._mtDraggedTrackIds,
      });

      // Only show drop indicator if we have track data
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
        dataTransferTypes: event.dataTransfer?.types ? [...event.dataTransfer.types] : [],
        globalTrackIds: window._mtDraggedTrackIds,
      });

      event.preventDefault();
      this.dragOverPlaylistId = null;

      // Try dataTransfer first, fall back to global variable (Tauri workaround)
      let trackIdsJson = event.dataTransfer.getData('application/json');

      // Tauri workaround: dataTransfer may be empty in Tauri webview
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

        console.log('[Sidebar] Calling api.playlists.addTracks', {
          playlistId: playlist.playlistId,
          trackIds: trackIds,
        });
        const result = await api.playlists.addTracks(playlist.playlistId, trackIds);
        console.log('[Sidebar] api.playlists.addTracks result:', result);

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

    /**
     * Handler for Alpine.js Sort plugin playlist reordering
     * Called when user completes a drag-drop operation on playlist list
     *
     * @param {number} itemKey - The x-sort:item key (original index) of dragged playlist
     * @param {number} newPosition - New position (0-indexed)
     */
    async handlePlaylistReorder(itemKey, newPosition) {
      const fromIdx = parseInt(itemKey, 10);
      if (isNaN(fromIdx) || fromIdx === newPosition) return;

      // Calculate backend position (API expects final position after removal)
      let toPosition = newPosition;
      if (fromIdx < newPosition) {
        toPosition--;
      }

      if (fromIdx === toPosition) return;

      try {
        await api.playlists.reorderPlaylists(fromIdx, toPosition);
        await this.loadPlaylists();
      } catch (error) {
        console.error('[Sidebar] Failed to reorder playlists:', error);
        this.ui.toast('Failed to reorder playlists', 'error');
      }
    },

    toggleCollapse() {
      this.isCollapsed = !this.isCollapsed;
    },

    isActive(sectionId) {
      return this.activeSection === sectionId;
    },

    contextMenuPlaylist: null,
    contextMenuX: 0,
    contextMenuY: 0,

    showPlaylistContextMenu(event, playlist) {
      event.preventDefault();
      this.contextMenuPlaylist = playlist;
      this.contextMenuX = event.clientX;
      this.contextMenuY = event.clientY;
    },

    hidePlaylistContextMenu() {
      this.contextMenuPlaylist = null;
    },

    renamePlaylist() {
      if (!this.contextMenuPlaylist) return;

      const playlist = this.contextMenuPlaylist;
      this.hidePlaylistContextMenu();
      this.startInlineRename(playlist, false);
    },

    async deletePlaylist() {
      if (!this.contextMenuPlaylist) return;

      const playlist = this.contextMenuPlaylist;
      this.hidePlaylistContextMenu();

      if (this.selectedPlaylistIds.length === 0) {
        this.selectedPlaylistIds = [playlist.playlistId];
        this.selectionAnchorIndex = this.playlists.findIndex((p) =>
          p.playlistId === playlist.playlistId
        );
      }

      await this.deleteSelectedPlaylists();
    },

    handlePlaylistKeydown(event) {
      if (this.editingPlaylist) return;

      const isDeleteKey = event.key === 'Delete' ||
        event.key === 'Backspace' ||
        event.code === 'Delete' ||
        event.code === 'Backspace';

      if (isDeleteKey) {
        if (this.selectedPlaylistIds.length > 0) {
          event.preventDefault();
          this.deleteSelectedPlaylists();
        }
      }
    },

    async deleteSelectedPlaylists() {
      if (this.selectedPlaylistIds.length === 0) return;

      const selectedPlaylists = this.playlists.filter((p) =>
        this.selectedPlaylistIds.includes(p.playlistId)
      );
      const names = selectedPlaylists.map((p) => p.name);
      const message = selectedPlaylists.length === 1
        ? `Delete playlist "${names[0]}"?`
        : `Delete selected playlists?\n\n${names.join('\n')}`;

      let confirmed = false;
      if (window.__TAURI__?.dialog?.confirm) {
        confirmed = await window.__TAURI__.dialog.confirm(message, {
          title: selectedPlaylists.length === 1 ? 'Delete Playlist' : 'Delete Playlists',
          kind: 'warning',
        });
      } else {
        confirmed = confirm(message);
      }

      if (!confirmed) return;

      const deletedIds = [];
      const errors = [];

      for (const playlist of selectedPlaylists) {
        try {
          await api.playlists.delete(playlist.playlistId);
          deletedIds.push(playlist.playlistId);
        } catch (error) {
          console.error(`Failed to delete playlist ${playlist.name}:`, error);
          errors.push(playlist.name);
        }
      }

      if (deletedIds.length > 0) {
        const msg = deletedIds.length === 1
          ? `Deleted \"${selectedPlaylists.find((p) => deletedIds.includes(p.playlistId)).name}\"`
          : 'Deleted selected playlists';
        this.ui.toast(msg, 'success');
      }

      if (errors.length > 0) {
        this.ui.toast(`Failed to delete: ${errors.join(', ')}`, 'error');
      }

      await this.loadPlaylists();
      window.dispatchEvent(new CustomEvent('mt:playlists-updated'));

      if (deletedIds.includes(parseInt(this.activeSection.replace('playlist-', ''), 10))) {
        this.loadSection('all');
      }

      this.clearPlaylistSelection();
    },
  }));
}

export default createSidebar;
