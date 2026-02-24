import { api } from '../api.js';

/**
 * Context menu and playback actions mixin for library browser.
 * Handles right-click context menu, track playback actions, drag-start/end,
 * playlist management, and track removal.
 */
export function contextMenuActionsMixin() {
  return {
    handleTrackDragStart(event, track) {
      window._mtInternalDragActive = true;

      if (!this.selectedTracks.has(track.id)) {
        this.selectedTracks.clear();
        this.selectedTracks.add(track.id);
      }

      const trackIds = Array.from(this.selectedTracks);
      const trackIdsJson = JSON.stringify(trackIds);

      // Store track IDs globally for Tauri drop handler workaround
      window._mtDraggedTrackIds = trackIds;

      console.log('[drag-drop]', 'dragstart', {
        trackCount: trackIds.length,
        trackIds,
        dataTransferData: trackIdsJson,
      });

      event.dataTransfer.setData('application/json', trackIdsJson);
      event.dataTransfer.effectAllowed = 'all';

      const count = trackIds.length;
      const dragEl = document.createElement('div');
      dragEl.className =
        'fixed bg-primary text-primary-foreground px-3 py-1.5 rounded-md text-sm font-medium shadow-lg pointer-events-none';
      dragEl.textContent = count === 1 ? '1 track' : `${count} tracks`;
      dragEl.style.position = 'absolute';
      dragEl.style.top = '-1000px';
      document.body.appendChild(dragEl);
      event.dataTransfer.setDragImage(dragEl, 0, 0);
      setTimeout(() => dragEl.remove(), 0);
    },

    handleTrackDragEnd(event) {
      window._mtInternalDragActive = false;
      window._mtDragJustEnded = true;
      setTimeout(() => {
        window._mtDragJustEnded = false;
        window._mtDraggedTrackIds = null;
        console.log('[drag-drop]', 'dragJustEnded cleared');
      }, 1000);

      console.log('[drag-drop]', 'dragend', {
        dropEffect: event.dataTransfer?.dropEffect,
      });
    },

    /**
     * Handle right-click context menu
     * @param {Event} event - Context menu event
     * @param {Object} track - Track object
     * @param {number} index - Track index
     */
    handleContextMenu(event, track, index) {
      event.preventDefault();

      // Select track if not already selected
      if (!this.selectedTracks.has(track.id)) {
        this.selectedTracks.clear();
        this.selectedTracks.add(track.id);
        this.lastSelectedIndex = index;
      }

      const selectedCount = this.selectedTracks.size;
      const trackLabel = selectedCount === 1 ? 'track' : `${selectedCount} tracks`;

      const isInPlaylist = this.currentPlaylistId !== null;

      const menuItems = [
        {
          label: 'Play Now',
          action: () => this.playSelected(),
        },
        {
          label: `Add ${trackLabel} to Queue`,
          action: () => this.addSelectedToQueue(),
        },
        { type: 'separator' },
        {
          label: 'Play Next',
          action: () => this.playSelectedNext(),
        },
        {
          label: 'Add to Playlist',
          hasSubmenu: true,
          action: () => {
            this.showPlaylistSubmenu = !this.showPlaylistSubmenu;
          },
        },
        {
          label: 'Add to Liked Songs',
          action: () => this.toggleFavoriteFromMenu(track),
        },
      ];

      // Check favorite status and update label asynchronously
      api.favorites
        .check(track.id)
        .then((result) => {
          if (!this.contextMenu) return;
          const favoriteItem = this.contextMenu.items.find(
            (i) => i.label === 'Add to Liked Songs' || i.label === 'Remove from Liked Songs',
          );
          if (favoriteItem) {
            favoriteItem.label = result.is_favorite
              ? 'Remove from Liked Songs'
              : 'Add to Liked Songs';
          }
        })
        .catch(() => {});

      if (isInPlaylist) {
        menuItems.push({ type: 'separator' });
        menuItems.push({
          label: `Remove ${trackLabel} from Playlist`,
          action: () => this.removeFromPlaylist(),
        });
      }

      menuItems.push({ type: 'separator' });
      menuItems.push({
        label: 'Show in Finder',
        action: () => this.showInFinder(track),
        disabled: selectedCount > 1,
      });
      menuItems.push({
        label: selectedCount > 1
          ? `Edit Metadata (${selectedCount} tracks)...`
          : 'Edit Metadata...',
        action: () => this.editMetadata(track),
      });
      menuItems.push({ type: 'separator' });
      menuItems.push({
        label: `Remove ${trackLabel} from Library`,
        action: () => this.removeSelected(),
        danger: true,
      });

      const menuHeight = 320;
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

      this.contextMenu = {
        x,
        y,
        track,
        items: menuItems,
      };
      this.showPlaylistSubmenu = false;
      this.submenuOnLeft = x + menuWidth + 45 + submenuWidth > window.innerWidth;
    },

    getSelectedTracks() {
      return this.library.filteredTracks.filter((t) => this.selectedTracks.has(t.id));
    },

    async playSelected() {
      const tracks = this.getSelectedTracks();
      if (tracks.length > 0) {
        await this.queue.clear();
        await this.queue.addTracks(tracks);
        await this.queue.playIndex(0);
      }
      this.contextMenu = null;
    },

    async addSelectedToQueue() {
      const tracks = this.getSelectedTracks();
      if (tracks.length > 0) {
        console.log('[context-menu]', 'add_to_queue', {
          trackCount: tracks.length,
          trackIds: tracks.map((t) => t.id),
        });

        await this.queue.addTracks(tracks);
        this.$store.ui.toast(
          `Added ${tracks.length} track${tracks.length > 1 ? 's' : ''} to queue`,
          'success',
        );
      }
      this.contextMenu = null;
    },

    async playSelectedNext() {
      const tracks = this.getSelectedTracks();
      if (tracks.length > 0) {
        console.log('[context-menu]', 'play_next', {
          trackCount: tracks.length,
          trackIds: tracks.map((t) => t.id),
        });

        await this.queue.playNextTracks(tracks);
        this.$store.ui.toast(
          `Playing ${tracks.length} track${tracks.length > 1 ? 's' : ''} next`,
          'success',
        );
      }
      this.contextMenu = null;
    },

    async addToPlaylist(playlistId) {
      const tracks = this.getSelectedTracks();
      if (tracks.length === 0) return;

      console.log('[context-menu]', 'add_to_playlist', {
        playlistId,
        trackCount: tracks.length,
        trackIds: tracks.map((t) => t.id),
      });

      try {
        const trackIds = tracks.map((t) => t.id);
        const result = await api.playlists.addTracks(playlistId, trackIds);
        const playlist = this.playlists.find((p) => p.id === playlistId);
        const playlistName = playlist?.name || 'playlist';

        if (result.added > 0) {
          this.$store.ui.toast(
            `Added ${result.added} track${result.added > 1 ? 's' : ''} to "${playlistName}"`,
            'success',
          );
        } else {
          this.$store.ui.toast(
            `Track${tracks.length > 1 ? 's' : ''} already in "${playlistName}"`,
            'info',
          );
        }

        window.dispatchEvent(new CustomEvent('mt:playlists-updated'));
      } catch (error) {
        console.error('[context-menu]', 'add_to_playlist_error', {
          playlistId,
          error: error.message,
        });
        this.$store.ui.toast('Failed to add to playlist', 'error');
      }

      this.contextMenu = null;
      this.showPlaylistSubmenu = false;
    },

    async toggleFavoriteFromMenu(track) {
      this.contextMenu = null;
      try {
        const result = await api.favorites.check(track.id);
        if (result.is_favorite) {
          await api.favorites.remove(track.id);
        } else {
          await api.favorites.add(track.id);
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
        this.$store.ui.toast('Failed to update liked songs', 'error');
      }
    },

    createPlaylistWithTracks() {
      const tracks = this.getSelectedTracks();
      this.contextMenu = null;
      this.showPlaylistSubmenu = false;
      if (tracks.length === 0) return;

      const trackIds = tracks.map((t) => t.id);
      window.dispatchEvent(
        new CustomEvent('mt:create-playlist-with-tracks', { detail: { trackIds } }),
      );
    },

    async removeFromPlaylist() {
      if (!this.currentPlaylistId) return;

      const tracks = this.getSelectedTracks();
      if (tracks.length === 0) return;

      try {
        const positions = [];
        for (const track of tracks) {
          const index = this.library.filteredTracks.findIndex((t) => t.id === track.id);
          if (index >= 0) positions.push(index);
        }

        positions.sort((a, b) => b - a);

        for (const position of positions) {
          await api.playlists.removeTrack(this.currentPlaylistId, position);
        }

        this.$store.ui.toast(
          `Removed ${tracks.length} track${tracks.length > 1 ? 's' : ''} from playlist`,
          'success',
        );

        const playlist = await api.playlists.get(this.currentPlaylistId);
        const newTracks = (playlist.tracks || []).map((item) => item.track);
        this.library.tracks = newTracks;
        this.library.totalTracks = newTracks.length;
        this.library.totalDuration = newTracks.reduce((sum, t) => sum + (t.duration || 0), 0);
        this.library.applyFilters();

        this.clearSelection();
        window.dispatchEvent(new CustomEvent('mt:playlists-updated'));
      } catch (error) {
        console.error('Failed to remove from playlist:', error);
        this.$store.ui.toast('Failed to remove from playlist', 'error');
      }

      this.contextMenu = null;
    },

    async showInFinder(track) {
      const trackPath = track?.filepath || track?.path;
      if (!trackPath) {
        console.error('Cannot show in folder: track has no filepath/path', track);
        this.$store.ui.toast('Cannot locate file', 'error');
        this.contextMenu = null;
        return;
      }

      console.log('[context-menu]', 'show_in_finder', {
        trackId: track.id,
        trackTitle: track.title,
        trackPath,
      });

      try {
        if (window.__TAURI__) {
          const { revealItemInDir } = await import('@tauri-apps/plugin-opener');
          await revealItemInDir(trackPath);
        } else {
          console.log('Show in folder (browser mode):', trackPath);
        }
      } catch (error) {
        console.error('[context-menu]', 'show_in_finder_error', {
          trackId: track.id,
          error: error.message,
        });
        this.$store.ui.toast('Failed to open folder', 'error');
      }
      this.contextMenu = null;
    },

    editMetadata(track) {
      const tracks = this.getSelectedTracks();
      if (tracks.length === 0) {
        tracks.push(track);
      }

      console.log('[context-menu]', 'edit_metadata', {
        trackCount: tracks.length,
        trackIds: tracks.map((t) => t.id),
        anchorTrackId: track.id,
      });

      this.contextMenu = null;
      this.$store.ui.openModal('editMetadata', {
        tracks,
        library: this.library,
        anchorTrackId: track.id,
      });
    },

    async removeSelected() {
      const tracks = this.getSelectedTracks();
      if (tracks.length === 0) return;

      console.log('[context-menu]', 'remove_from_library', {
        trackCount: tracks.length,
        trackIds: tracks.map((t) => t.id),
      });

      const confirmMsg = tracks.length === 1
        ? `Remove "${tracks[0].title}" from library?`
        : `Remove ${tracks.length} tracks from library?`;

      this.contextMenu = null;

      const confirmed = (await window.__TAURI__?.dialog?.confirm(confirmMsg, {
        title: 'Remove from Library',
        kind: 'warning',
      })) ?? window.confirm(confirmMsg);

      if (confirmed) {
        const trackIds = tracks.map((t) => t.id);
        const isDeletingAll = trackIds.length === this.library.allTracks.length;

        // Optimistic UI: remove from local state immediately
        this.library.removeTracksLocally(trackIds);
        this.selectedTracks.clear();
        this.$store.ui.toast(
          `Removed ${tracks.length} track${tracks.length > 1 ? 's' : ''}`,
          'success',
        );

        const { invoke } = window.__TAURI__.core;

        try {
          if (isDeletingAll) {
            // Remove watched folders first so watcher can't re-add tracks
            const folders = await invoke('watched_folders_list');
            await Promise.allSettled(
              (folders || []).map((f) => invoke('watched_folders_remove', { id: f.id })),
            );
            // Single SQL wipe of library, favorites, playlist_items
            await invoke('library_delete_all');
            console.log('[library-browser] Deleted all tracks and removed watched folders');
          } else {
            // Batch delete by IDs in a single IPC call
            await invoke('library_delete_tracks', { trackIds });
            console.log('[library-browser] Batch deleted', trackIds.length, 'tracks');
          }
        } catch (err) {
          console.error('[library-browser] Delete failed:', err);
          this.library.fetchTracks();
        }
      }
    },
  };
}
