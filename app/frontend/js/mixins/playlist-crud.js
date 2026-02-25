/**
 * Playlist CRUD mixin for sidebar playlist management.
 * Handles creation, renaming, deletion, and inline editing of playlists.
 *
 * Expects component to have: playlists, editingPlaylist, editingName, editingIsNew,
 * selectedPlaylistIds, selectionAnchorIndex, activeSection, ui, loadPlaylists(),
 * loadPlaylist(), loadSection().
 */
import { playlists } from '../api/playlists.js';

export function playlistCrudMixin() {
  return {
    async createPlaylist() {
      try {
        const { name: uniqueName } = await playlists.generateName();
        const playlist = await playlists.create(uniqueName);
        await this.loadPlaylists();

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

    async createPlaylistWithTracks(trackIds) {
      try {
        const { name: uniqueName } = await playlists.generateName();
        const playlist = await playlists.create(uniqueName);

        if (trackIds.length > 0) {
          await playlists.addTracks(playlist.id, trackIds);
        }

        await this.loadPlaylists();
        window.dispatchEvent(new CustomEvent('mt:playlists-updated'));

        const newPlaylist = this.playlists.find((p) => p.playlistId === playlist.id);
        if (newPlaylist) {
          this.startInlineRename(newPlaylist, true);
        }
      } catch (error) {
        console.error('Failed to create playlist with tracks:', error);
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
        await playlists.rename(this.editingPlaylist.playlistId, newName);
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
          await playlists.delete(this.editingPlaylist.playlistId);
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
        if (this.selectedPlaylistIds.length === 0 && this.activeSection?.startsWith('playlist-')) {
          const activePlaylistId = parseInt(this.activeSection.replace('playlist-', ''), 10);
          if (!isNaN(activePlaylistId)) {
            event.preventDefault();
            this.selectedPlaylistIds = [activePlaylistId];
            this.deleteSelectedPlaylists();
            return;
          }
        }
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
          await playlists.delete(playlist.playlistId);
          deletedIds.push(playlist.playlistId);
        } catch (error) {
          console.error(`Failed to delete playlist ${playlist.name}:`, error);
          errors.push(playlist.name);
        }
      }

      if (deletedIds.length > 0) {
        const msg = deletedIds.length === 1
          ? `Deleted "${selectedPlaylists.find((p) => deletedIds.includes(p.playlistId)).name}"`
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
  };
}
