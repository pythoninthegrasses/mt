import { playlists } from '../api/playlists.js';

/**
 * Playlist drag mixin for library browser.
 * Handles drag-and-drop reordering of tracks within a playlist view.
 */
export function playlistDragMixin() {
  return {
    // State
    draggingIndex: null,
    dragOverIndex: null,
    dragY: 0,
    dragStartY: 0,

    startPlaylistDrag(index, event) {
      if (!this.isInPlaylistView()) return;
      event.preventDefault();

      const rows = document.querySelectorAll('[data-track-id]');
      const draggedRow = rows[index];
      const rect = draggedRow?.getBoundingClientRect();
      const startY = event.clientY || event.touches?.[0]?.clientY || 0;

      this.draggingIndex = index;
      this.dragOverIndex = null;
      this.dragY = startY;
      this.dragStartY = rect ? rect.top + rect.height / 2 : startY;

      const onMove = (e) => {
        const y = e.clientY || e.touches?.[0]?.clientY;
        if (y === undefined) return;
        this.dragY = y;
        this.updatePlaylistDragTarget(y);
      };

      const onEnd = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onEnd);
        document.removeEventListener('touchmove', onMove);
        document.removeEventListener('touchend', onEnd);
        this.finishPlaylistDrag();
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onEnd);
      document.addEventListener('touchmove', onMove, { passive: true });
      document.addEventListener('touchend', onEnd);
    },

    updatePlaylistDragTarget(y) {
      const container = this.$refs.scrollContainer;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const headerEl = container.querySelector('[data-testid="library-header"]');
      const headerHeight = headerEl ? headerEl.offsetHeight : 0;
      const relativeY = y - rect.top - headerHeight + container.scrollTop;
      const trackCount = this.library.filteredTracks.length;
      let newOverIdx = Math.floor(relativeY / this._rowHeight);
      newOverIdx = Math.max(0, Math.min(newOverIdx, trackCount));

      if (newOverIdx > this.draggingIndex) {
        newOverIdx = Math.min(newOverIdx, trackCount);
      }

      this.dragOverIndex = newOverIdx;
    },

    async finishPlaylistDrag() {
      if (
        this.draggingIndex !== null &&
        this.dragOverIndex !== null &&
        this.draggingIndex !== this.dragOverIndex
      ) {
        let toPosition = this.dragOverIndex;
        if (this.draggingIndex < toPosition) {
          toPosition--;
        }

        if (this.draggingIndex !== toPosition) {
          try {
            await playlists.reorder(this.currentPlaylistId, this.draggingIndex, toPosition);

            const playlist = await playlists.get(this.currentPlaylistId);
            const tracks = (playlist.tracks || []).map((item) => item.track);
            this.library.tracks = tracks;
            this.library.applyFilters();
          } catch (error) {
            console.error('[PlaylistDrag] Failed to reorder playlist:', error);
            this.$store.ui.toast('Failed to reorder tracks', 'error');
          }
        }
      }

      this.draggingIndex = null;
      this.dragOverIndex = null;
    },

    isDraggingTrack(index) {
      return this.draggingIndex === index;
    },

    isOtherTrackDragging(index) {
      return this.draggingIndex !== null && this.draggingIndex !== index;
    },

    getTrackDragTransform(index) {
      if (this.draggingIndex !== index) return '';

      const offsetY = this.dragY - this.dragStartY;
      return `translateY(${offsetY}px)`;
    },

    getDragOverClass(index) {
      if (this.draggingIndex === null || this.dragOverIndex === null) return '';
      if (index === this.draggingIndex) return '';

      const classes = [];

      // Add translation classes for items between drag source and target
      if (this.draggingIndex < this.dragOverIndex) {
        if (index > this.draggingIndex && index < this.dragOverIndex) {
          classes.push('translate-y-[-100%]');
        }
      } else {
        if (index >= this.dragOverIndex && index < this.draggingIndex) {
          classes.push('translate-y-[100%]');
        }
      }

      // Add drop indicator class (shows a line where the item will be inserted)
      // Only show if actual reorder would happen (i.e., adjusted position differs)
      let adjustedToPosition = this.dragOverIndex;
      if (this.draggingIndex < this.dragOverIndex) {
        adjustedToPosition = this.dragOverIndex - 1;
      }
      const wouldReorder = this.draggingIndex !== adjustedToPosition;

      // Show indicator ABOVE this row if dragOverIndex equals this row's index
      if (
        wouldReorder &&
        index === this.dragOverIndex &&
        this.dragOverIndex !== this.draggingIndex
      ) {
        classes.push('playlist-drop-indicator-above');
      }
      // Show indicator BELOW the last row if dragging to the end
      const trackCount = this.library?.filteredTracks?.length || 0;
      if (wouldReorder && index === trackCount - 1 && this.dragOverIndex === trackCount) {
        classes.push('playlist-drop-indicator-below');
      }

      return classes.join(' ');
    },
  };
}
