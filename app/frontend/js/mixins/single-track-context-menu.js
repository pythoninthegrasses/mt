import { playlists } from '../api/playlists.js';
import { favorites } from '../api/favorites.js';
import { queue } from '../api/queue.js';
import { tauriInvoke } from '../api/shared.js';

/**
 * Context menu mixin for single-track context menus (artists, albums, now-playing views).
 * Handles right-click menu display, playlist management, favorites, and finder actions.
 *
 * Expects the component to have: contextMenu, playlists, showPlaylistSubmenu,
 * submenuOnLeft, submenuY, submenuCloseTimeout, queue, library, player properties.
 */
export function singleTrackContextMenuMixin() {
  return {
    _loadPlaylists: async function () {
      try {
        const data = await playlists.getAll();
        this.playlists = data.map((p) => ({ id: p.id, name: p.name }));
      } catch {
        this.playlists = [];
      }
    },

    handleContextMenu(event, track) {
      event.preventDefault();

      const menuItems = [
        { label: 'Play Now', action: () => this._ctxPlayTrack(track) },
        { label: 'Add to Queue', action: () => this._ctxAddToQueue(track) },
        { type: 'separator' },
        { label: 'Play Next', action: () => this._ctxPlayNext(track) },
        {
          label: 'Add to Playlist',
          hasSubmenu: true,
          action: () => {
            this.showPlaylistSubmenu = !this.showPlaylistSubmenu;
          },
        },
        { label: 'Add to Liked Songs', action: () => this._ctxToggleFavorite(track) },
        { type: 'separator' },
        { label: 'Show in Finder', action: () => this._ctxShowInFinder(track) },
      ];

      // Check favorite status and update label asynchronously
      favorites.check(track.id).then((result) => {
        if (!this.contextMenu) return;
        const favoriteItem = this.contextMenu.items.find(
          (i) => i.label === 'Add to Liked Songs' || i.label === 'Remove from Liked Songs',
        );
        if (favoriteItem) {
          favoriteItem.label = result.is_favorite
            ? 'Remove from Liked Songs'
            : 'Add to Liked Songs';
        }
      }).catch(() => {});

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

    async _ctxPlayTrack(track) {
      this.closeContextMenu();
      await this.queue.clear();
      await this.queue.add([track], false);
      await this.queue.playIndex(0);
    },

    async _ctxAddToQueue(track) {
      this.closeContextMenu();
      await this.queue.add([track], false);
      this.$store.ui.toast('Added to queue', 'success');
    },

    async _ctxPlayNext(track) {
      this.closeContextMenu();
      const pos = this.queue.currentIndex >= 0 ? this.queue.currentIndex + 1 : 0;
      await queue.add([track.id], pos);
      await this.queue._loadFromBackend();
      this.$store.ui.toast('Playing next', 'success');
    },

    async _ctxToggleFavorite(track) {
      this.closeContextMenu();
      try {
        const result = await favorites.check(track.id);
        if (result.is_favorite) {
          await favorites.remove(track.id);
        } else {
          await favorites.add(track.id);
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

    async addToPlaylist(playlistId) {
      const track = this.contextMenu?.track;
      this.closeContextMenu();
      if (!track) return;

      try {
        const result = await playlists.addTracks(playlistId, [track.id]);
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

    async _ctxShowInFinder(track) {
      this.closeContextMenu();
      if (track.filepath) {
        try {
          await tauriInvoke('show_in_folder', { path: track.filepath });
        } catch (err) {
          console.error('[context-menu] Failed to show in finder:', err);
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
  };
}
